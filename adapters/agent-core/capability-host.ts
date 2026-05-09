// ─── Capability Host Implementation ─────────────────────────────
// Agent-side implementation of AgentCapabilityHost.
// Wraps Node.js primitives with permission checks.

import { spawn as spawnRaw } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, statSync } from 'fs';
import { request } from 'https';
import { join, resolve } from 'path';
import type {
  AgentCapabilityHost, FileSystemCapability, FileEntry,
  ProcessCapability, TerminalCapability, NotificationCapability,
  SpawnOptions, TerminalOptions, TerminalHandle, ProcessInfo,
} from '../types';
import type { PermissionModel } from './permissions';
import type { NotificationModel } from './notifications';
import type { RelayConnection } from './relay-connection';
import { listProcesses } from './introspection';

export function createCapabilityHost(
  permissions: PermissionModel,
  notifications: NotificationModel,
  relay: RelayConnection,
  ntfyTopic?: string,
): AgentCapabilityHost {
  return {
    fs: createFsCapability(permissions),
    process: createProcessCapability(permissions),
    terminal: createTerminalCapability(permissions),
    permissions,
    notifications: createNotificationCapability(notifications, relay, ntfyTopic),
  };
}

function createFsCapability(pm: PermissionModel): FileSystemCapability {
  return {
    async read(p: string): Promise<string> {
      const r = pm.check('fileRead', { path: p });
      if (!r.allowed) throw new Error(r.reason);
      return readFileSync(p, 'utf8');
    },
    async write(p: string, content: string): Promise<void> {
      const r = pm.check('fileWrite', { path: p });
      if (!r.allowed) throw new Error(r.reason);
      writeFileSync(p, content, 'utf8');
    },
    async list(dir: string): Promise<FileEntry[]> {
      const r = pm.check('fileRead', { path: dir });
      if (!r.allowed) throw new Error(r.reason);
      const names = readdirSync(dir);
      return names.map(name => {
        const full = join(dir, name);
        try {
          const st = statSync(full);
          return { name, path: resolve(full), isDir: st.isDirectory(), size: st.size, modifiedAt: st.mtimeMs };
        } catch {
          return { name, path: resolve(full), isDir: false, size: 0, modifiedAt: 0 };
        }
      });
    },
    async exists(p: string): Promise<boolean> {
      return existsSync(p);
    },
    async delete(p: string): Promise<void> {
      const r = pm.check('fileWrite', { path: p });
      if (!r.allowed) throw new Error(r.reason);
      unlinkSync(p);
    },
  };
}

function createProcessCapability(pm: PermissionModel): ProcessCapability {
  return {
    spawn(cmd: string, args: string[], opts?: SpawnOptions) {
      const pmCheck = pm.check('processManagement');
      if (!pmCheck.allowed) throw new Error(pmCheck.reason);
      const saCheck = pm.check('shellAccess', { command: cmd });
      if (!saCheck.allowed) throw new Error(saCheck.reason);
      return spawnRaw(cmd, args, {
        cwd: opts?.cwd,
        env: opts?.env ? { ...process.env, ...opts.env } : process.env,
        stdio: opts?.stdio ?? ['pipe', 'pipe', 'pipe'],
      });
    },
    async list(): Promise<ProcessInfo[]> {
      const r = pm.check('processManagement');
      if (!r.allowed) throw new Error(r.reason);
      return listProcesses();
    },
    async kill(pid: number): Promise<void> {
      const r = pm.check('processManagement');
      if (!r.allowed) throw new Error(r.reason);
      try { process.kill(pid); } catch { /* already dead */ }
    },
  };
}

function createTerminalCapability(pm: PermissionModel): TerminalCapability {
  return {
    spawn(cmd: string, args: string[], opts?: TerminalOptions): TerminalHandle {
      const saCheck = pm.check('shellAccess', { command: cmd });
      if (!saCheck.allowed) throw new Error(saCheck.reason);
      const pmCheck = pm.check('processManagement');
      if (!pmCheck.allowed) throw new Error(pmCheck.reason);

      const proc = spawnRaw(cmd, args, {
        cwd: opts?.cwd,
        env: opts?.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const listeners = new Set<(data: string) => void>();

      proc.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        for (const h of listeners) h(text);
      });

      return {
        pid: proc.pid ?? 0,
        write(data: string) {
          if (proc.stdin?.writable) proc.stdin.write(data);
        },
        resize(_cols: number, _rows: number) {
          // PTY resize needs node-pty; pipe-based spawn ignores resize.
        },
        onData(handler: (data: string) => void) {
          listeners.add(handler);
          return () => { listeners.delete(handler); };
        },
        dispose() {
          proc.kill();
        },
      };
    },
  };
}

function createNotificationCapability(
  nm: NotificationModel,
  relay: RelayConnection,
  ntfyTopic?: string,
): NotificationCapability {
  return {
    notify(scenarioId: string, title: string, detail?: string): void {
      if (!nm.isEnabled(scenarioId)) return;
      relay.sendNotification(scenarioId, title, detail);
      if (ntfyTopic) {
        const body = JSON.stringify({ topic: ntfyTopic, title, message: detail ?? '', tags: ['computer'] });
        const req = request('https://ntfy.sh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        });
        req.on('error', () => {});
        req.write(body);
        req.end();
      }
    },
  };
}
