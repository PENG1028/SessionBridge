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
import type { HostInfo } from './extension-host-manager';
import { extensionPoints } from './extension-points';

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

function maskSensitive(cfg: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...cfg };
  const sensitiveKeys = ['relayToken', 'ntfyTopic', 'apiKey', 'secret', 'token', 'password'];
  for (const key of sensitiveKeys) {
    if (masked[key] && typeof masked[key] === 'string' && (masked[key] as string).length > 4) {
      masked[key] = (masked[key] as string).slice(0, 4) + '*'.repeat(Math.min((masked[key] as string).length - 4, 20));
    }
  }
  return masked;
}

function qrPage(relayUrl: string, token: string): string {
  const connectUrl = token
    ? `${relayUrl}?token=${encodeURIComponent(token)}`
    : relayUrl;
  const encoded = encodeURIComponent(connectUrl);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SessionBridge — Connect</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:system-ui,-apple-system,sans-serif; background:#0d1117; color:#c9d1d9; display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; padding:24px; }
  .card { background:#161b22; border:1px solid #30363d; border-radius:12px; padding:32px; max-width:420px; width:100%; text-align:center; }
  h1 { font-size:1.25rem; margin-bottom:8px; color:#58a6ff; }
  .sub { font-size:0.85rem; color:#8b949e; margin-bottom:24px; word-break:break-all; }
  .qr { background:#fff; padding:16px; border-radius:8px; display:inline-block; margin-bottom:20px; }
  .qr img { display:block; width:200px; height:200px; }
  .copy-btn { background:#238636; color:#fff; border:none; padding:8px 20px; border-radius:6px; cursor:pointer; font-size:0.9rem; }
  .copy-btn:hover { background:#2ea043; }
  .copy-btn:active { background:#196c2e; }
  .info { margin-top:20px; font-size:0.8rem; color:#8b949e; }
  .info code { background:#21262d; padding:2px 6px; border-radius:3px; font-size:0.85em; }
  .instructions { text-align:left; margin-top:20px; font-size:0.85rem; line-height:1.6; }
  .instructions li { margin-bottom:6px; }
  @media (prefers-color-scheme:light) {
    body { background:#fff; color:#24292f; }
    .card { background:#f6f8fa; border-color:#d0d7de; }
    h1 { color:#0969da; }
    .sub,.info { color:#656d76; }
    .info code { background:#eaeef2; }
  }
</style>
</head>
<body>
<div class="card">
  <h1>SessionBridge</h1>
  <p class="sub">Scan QR code or open the link on your target device to connect.</p>
  <div class="qr"><img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encoded}" alt="QR" width="200" height="200"></div>
  <button class="copy-btn" onclick="navigator.clipboard.writeText('${connectUrl}').then(()=>{this.textContent='Copied!';setTimeout(()=>this.textContent='Copy Connection URL',2000)})">Copy Connection URL</button>
  <div class="instructions">
    <ol>
      <li>Install SessionBridge on the target device</li>
      <li>Run: <code>bridge connect ${connectUrl}</code></li>
      <li>Or open this page on the device and click "Copy Connection URL"</li>
    </ol>
  </div>
  <div class="info">
    Relay: <code>${relayUrl}</code><br>
    ${token ? 'Token: <code>' + token.slice(0, 8) + '…</code>' : 'No token set'}
  </div>
</div>
</body>
</html>`;
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
// Extension host manager (dev mode) — set by node-runtime
let extensionHost: { getInfo(): HostInfo; reload(opts?: any): Promise<string[]> } | null = null;
// Maps relay instance ID → dashboard shell instanceId
const relayToShellId = new Map<string, string>();

export function setDashboardRelay(r: RelayConnection | null): void {
  relay = r;
}

/** Register the extension host manager for dashboard API access. */
export function setExtensionHost(h: typeof extensionHost): void {
  extensionHost = h;
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

          // ── Extensions (dev mode) ───────────────────────────
          case '/api/extensions': {
            if (!extensionHost) {
              jsonReply(res, 200, { enabled: false, state: 'disabled' });
              return;
            }
            if (req.method === 'POST') {
              const body = await readBody(req);
              const { action } = JSON.parse(body);
              if (action === 'reload') {
                addDashboardLog('[extensions] Reload requested via API');
                extensionHost.reload().catch((err: Error) => addDashboardLog(`[extensions] Reload failed: ${err.message}`));
                jsonReply(res, 200, { ok: true, message: 'Reloading...' });
              } else {
                jsonReply(res, 400, { error: `Unknown action: ${action}` });
              }
            } else {
              const info = extensionHost.getInfo();
              (info as any).configurations = extensionPoints.getConfigSchemas();
              jsonReply(res, 200, info);
            }
            return;
          }

          // ── Config & Connection Management ─────────────────
          case '/api/config': {
            if (req.method === 'POST') {
              const body = await readBody(req);
              const updates = JSON.parse(body);
              if (state && updates && typeof updates === 'object') {
                const config = state.config as unknown as Record<string, unknown>;
                for (const [k, v] of Object.entries(updates)) {
                  if (k in config) {
                    config[k] = v;
                    addDashboardLog(`[config] ${k}=${JSON.stringify(v)}`);
                  }
                }
                jsonReply(res, 200, { ok: true, config: maskSensitive(config) });
              } else {
                jsonReply(res, 400, { error: 'Invalid body' });
              }
            } else {
              // GET: return current config (with sensitive fields masked)
              const cfg = state ? maskSensitive(state.config as unknown as Record<string, unknown>) : {};
              jsonReply(res, 200, cfg);
            }
            return;
          }

          case '/api/connect': {
            if (req.method === 'POST') {
              const body = await readBody(req);
              const { relayUrl, token } = JSON.parse(body);
              if (!relayUrl) { jsonReply(res, 400, { error: 'Missing relayUrl' }); return; }
              if (relay) {
                addDashboardLog(`[connect] Connecting to ${relayUrl}...`);
                // Update config upstreamRelay
                if (state) state.config.upstreamRelay = relayUrl;
                if (token) {
                  if (state) state.config.relayToken = token;
                  // Also signal relay to use new token
                  addDashboardLog(`[connect] Token set`);
                }
                // Re-connect via relay instance
                await relay.shutdown();
                (relay as any).config.upstreamRelay = relayUrl;
                relay.connect();
                jsonReply(res, 200, { ok: true, relayUrl, message: 'Reconnecting...' });
              } else {
                jsonReply(res, 503, { error: 'Relay connection not available' });
              }
              return;
            } else {
              // GET: show connection info for sharing
              const upstreamRelay = relay ? (relay as any).config?.upstreamRelay || '' : '';
              const token = state?.config.relayToken || '';
              jsonReply(res, 200, {
                relayUrl: upstreamRelay || `ws://127.0.0.1:${state?.config.relayPort || 8080}`,
                token: token ? token.slice(0, 8) + '…' : '(none)',
                command: upstreamRelay ? `bridge connect ${upstreamRelay}${token ? ` --token ${token.slice(0, 16)}…` : ''}` : 'bridge (default)',
                role: state?.config.role || 'auto',
              });
            }
            return;
          }

          case '/api/daemon/stop': {
            if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
            jsonReply(res, 200, { ok: true, message: 'Shutting down...' });
            addDashboardLog('[daemon] Stop requested via API');
            // Give the response time to be sent, then exit
            setTimeout(() => { process.exit(0); }, 200);
            return;
          }

          // ── QR Code page (simple page for mobile scan) ─────
          case '/qr': {
            const token = url.searchParams.get('token') || state?.config.relayToken || '';
            const relayUrl = url.searchParams.get('url') || (relay ? (relay as any).config?.upstreamRelay || `ws://127.0.0.1:${state?.config.relayPort || 8080}` : `ws://127.0.0.1:${state?.config.relayPort || 8080}`);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(qrPage(relayUrl, token));
            return;
          }

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
