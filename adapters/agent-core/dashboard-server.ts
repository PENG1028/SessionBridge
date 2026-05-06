// ─── Dashboard Server ──────────────────────────────────────────
// Minimal HTTP server on localhost that serves the agent dashboard
// and a JSON API for status, processes, permissions, and logs.

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { spawn, ChildProcess } from 'child_process';
import type { AgentConfig } from './config';
import type { PermissionModel } from './permissions';
import type { NotificationModel } from './notifications';
import type { RelayConnection } from './relay-connection';
import { dashboardHtml } from './dashboard-page';
import { VERSION } from '../version';
import { getSystemState, listProcesses, listProcessesSorted, type AgentIntrospection } from './introspection';

const LOG_CAP = 200;
const logs: string[] = [];

export function addDashboardLog(msg: string): void {
  logs.push(`[${new Date().toISOString()}] ${msg}`);
  if (logs.length > LOG_CAP) logs.shift();
}

function jsonReply(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
  });
}

export interface DashboardState {
  config: AgentConfig;
  permissions: PermissionModel;
  notifications?: NotificationModel;
  relayConnected: boolean;
  instanceId: string | null;
  adapters: { id: string; available: boolean }[];
  startTime: number;
}

let state: DashboardState | null = null;

export function setDashboardState(s: DashboardState): void {
  state = s;
}

// ─── Shell Run Instances ──────────────────────────────────────

interface ShellRunInstance {
  instanceId: string;
  pid: number;
  proc: ChildProcess;
  sseClients: Set<ServerResponse>;
  exitCode: number | null;
  startTime: number;
  relayInstanceId?: string;
}

const shellInstances = new Map<string, ShellRunInstance>();

// Relay integration — set by agent.ts after dashboard starts
let relay: RelayConnection | null = null;
// Maps relay instance ID → dashboard shell instanceId
const relayToShellId = new Map<string, string>();

export function setDashboardRelay(r: RelayConnection | null): void {
  relay = r;
}

/** Write stdin data to a shell instance, looked up by relay instance ID. */
export function writeToShellByRelayId(relayInstanceId: string, data: string): boolean {
  const shellId = relayToShellId.get(relayInstanceId);
  if (!shellId) return false;
  const entry = shellInstances.get(shellId);
  if (!entry || !entry.proc.stdin?.writable) return false;
  entry.proc.stdin.write(data);
  return true;
}

function buildIntrospection(): AgentIntrospection {
  const adapters = state?.adapters ?? [];
  return {
    version: VERSION,
    label: state?.config.label ?? '',
    pid: process.pid,
    uptime: state ? (Date.now() - state.startTime) / 1000 : 0,
    system: getSystemState(),
    adapters,
    permissions: state?.permissions.grants ?? {},
    notifications: state?.notifications?.toJSON() ?? { scenarios: [], settings: {} },
  };
}

