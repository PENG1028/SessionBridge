// ─── Dashboard Server ──────────────────────────────────────────
// Minimal HTTP server on localhost that serves the agent dashboard
// and a JSON API for status, processes, permissions, and logs.

import { createServer, request as httpRequest, IncomingMessage, ServerResponse } from 'http';
import { spawn, ChildProcess } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, extname, dirname } from 'path';
import { configDir, type AgentConfig } from './config';
import type { PermissionModel } from './permissions';
import type { NotificationModel } from './notifications';
import type { RelayConnection } from './relay-connection';
import { dashboardHtml } from './dashboard-page';
import { VERSION } from '../extensions/version';
import { getSystemState, listProcesses, listProcessesSorted, type AgentIntrospection } from './introspection';
import type { HostInfo } from './extension-host-manager';
import { extensionPoints } from './extension-points';
import { detectNetwork } from '../src/network-detect';
import {
  initAuth, checkAuth, createSession, revokeSession,
  listSessions, changePassword, loginPageHtml, setupPageHtml,
  parseAuthCookie, getToken, isTokenSet, isAuthEnabled, setAuthEnabled,
  type DashboardSession,
} from './dashboard-auth';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

const LOG_CAP = 200;
const logs: string[] = [];

/** Reference to the running HTTP server, used for restarting. */
let httpServer: import('http').Server | null = null;

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

/** Persist config changes (e.g. dashboardToken) back to agent.json. */
function persistConfig(config: AgentConfig): void {
  try {
    const path = process.env.BRIDGE_CONFIG || join(configDir(), 'agent.json');
    let existing: Record<string, unknown> = {};
    try {
      if (existsSync(path)) {
        existing = JSON.parse(readFileSync(path, 'utf8'));
      }
    } catch { /* malformed — overwrite */ }
    existing.dashboardToken = config.dashboardToken;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(existing, null, 2), 'utf8');
    addDashboardLog('[auth] Token persisted to config');
  } catch (e) {
    addDashboardLog(`[auth] Failed to persist token: ${e}`);
  }
}

