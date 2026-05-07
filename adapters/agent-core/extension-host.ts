#!/usr/bin/env node
// ─── Extension Host Process ───────────────────────────────────────
// Spawned via child_process.fork() by ExtensionHostManager.
// Loads extensions in an isolated process and proxies I/O through IPC.
//
// IPC protocol (parent ↔ host):
//   Parent → Host:  { type, ... }
//   Host → Parent:  { type, ... }

import { scanAndActivate, type ActivatedExtension } from './extension-loader';
import { adapterRegistry } from '../registry';

// ─── State ───────────────────────────────────────────────────────

const activeExtensions = new Map<string, ActivatedExtension>();

// ─── Message Handlers ────────────────────────────────────────────

/** The requestId from the current incoming IPC message (if any). Used so send() echoes it back for correlation. */
let currentRequestId: string | undefined;

function send(type: string, payload: Record<string, unknown> = {}): void {
  if (process.send) {
    const msg: Record<string, unknown> = { type, ts: Date.now(), ...payload };
    if (currentRequestId) msg.requestId = currentRequestId;
    process.send(msg);
  }
}

async function handleMessage(msg: any): Promise<void> {
  // Capture requestId for correlation in send()
  currentRequestId = msg.requestId;
  try {
    switch (msg.type) {
      case 'host.activate': {
        const activated = await scanAndActivate({
          extraPaths: msg.extraPaths || [],
          filter: msg.filter || [],
          mode: msg.mode || 'production',
        });
        for (const ext of activated) {
          activeExtensions.set(ext.manifest.id, ext);
        }
        send('host.activated', {
          ids: activated.map(a => a.manifest.id),
          count: activated.length,
        });
        break;
      }

      case 'host.start': {
        const adapter = adapterRegistry.get(msg.adapterId);
        if (!adapter) {
          send('host.error', { error: `Adapter not found: ${msg.adapterId}` });
          return;
        }
        const input = msg.input as any;
        // Proxy output/block/exit callbacks back to main process
        input.onOutput = (data: string) => {
          send('host.output', { instanceId: msg.instanceId, data, stream: 'stdout' });
        };
        input.onBlock = (block: Record<string, unknown>) => {
          send('host.block', { instanceId: msg.instanceId, block });
        };
        input.onExit = (code: number | null) => {
          send('host.exit', { instanceId: msg.instanceId, code });
        };
        const handle = await adapter.start(input);
        startedInstances.set(msg.instanceId, {
          send: async (data: string) => handle.send(data),
          sendCommand: async (cmd: string, args?: Record<string, unknown>) => handle.sendCommand(cmd, args),
          stop: async () => handle.stop(),
        });
        send('host.started', { instanceId: msg.instanceId, pid: handle.instance?.runtime?.pid });
        break;
      }

      case 'host.send': {
        const adapter = adapterRegistry.get(msg.adapterId);
        if (!adapter) { send('host.error', { error: 'Adapter not found' }); return; }
        const instance = findRunningInstance(msg.instanceId);
        if (instance?.send) {
          await instance.send(msg.data);
          send('host.sent', { instanceId: msg.instanceId });
        }
        break;
      }

      case 'host.command': {
        const adapter = adapterRegistry.get(msg.adapterId);
        if (!adapter) { send('host.error', { error: 'Adapter not found' }); return; }
        const instance = findRunningInstance(msg.instanceId);
        if (instance?.sendCommand) {
          await instance.sendCommand(msg.command, msg.args || {});
          send('host.command_sent', { instanceId: msg.instanceId, command: msg.command });
        }
        break;
      }

      case 'host.stop': {
        const adapter = adapterRegistry.get(msg.adapterId);
        if (adapter) {
          const instance = findRunningInstance(msg.instanceId);
          if (instance?.stop) {
            await instance.stop();
          }
        }
        startedInstances.delete(msg.instanceId);
        send('host.stopped', { instanceId: msg.instanceId });
        break;
      }

      case 'host.reload': {
        for (const [id] of activeExtensions) {
          const ext = activeExtensions.get(id);
          ext?.context.dispose();
          adapterRegistry.unregister(id);
        }
        activeExtensions.clear();
        const activated = await scanAndActivate({
          extraPaths: msg.extraPaths || [],
          mode: msg.mode || 'production',
        });
        for (const ext of activated) {
          activeExtensions.set(ext.manifest.id, ext);
        }
        send('host.reloaded', { ids: activated.map(a => a.manifest.id) });
        break;
      }

      case 'host.shutdown': {
        send('host.shutdown_ack', {});
        for (const [id] of activeExtensions) {
          const ext = activeExtensions.get(id);
          ext?.context.dispose();
        }
        activeExtensions.clear();
        process.exit(0);
        break;
      }

      default:
        send('host.error', { error: `Unknown message type: ${msg.type}` });
    }
  } catch (err) {
    send('host.error', { error: (err as Error).message });
  }
}

// Track instances started via IPC by their instance ID
const startedInstances = new Map<string, { send: (data: string) => Promise<void>; sendCommand: (cmd: string, args?: Record<string, unknown>) => Promise<void>; stop: () => Promise<void> }>();

function findRunningInstance(instanceId: string) {
  return startedInstances.get(instanceId);
}

// ─── IPC Setup ───────────────────────────────────────────────────

process.on('message', (msg: any) => {
  handleMessage(msg).catch((err) => {
    send('host.error', { error: (err as Error).message });
  });
});

// Signal that the host is ready
send('host.ready', {
  pid: process.pid,
  nodeVersion: process.version,
  platform: process.platform,
});

// Prevent the process from exiting immediately
process.stdin.resume();