export function startDashboard(config: AgentConfig, permissions: PermissionModel): Promise<void> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      // CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
        res.end();
        return;
      }

      try {
        switch (url.pathname) {
          case '/':
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(dashboardHtml(config.label || 'Agent'));
            return;

          case '/api/status':
            jsonReply(res, 200, buildIntrospection());
            return;

          case '/api/system':
            jsonReply(res, 200, getSystemState());
            return;

          case '/api/processes': {
            const sortBy = (url.searchParams.get('sort') as 'cpu' | 'memory' | 'pid') || undefined;
            const limit = parseInt(url.searchParams.get('limit') || '', 10) || undefined;
            if (sortBy) {
              jsonReply(res, 200, await listProcessesSorted(sortBy, limit ?? 50));
            } else {
              jsonReply(res, 200, await listProcesses());
            }
            return;
          }

          case '/api/permissions': {
            if (req.method === 'POST') {
              const body = await readBody(req);
              const { category, value } = JSON.parse(body);
              if (category && typeof value === 'boolean') {
                permissions.set(category, value);
                addDashboardLog(`[permissions] ${category} = ${value}`);
              }
              jsonReply(res, 200, { ok: true, grants: permissions.grants });
            } else {
              jsonReply(res, 200, permissions.grants);
            }
            return;
          }

          case '/api/notifications': {
            const nm = state?.notifications;
            if (!nm) {
              jsonReply(res, 200, { scenarios: [], settings: {} });
              return;
            }
            if (req.method === 'POST') {
              const body = await readBody(req);
              const { scenarioId, value } = JSON.parse(body);
              if (scenarioId && typeof value === 'boolean') {
                nm.set(scenarioId, value);
                addDashboardLog(`[notifications] ${scenarioId} = ${value}`);
              }
              jsonReply(res, 200, nm.toJSON());
            } else {
              jsonReply(res, 200, nm.toJSON());
            }
            return;
          }

          case '/api/shell/run': {
            if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return; }
            const body = await readBody(req);
            const { command, cwd } = JSON.parse(body);
            if (!command) { jsonReply(res, 400, { error: 'Missing command' }); return; }
            const instanceId = 'sh_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
            const shellCmd = process.platform === 'win32' ? 'cmd.exe' : 'sh';
            const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];
            const proc = spawn(shellCmd, shellArgs, {
              cwd: cwd || process.cwd(),
              stdio: ['pipe', 'pipe', 'pipe'],
            });
            const entry: ShellRunInstance = {
              instanceId, pid: proc.pid ?? 0,
              proc, sseClients: new Set(), exitCode: null,
              startTime: Date.now(),
            };
            shellInstances.set(instanceId, entry);

            // Register on relay if connected
            if (relay) {
              const requestId = instanceId;
              const onSpawned = (rid: string, relayId: string) => {
                if (rid !== requestId) return;
                relay?.removeListener('instanceSpawned', onSpawned);
                entry.relayInstanceId = relayId;
                relayToShellId.set(relayId, instanceId);
                addDashboardLog(`[shell:run] ${instanceId} relay=${relayId}`);
              };
              relay.on('instanceSpawned', onSpawned);
              relay.sendInstanceSpawn(requestId, command.slice(0, 50), cwd || process.cwd(), command);
            }

            const broadcast = (data: string, stream: 'stdout' | 'stderr') => {
              const sseData = `data:${JSON.stringify({ stream, data })}\n\n`;
              for (const c of entry.sseClients) {
                try { c.write(sseData); } catch { entry.sseClients.delete(c); }
              }
              // Also forward to relay if registered
              if (entry.relayInstanceId && relay) {
                if (stream === 'stdout') relay.sendStdoutForInstance(entry.relayInstanceId, data);
                else relay.sendStderrForInstance(entry.relayInstanceId, data);
              }
            };
            proc.stdout?.on('data', (chunk: Buffer) => broadcast(chunk.toString(), 'stdout'));
            proc.stderr?.on('data', (chunk: Buffer) => broadcast(chunk.toString(), 'stderr'));
            proc.on('close', (code) => {
              entry.exitCode = code;
              if (entry.relayInstanceId && relay) {
                relay.sendInstanceExit(entry.relayInstanceId, code ?? -1);
                relayToShellId.delete(entry.relayInstanceId);
              }
              const exitData = `data:${JSON.stringify({ type: 'exit', code })}\n\n`;
              for (const c of entry.sseClients) {
                try { c.write(exitData); c.end(); } catch { /* ignore */ }
              }
              setTimeout(() => { shellInstances.delete(instanceId); }, 5000);
            });

            addDashboardLog(`[shell:run] ${instanceId} pid=${proc.pid} cmd=${command.slice(0, 60)}`);
            jsonReply(res, 200, { instanceId, pid: proc.pid });
            return;
          }

          case '/api/shell/stream': {
            const id = url.searchParams.get('id');
            if (!id) { jsonReply(res, 400, { error: 'Missing id' }); return; }
            const entry = shellInstances.get(id);
            if (!entry) { jsonReply(res, 404, { error: 'Instance not found' }); return; }
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*',
            });
            res.write(':ok\n\n');
            entry.sseClients.add(res);
            if (entry.exitCode !== null) {
              res.write(`data:${JSON.stringify({ type: 'exit', code: entry.exitCode })}\n\n`);
              res.end();
              entry.sseClients.delete(res);
              return;
            }
            // Keepalive every 15s
            const keepalive = setInterval(() => {
              try { res.write(':keepalive\n\n'); } catch { clearInterval(keepalive); }
            }, 15000);
            req.on('close', () => {
              clearInterval(keepalive);
              entry.sseClients.delete(res);
            });
            return;
          }

          case '/api/shell/input': {
            if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
            const body = await readBody(req);
            const { instanceId, data } = JSON.parse(body);
            const entry = shellInstances.get(instanceId);
            if (!entry || !entry.proc.stdin?.writable) { jsonReply(res, 404, { error: 'Instance not found or stdin closed' }); return; }
            entry.proc.stdin.write(data);
            jsonReply(res, 200, { ok: true });
            return;
          }

          case '/api/shell/kill': {
            if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
            const body = await readBody(req);
            const { instanceId } = JSON.parse(body);
            const entry = shellInstances.get(instanceId);
            if (!entry) { jsonReply(res, 404, { error: 'Instance not found' }); return; }
            entry.proc.kill();
            jsonReply(res, 200, { ok: true });
            return;
          }

          case '/api/logs':
            jsonReply(res, 200, logs.slice(-50));
            return;

          default:
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
        }
      } catch (err) {
        jsonReply(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    });

    server.listen(config.dashboardPort, config.dashboardBind, () => {
      addDashboardLog(`[dashboard] http://${config.dashboardBind}:${config.dashboardPort}`);
      resolve();
    });
  });
}