export function startDashboard(config: AgentConfig, permissions: PermissionModel): Promise<void> {
  // Initialize auth module (token may be empty — triggers first-run setup)
  const authEnabled = config.dashboardAuthEnabled !== false;
  initAuth(config.dashboardToken || '', authEnabled, config.dashboardSessionTtl);
  if (!authEnabled) {
    addDashboardLog('[auth] Dashboard authentication disabled');
  } else if (config.dashboardToken) {
    addDashboardLog('[auth] Using configured dashboard token');
  } else {
    addDashboardLog('[auth] No dashboard token set — first access will prompt for setup');
    console.log(`[auth] No dashboard token set. Open http://${config.dashboardBind}:${config.dashboardPort} to create one.`);
  }
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      // CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
        res.end();
        return;
      }

      // ── Public routes (no auth required) ─────────────────────
      const hasToken = isTokenSet();
      const isPublic =
        url.pathname === '/api/auth/check' ||
        (!hasToken && (url.pathname === '/setup' || url.pathname === '/api/auth/setup')) ||
        (hasToken && (url.pathname === '/login' || url.pathname === '/api/auth/login'));

      // ── Auth gate for all other routes ────────────────────────
      if (!isPublic && isAuthEnabled()) {
        if (!hasToken) {
          // No token set yet — redirect everything to /setup
          if (url.pathname.startsWith('/api/')) {
            jsonReply(res, 403, { error: 'Setup required', message: '请先设置访问密钥' });
          } else {
            res.writeHead(302, { 'Location': '/setup' });
            res.end();
          }
          return;
        }
        const authResult = checkAuth(req);
        if (!authResult.authenticated) {
          // API requests get 401 JSON, page requests get redirected to /login
          if (url.pathname.startsWith('/api/')) {
            jsonReply(res, 401, { error: 'Unauthorized', message: '请先登录' });
          } else {
            res.writeHead(302, { 'Location': '/login' });
            res.end();
          }
          return;
        }
      }

      try {
        switch (url.pathname) {
          // ── Auth routes ──────────────────────────────────────
          // First-run setup (only accessible when no token is set)
          case '/setup': {
            if (isTokenSet()) {
              res.writeHead(302, { 'Location': '/login' });
              res.end();
              return;
            }
            const error = url.searchParams.get('error') || undefined;
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(setupPageHtml(error));
            return;
          }

          case '/api/auth/setup': {
            if (isTokenSet()) {
              jsonReply(res, 403, { error: 'Token already set' });
              return;
            }
            if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return; }
            const body = await readBody(req);
            let password: string | null = null;
            let confirm: string | null = null;
            if (body.startsWith('{')) {
              try {
                const data = JSON.parse(body);
                password = data.password;
                confirm = data.confirm;
              } catch { /* fall through */ }
            } else {
              const params = new URLSearchParams(body);
              password = params.get('password');
              confirm = params.get('confirm');
            }
            if (!password) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(setupPageHtml('请输入访问密钥'));
              return;
            }
            if (password.length < 8) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(setupPageHtml('密钥长度至少 8 个字符'));
              return;
            }
            if (password !== confirm) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(setupPageHtml('两次输入的密钥不一致'));
              return;
            }
            // Token is now set
            changePassword(password);
            if (state) {
              state.config.dashboardToken = password;
              persistConfig(state.config);
            }
            // Create session for the setup user
            const ua = req.headers['user-agent'] || undefined;
            const { cookie } = createSession(ua);
            addDashboardLog('[auth] Initial password set — dashboard secured');
            console.log(`[auth] Dashboard token set by user. Use this to log in from other devices.`);
            res.writeHead(302, { 'Location': '/', 'Set-Cookie': cookie });
            res.end();
            return;
          }

          case '/login': {
            const error = url.searchParams.get('error') || undefined;
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(loginPageHtml(error));
            return;
          }

          case '/api/auth/login': {
            if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return; }
            const body = await readBody(req);
            // Support both JSON and form-urlencoded
            let submittedToken: string | null = null;
            if (body.startsWith('{')) {
              try { submittedToken = JSON.parse(body).token; } catch { /* fall through */ }
            } else {
              const params = new URLSearchParams(body);
              submittedToken = params.get('token');
            }
            if (!submittedToken) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(loginPageHtml('请输入访问密钥'));
              return;
            }
            const currentToken = getToken();
            if (!currentToken || submittedToken !== currentToken) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(loginPageHtml('密钥错误，请重试'));
              return;
            }
            const ua = req.headers['user-agent'] || undefined;
            const { cookie } = createSession(ua);
            addDashboardLog('[auth] Login succeeded');
            res.writeHead(302, { 'Location': '/', 'Set-Cookie': cookie });
            res.end();
            return;
          }

          case '/api/auth/logout': {
            if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
            const cookie = parseAuthCookie(req);
            if (cookie) revokeSession(cookie.sessionId);
            addDashboardLog('[auth] Logout');
            res.writeHead(200, {
              'Set-Cookie': 'sb_session=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/',
            });
            jsonReply(res, 200, { ok: true });
            return;
          }

          case '/api/auth/sessions': {
            if (req.method === 'DELETE') {
              const sid = url.searchParams.get('id');
              if (!sid) { jsonReply(res, 400, { error: 'Missing session id' }); return; }
              revokeSession(sid);
              addDashboardLog(`[auth] Session revoked: ${sid.slice(0, 8)}…`);
              jsonReply(res, 200, { ok: true });
              return;
            }
            const all = listSessions();
            jsonReply(res, 200, all.map(s => ({
              id: s.id.slice(0, 16) + '…',
              createdAt: new Date(s.createdAt).toISOString(),
              expiresAt: new Date(s.expiresAt).toISOString(),
              userAgent: s.userAgent || '(unknown)',
            })));
            return;
          }

          case '/api/auth/change-password': {
            if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
            const body = await readBody(req);
            let oldToken: string, newToken: string;
            try {
              const data = JSON.parse(body);
              oldToken = data.oldToken;
              newToken = data.newToken;
            } catch {
              jsonReply(res, 400, { error: 'Invalid JSON' });
              return;
            }
            if (!oldToken || !newToken) {
              jsonReply(res, 400, { error: 'Missing oldToken or newToken' });
              return;
            }
            const current = getToken();
            if (oldToken !== current) {
              jsonReply(res, 403, { error: 'Current password is incorrect' });
              return;
            }
            if (newToken.length < 8) {
              jsonReply(res, 400, { error: 'New password must be at least 8 characters' });
              return;
            }
            changePassword(newToken);
            // Persist to config
            if (state) {
              state.config.dashboardToken = newToken;
              persistConfig(state.config);
            }
            addDashboardLog('[auth] Password changed — all sessions invalidated');
            jsonReply(res, 200, { ok: true, message: '密码已更改，所有会话已失效' });
            return;
          }

          case '/api/auth/check': {
            const authResult = checkAuth(req);
            jsonReply(res, 200, {
              authenticated: authResult.authenticated,
              authEnabled: isAuthEnabled(),
              tokenSet: isTokenSet(),
              session: authResult.session ? {
                createdAt: new Date(authResult.session.createdAt).toISOString(),
                expiresAt: new Date(authResult.session.expiresAt).toISOString(),
              } : null,
            });
            return;
          }

          case '/api/auth/toggle': {
            if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
            const body = await readBody(req);
            let enabled: boolean;
            try {
              enabled = JSON.parse(body).enabled;
            } catch {
              jsonReply(res, 400, { error: 'Missing "enabled" field' });
              return;
            }
            setAuthEnabled(enabled);
            if (state) {
              state.config.dashboardAuthEnabled = enabled;
              persistConfig(state.config);
            }
            addDashboardLog(`[auth] Authentication ${enabled ? 'enabled' : 'disabled'}`);
            jsonReply(res, 200, { ok: true, authEnabled: enabled });
            return;
          }

          // ── Main routes ──────────────────────────────────────
          case '/':
          case '/index.html':
            // Serve the Next.js console (from out/) at root
            const consoleRoot = existsSync(join(__dirname, '../../out'))
              ? join(__dirname, '../../out')
              : join(__dirname, '../../../out');
            const consoleIndex = join(consoleRoot, 'index.html');
            if (existsSync(consoleIndex)) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(readFileSync(consoleIndex));
            } else {
              // Fallback: show monitoring if out/ not built
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(dashboardHtml(config.label || 'Agent'));
            }
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
            const permCheck = permissions.check('shellAccess', { command });
            if (!permCheck.allowed) {
              jsonReply(res, 403, { error: permCheck.reason || 'Permission denied: shellAccess' });
              return;
            }
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

          // ── Node External Access ──────────────────────────
          case '/api/node/external': {
            if (req.method === 'GET') {
              // Network environment detection
              const hasToken = !!state?.config.relayToken;
              const port = state?.config.dashboardPort || 9843;
              const result = detectNetwork(port, hasToken);
              jsonReply(res, 200, result);
              return;
            }
            if (req.method === 'POST') {
              // Toggle external access on/off
              const body = await readBody(req);
              const { enable } = JSON.parse(body);
              const bind = enable ? '0.0.0.0' : '127.0.0.1';
              addDashboardLog(`[external] Toggling: ${enable ? 'ON' : 'OFF'} → dashboardBind: ${bind}`);
              if (state) {
                state.config.dashboardBind = bind;
                // Restart the HTTP server to pick up the new bind address
                await restartDashboard().catch((err) => {
                  addDashboardLog(`[external] Restart failed: ${err.message}`);
                });
              }
              jsonReply(res, 200, {
                enabled: enable,
                bind,
                port: state?.config.dashboardPort || 9843,
                message: enable
                  ? `对外访问已开启: http://${bind}:${state?.config.dashboardPort || 9843}`
                  : '对外访问已关闭',
              });
              return;
            }
            jsonReply(res, 405, { error: 'Method not allowed' });
            return;
          }

          default:
            // API proxy: forward unknown /api/* requests to relay server
            if (url.pathname.startsWith('/api/')) {
              const relayPort = state?.config.relayPort || 8080;
              const proxyHeaders = { ...req.headers };
              delete proxyHeaders['host'];
              delete proxyHeaders['connection'];
              delete proxyHeaders['keep-alive'];
              // Tag the forwarded request so relay can detect circular proxies
              proxyHeaders['x-forwarded-by'] = 'dashboard';
              const proxyReq = httpRequest(
                { hostname: '127.0.0.1', port: relayPort, path: req.url, method: req.method, headers: proxyHeaders },
                (proxyRes) => {
                  res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
                  proxyRes.pipe(res);
                },
              );
              req.pipe(proxyReq);
              proxyReq.on('error', () => {
                jsonReply(res, 502, { error: 'Relay server unavailable' });
              });
              return;
            }

            // Try serving static file from Next.js export (out/)
            const projectRoot = existsSync(join(__dirname, '../../out'))
              ? join(__dirname, '../../out')
              : join(__dirname, '../../../out');
            const diskPath = join(projectRoot, url.pathname === '/' ? 'index.html' : url.pathname);
            if (existsSync(diskPath)) {
              const content = readFileSync(diskPath);
              const ext = extname(diskPath);
              res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
              res.end(content);
              return;
            }
            // SPA fallback: serve index.html for unknown paths
            const spaFallback = join(projectRoot, 'index.html');
            if (existsSync(spaFallback)) {
              const content = readFileSync(spaFallback);
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(content);
              return;
            }
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
        }
      } catch (err) {
        jsonReply(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    });

    server.listen(config.dashboardPort, config.dashboardBind, () => {
      addDashboardLog(`[dashboard] http://${config.dashboardBind}:${config.dashboardPort}`);
      httpServer = server;
      resolve();
    });
  });
}

/**
 * Restart the dashboard HTTP server.
 * Call after changing `config.dashboardBind` or `config.dashboardPort`
 * to apply the new binding without a full process restart.
 */
export async function restartDashboard(): Promise<void> {
  // Close the old server if running
  if (httpServer) {
    await new Promise<void>((resolve, reject) => {
      httpServer!.close((err) => (err ? reject(err) : resolve()));
    });
    httpServer = null;
  }
  // Restart with current state config (already updated by caller)
  const cfg = state?.config;
  const perm = state?.permissions;
  if (!cfg || !perm) {
    addDashboardLog('[dashboard] Cannot restart — no saved state');
    return;
  }
  return startDashboard(cfg, perm);
}
