// ─── Admin Routes ─────────────────────────────────────────────
// Admin/monitoring API routes (formerly in the standalone dashboard
// server, now integrated into the relay). Registered on the relay
// server after api-routes but before inline handlers.
//
// Uses only Node.js built-in modules — no Express, no framework.

import type { IncomingMessage, ServerResponse } from "http";
import { spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join, extname, dirname } from "path";

import type { PermissionModel } from "../agent-core/permissions";
import type { NotificationModel } from "../agent-core/notifications";
import type { RelayConnection } from "../agent-core/relay-connection";
import { VERSION } from "../extensions/version";
import { getSystemState, listProcesses, listProcessesSorted } from "../agent-core/introspection";
import { detectNetwork } from "./network-detect";
import { extensionPoints } from "../agent-core/extension-points";
import { persistUpstreamRelay } from "../agent-core/config";

import {
  initAuth, checkAuth, createSession, revokeSession,
  listSessions, changePassword, setAuthEnabled,
  loginPageHtml, setupPageHtml,
  parseAuthCookie, getToken, isTokenSet, isAuthEnabled,
  type AdminSession,
} from "./admin-auth";

// ─── MIME types (for static file fallback) ────────────────────

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

// ─── Ad-hoc shell instance types ──────────────────────────────

export interface ShellRunInstance {
  instanceId: string;
  pid: number;
  proc: ChildProcess;
  sseClients: Set<ServerResponse>;
  exitCode: number | null;
  startTime: number;
  relayInstanceId?: string;
}

// ─── Admin Route Context ──────────────────────────────────────

export interface AdminRouteContext {
  /** Node display label */
  nodeLabel: string;
  /** Node start timestamp (from NodeRuntime) */
  nodeStartTime: number;
  /** Adapter list with availability */
  adapters: { id: string; available: boolean }[];
  /** Permission model (from NodeRuntime) */
  permissions: PermissionModel;
  /** Notification model (from NodeRuntime) */
  notifications?: NotificationModel;
  /** Relay connection (for ad-hoc shell relay integration) */
  relayConnection: RelayConnection | null;
  /** Relay port number */
  relayPort: number;
  /** Upstream relay URL (if configured) */
  upstreamRelay?: string;
  /** Relay token (for share info) */
  relayToken?: string;
  /** Resolved role */
  role: string;
  /** Ad-hoc shell instance map (owned by NodeRuntime) */
  shellInstances: Map<string, ShellRunInstance>;
  /** Maps relay instance ID → ad-hoc shell instance ID */
  relayToShellId: Map<string, string>;
  /** Extension host manager (dev mode, nullable) */
  extensionHost: { getInfo(): { [key: string]: unknown }; reload(opts?: unknown): Promise<string[]> } | null;
  /** Log buffer (owned by NodeRuntime) */
  logs: string[];
  /** Append a log entry */
  addLog: (msg: string) => void;
  /** Callback when external access is toggled */
  onToggleExternalAccess?: (enable: boolean) => Promise<void>;
  /** Callback when daemon stop is requested */
  onShutdown?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────

/** Write a JSON response. */
function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

/** Read the full request body as a UTF-8 string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString(); });
    req.on("end", () => resolve(data));
  });
}

// ─── QR code page ─────────────────────────────────────────────

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

// ─── Dashboard HTML fallback (when out/ is not built) ─────────

function dashboardHtml(label: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SessionBridge — ${escapeHtml(label)}</title>
<style>
:root {
  --bg: #0d1117; --fg: #e6edf3; --accent: #58a6ff;
  --border: #30363d; --card: #161b22; --muted: #8b949e;
  --green: #3fb950; --yellow: #d29922; --red: #f85149;
  --purple: #a371f7; --orange: #f0883e;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background: var(--bg); color: var(--fg); display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 24px; max-width: 600px; width: 100%; }
h1 { font-size: 1.2rem; margin-bottom: 4px; }
h1 small { font-weight: normal; font-size: 0.7rem; color: var(--muted); }
.status { margin: 16px 0; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.status-item { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px; }
.status-item .label { font-size: 0.7rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; }
.status-item .value { font-size: 1.1rem; font-weight: 600; margin-top: 4px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; font-weight: 500; }
.badge.green { background: rgba(63,185,80,.15); color: var(--green); }
.badge.yellow { background: rgba(210,153,34,.15); color: var(--yellow); }
.badge.red { background: rgba(248,81,73,.15); color: var(--red); }
table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 0.85rem; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: 500; font-size: 0.75rem; text-transform: uppercase; }
</style>
</head>
<body>
<div class="card">
  <h1>SessionBridge <small>${escapeHtml(label)}</small></h1>
  <div class="status" id="status">
    <div class="status-item"><div class="label">Status</div><div class="value" id="status-val">Loading...</div></div>
    <div class="status-item"><div class="label">Uptime</div><div class="value" id="uptime-val">...</div></div>
    <div class="status-item"><div class="label">Version</div><div class="value">${VERSION}</div></div>
    <div class="status-item"><div class="label">PID</div><div class="value" id="pid-val">...</div></div>
  </div>
  <h2 style="font-size:0.95rem;margin-top:20px;margin-bottom:8px">Adapters</h2>
  <table><thead><tr><th>Adapter</th><th>Status</th></tr></thead><tbody id="adapters-body"></tbody></table>
</div>
<script>
async function refresh(){try{const r=await fetch('/api/status');const d=await r.json();document.getElementById('status-val').innerHTML='<span class="badge green">Running</span>';document.getElementById('uptime-val').textContent=Math.floor(d.uptime||0)+'s';document.getElementById('pid-val').textContent=d.pid;const t=document.getElementById('adapters-body');t.innerHTML='';(d.adapters||[]).forEach(a=>{const tr=document.createElement('tr');tr.innerHTML='<td>'+a.id+'</td><td>'+(a.available?'<span class="badge green">Available</span>':'<span class="badge yellow">Unavailable</span>')+'</td>';t.appendChild(tr)})}catch(e){document.getElementById('status-val').innerHTML='<span class="badge red">Offline</span>'}}refresh();setInterval(refresh,3000)
</script>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Persist the admin token back to the agent.json config file.
 */
function persistToken(token: string): void {
  try {
    const { configDir } = require('../agent-core/config');
    const path = process.env.BRIDGE_CONFIG || join(configDir(), 'agent.json');
    let existing: Record<string, unknown> = {};
    try {
      if (existsSync(path)) {
        existing = JSON.parse(readFileSync(path, 'utf8'));
      }
    } catch { /* overwrite */ }
    existing.dashboardToken = token;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(existing, null, 2), 'utf8');
  } catch { /* best effort */ }
}

// ─── Route Registration ────────────────────────────────────────

/**
 * Register admin/monitoring route handlers.
 * Call after registerApiRoutes but before inline handlers.
 * Returns true if the request was handled.
 */
export async function registerAdminRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AdminRouteContext,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return true;
  }

  // ── Auth gate ─────────────────────────────────────────────
  // Protect admin routes with session-based auth.
  // Localhost (127.0.0.1, ::1) requests are always allowed — no auth needed.
  // First-run (no token set) → redirect to /setup for remote visitors.
  const clientAddr = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const isLocal = clientAddr === '127.0.0.1' || clientAddr === '::1' || clientAddr === 'localhost';
  const hasToken = isTokenSet();
  const isPublic =
    pathname === '/api/auth/check' ||
    isLocal ||
    (!hasToken && (pathname === '/setup' || pathname === '/api/auth/setup')) ||
    (hasToken && (pathname === '/login' || pathname === '/api/auth/login'));

  if (!isPublic && isAuthEnabled()) {
    if (!hasToken) {
      if (pathname.startsWith('/api/')) {
        json(res, 403, { error: 'Setup required', message: '请先设置访问密钥' });
      } else {
        res.writeHead(302, { 'Location': '/setup' });
        res.end();
      }
      return true;
    }
    const authResult = checkAuth(req);
    if (!authResult.authenticated) {
      if (pathname.startsWith('/api/')) {
        json(res, 401, { error: 'Unauthorized', message: '请先登录' });
      } else {
        res.writeHead(302, { 'Location': '/login' });
        res.end();
      }
      return true;
    }
  }

  try {
    switch (pathname) {
      // ── Auth routes ──────────────────────────────────────
      case '/setup': {
        if (isTokenSet()) {
          res.writeHead(302, { 'Location': '/login' });
          res.end();
          return true;
        }
        // Local access → skip setup, go straight to app
        if (isLocal) {
          const OUT_DIR = join(process.cwd(), 'out');
          const consoleIndex = join(OUT_DIR, 'index.html');
          res.writeHead(302, { 'Location': existsSync(consoleIndex) ? '/' : 'http://localhost:3000' });
          res.end();
          return true;
        }
        const error = url.searchParams.get('error') || undefined;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(setupPageHtml(error));
        return true;
      }

      case '/api/auth/setup': {
        if (isTokenSet()) {
          json(res, 403, { error: 'Token already set' });
          return true;
        }
        if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return true; }
        const body1 = await readBody(req);
        let password: string | null = null;
        let confirm: string | null = null;
        if (body1.startsWith('{')) {
          try {
            const data = JSON.parse(body1);
            password = data.password;
            confirm = data.confirm;
          } catch { /* fall through */ }
        } else {
          const params = new URLSearchParams(body1);
          password = params.get('password');
          confirm = params.get('confirm');
        }
        if (!password) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(setupPageHtml('请输入访问密钥'));
          return true;
        }
        if (password.length < 8) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(setupPageHtml('密钥长度至少 8 个字符'));
          return true;
        }
        if (password !== confirm) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(setupPageHtml('两次输入的密钥不一致'));
          return true;
        }
        changePassword(password);
        setAuthEnabled(true);
        persistToken(password);
        ctx.addLog('[auth] Initial password set — admin secured');
        console.log(`[auth] Admin token set by user. Use this to log in from other devices.`);
        const ua = req.headers['user-agent'] || undefined;
        const { cookie } = createSession(ua);
        res.writeHead(302, { 'Location': '/', 'Set-Cookie': cookie });
        res.end();
        return true;
      }

      case '/login': {
        // Local access → skip login, go straight to app
        if (isLocal) {
          const OUT_DIR = join(process.cwd(), 'out');
          const consoleIndex = join(OUT_DIR, 'index.html');
          res.writeHead(302, { 'Location': existsSync(consoleIndex) ? '/' : 'http://localhost:3000' });
          res.end();
          return true;
        }
        const error = url.searchParams.get('error') || undefined;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(loginPageHtml(error));
        return true;
      }

      case '/api/auth/login': {
        if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return true; }
        const body2 = await readBody(req);
        let submittedToken: string | null = null;
        if (body2.startsWith('{')) {
          try { submittedToken = JSON.parse(body2).token; } catch { /* fall through */ }
        } else {
          const params = new URLSearchParams(body2);
          submittedToken = params.get('token');
        }
        if (!submittedToken) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(loginPageHtml('请输入访问密钥'));
          return true;
        }
        const currentToken = getToken();
        if (!currentToken || submittedToken !== currentToken) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(loginPageHtml('密钥错误，请重试'));
          return true;
        }
        const ua2 = req.headers['user-agent'] || undefined;
        const { cookie } = createSession(ua2);
        ctx.addLog('[auth] Login succeeded');
        res.writeHead(302, { 'Location': '/', 'Set-Cookie': cookie });
        res.end();
        return true;
      }

      case '/api/auth/logout': {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return true; }
        const cookie2 = parseAuthCookie(req);
        if (cookie2) revokeSession(cookie2.sessionId);
        ctx.addLog('[auth] Logout');
        res.writeHead(200, {
          'Set-Cookie': 'sb_session=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/',
        });
        json(res, 200, { ok: true });
        return true;
      }

      case '/api/auth/sessions': {
        if (req.method === 'DELETE') {
          const sid = url.searchParams.get('id');
          if (!sid) { json(res, 400, { error: 'Missing session id' }); return true; }
          revokeSession(sid);
          ctx.addLog(`[auth] Session revoked: ${sid.slice(0, 8)}…`);
          json(res, 200, { ok: true });
          return true;
        }
        const all = listSessions();
        json(res, 200, all.map(s => ({
          id: s.id.slice(0, 16) + '…',
          createdAt: new Date(s.createdAt).toISOString(),
          expiresAt: new Date(s.expiresAt).toISOString(),
          userAgent: s.userAgent || '(unknown)',
        })));
        return true;
      }

      case '/api/auth/change-password': {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return true; }
        const body3 = await readBody(req);
        let oldToken: string, newToken: string;
        try {
          const data = JSON.parse(body3);
          oldToken = data.oldToken;
          newToken = data.newToken;
        } catch {
          json(res, 400, { error: 'Invalid JSON' });
          return true;
        }
        if (!oldToken || !newToken) {
          json(res, 400, { error: 'Missing oldToken or newToken' });
          return true;
        }
        const current = getToken();
        if (oldToken !== current) {
          json(res, 403, { error: 'Current password is incorrect' });
          return true;
        }
        if (newToken.length < 8) {
          json(res, 400, { error: 'New password must be at least 8 characters' });
          return true;
        }
        changePassword(newToken);
        persistToken(newToken);
        ctx.addLog('[auth] Password changed — all sessions invalidated');
        json(res, 200, { ok: true, message: '密码已更改，所有会话已失效' });
        return true;
      }

      case '/api/auth/check': {
        // Local access is always authenticated
        if (isLocal) {
          json(res, 200, { authenticated: true, authEnabled: isAuthEnabled(), tokenSet: isTokenSet(), local: true });
          return true;
        }
        const authResult = checkAuth(req);
        json(res, 200, {
          authenticated: authResult.authenticated,
          authEnabled: isAuthEnabled(),
          tokenSet: isTokenSet(),
          session: authResult.session ? {
            createdAt: new Date(authResult.session.createdAt).toISOString(),
            expiresAt: new Date(authResult.session.expiresAt).toISOString(),
          } : null,
        });
        return true;
      }

      case '/api/auth/toggle': {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return true; }
        const body4 = await readBody(req);
        let enabled: boolean;
        try {
          enabled = JSON.parse(body4).enabled;
        } catch {
          json(res, 400, { error: 'Missing "enabled" field' });
          return true;
        }
        setAuthEnabled(enabled);
        ctx.addLog(`[auth] Authentication ${enabled ? 'enabled' : 'disabled'}`);
        json(res, 200, { ok: true, authEnabled: enabled });
        return true;
      }

      // ── Main status routes ─────────────────────────────────
      case '/':
      case '/index.html': {
        const OUT_DIR = join(process.cwd(), 'out');
        const consoleIndex = join(OUT_DIR, 'index.html');
        if (existsSync(consoleIndex)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(readFileSync(consoleIndex));
        } else if (isLocal) {
          // Dev mode — redirect to Next.js dev server
          res.writeHead(302, { 'Location': 'http://localhost:3000' });
          res.end();
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(dashboardHtml(ctx.nodeLabel));
        }
        return true;
      }

      case '/api/status': {
        json(res, 200, {
          version: VERSION,
          label: ctx.nodeLabel,
          pid: process.pid,
          uptime: (Date.now() - ctx.nodeStartTime) / 1000,
          system: getSystemState(),
          adapters: ctx.adapters,
          permissions: ctx.permissions.grants ?? {},
          notifications: ctx.notifications?.toJSON() ?? { scenarios: [], settings: {} },
        });
        return true;
      }

      case '/api/system': {
        json(res, 200, getSystemState());
        return true;
      }

      case '/api/processes': {
        const sortBy = (url.searchParams.get('sort') as 'cpu' | 'memory' | 'pid') || undefined;
        const limit = parseInt(url.searchParams.get('limit') || '', 10) || undefined;
        if (sortBy) {
          json(res, 200, listProcessesSorted(sortBy, limit ?? 50));
        } else {
          json(res, 200, listProcesses());
        }
        return true;
      }

      case '/api/permissions': {
        if (req.method === 'POST') {
          const body5 = await readBody(req);
          const { category, value } = JSON.parse(body5);
          if (category && typeof value === 'boolean') {
            ctx.permissions.set(category, value);
            ctx.addLog(`[permissions] ${category} = ${value}`);
          }
          json(res, 200, { ok: true, grants: ctx.permissions.grants });
        } else {
          json(res, 200, ctx.permissions.grants);
        }
        return true;
      }

      case '/api/notifications': {
        const nm = ctx.notifications;
        if (!nm) {
          json(res, 200, { scenarios: [], settings: {} });
          return true;
        }
        if (req.method === 'POST') {
          const body6 = await readBody(req);
          const { scenarioId, value } = JSON.parse(body6);
          if (scenarioId && typeof value === 'boolean') {
            nm.set(scenarioId, value);
            ctx.addLog(`[notifications] ${scenarioId} = ${value}`);
          }
          json(res, 200, nm.toJSON());
        } else {
          json(res, 200, nm.toJSON());
        }
        return true;
      }

      // ── Ad-hoc shell routes ───────────────────────────────
      case '/api/shell/run': {
        if (req.method !== 'POST') { res.writeHead(405); res.end('Method Not Allowed'); return true; }
        const body7 = await readBody(req);
        const { command, cwd } = JSON.parse(body7);
        if (!command) { json(res, 400, { error: 'Missing command' }); return true; }
        const permCheck = ctx.permissions.check('shellAccess', { command });
        if (!permCheck.allowed) {
          json(res, 403, { error: permCheck.reason || 'Permission denied: shellAccess' });
          return true;
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
        ctx.shellInstances.set(instanceId, entry);

        // Forward to relay-connected nodes if applicable
        const relay = ctx.relayConnection;
        if (relay) {
          const requestId = instanceId;
          const onSpawned = (rid: string, relayId: string) => {
            if (rid !== requestId) return;
            relay.removeListener('instanceSpawned', onSpawned);
            entry.relayInstanceId = relayId;
            ctx.relayToShellId.set(relayId, instanceId);
            ctx.addLog(`[shell:run] ${instanceId} relay=${relayId}`);
          };
          relay.on('instanceSpawned', onSpawned);
          relay.sendInstanceSpawn(requestId, command.slice(0, 50), cwd || process.cwd(), command);
        }

        const broadcast = (data: string, stream: 'stdout' | 'stderr') => {
          const sseData = `data:${JSON.stringify({ stream, data })}\n\n`;
          for (const c of entry.sseClients) {
            try { c.write(sseData); } catch { entry.sseClients.delete(c); }
          }
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
            ctx.relayToShellId.delete(entry.relayInstanceId);
          }
          const exitData = `data:${JSON.stringify({ type: 'exit', code })}\n\n`;
          for (const c of entry.sseClients) {
            try { c.write(exitData); c.end(); } catch { /* ignore */ }
          }
          setTimeout(() => { ctx.shellInstances.delete(instanceId); }, 5000);
        });

        ctx.addLog(`[shell:run] ${instanceId} pid=${proc.pid} cmd=${command.slice(0, 60)}`);
        json(res, 200, { instanceId, pid: proc.pid });
        return true;
      }

      case '/api/shell/stream': {
        const id = url.searchParams.get('id');
        if (!id) { json(res, 400, { error: 'Missing id' }); return true; }
        const entry = ctx.shellInstances.get(id);
        if (!entry) { json(res, 404, { error: 'Instance not found' }); return true; }
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
          return true;
        }
        const keepalive = setInterval(() => {
          try { res.write(':keepalive\n\n'); } catch { clearInterval(keepalive); }
        }, 15000);
        req.on('close', () => {
          clearInterval(keepalive);
          entry.sseClients.delete(res);
        });
        return true;
      }

      case '/api/shell/input': {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return true; }
        const body8 = await readBody(req);
        const { instanceId, data } = JSON.parse(body8);
        const entry2 = ctx.shellInstances.get(instanceId);
        if (!entry2 || !entry2.proc.stdin?.writable) { json(res, 404, { error: 'Instance not found or stdin closed' }); return true; }
        entry2.proc.stdin.write(data);
        json(res, 200, { ok: true });
        return true;
      }

      case '/api/shell/kill': {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return true; }
        const body9 = await readBody(req);
        const { instanceId } = JSON.parse(body9);
        const entry3 = ctx.shellInstances.get(instanceId);
        if (!entry3) { json(res, 404, { error: 'Instance not found' }); return true; }
        entry3.proc.kill();
        json(res, 200, { ok: true });
        return true;
      }

      case '/api/logs':
        json(res, 200, ctx.logs.slice(-50));
        return true;

      // ── Extensions (dev mode) ─────────────────────────────
      case '/api/extensions': {
        const extHost = ctx.extensionHost;
        if (!extHost) {
          json(res, 200, { enabled: false, state: 'disabled' });
          return true;
        }
        if (req.method === 'POST') {
          const body10 = await readBody(req);
          const { action } = JSON.parse(body10);
          if (action === 'reload') {
            ctx.addLog('[extensions] Reload requested via API');
            extHost.reload().catch((err: Error) => ctx.addLog(`[extensions] Reload failed: ${err.message}`));
            json(res, 200, { ok: true, message: 'Reloading...' });
          } else {
            json(res, 400, { error: `Unknown action: ${action}` });
          }
        } else {
          const info = extHost.getInfo() as Record<string, unknown>;
          info.configurations = extensionPoints.getConfigSchemas();
          json(res, 200, info);
        }
        return true;
      }

      // ── Relay connect management ──────────────────────────
      case '/api/connect': {
        if (req.method === 'POST') {
          const body11 = await readBody(req);
          const { relayUrl, token, disconnect } = JSON.parse(body11);
          const relay = ctx.relayConnection;
          if (!relay) { json(res, 503, { error: 'Relay connection not available' }); return true; }

          if (disconnect || !relayUrl) {
            ctx.addLog('[connect] Disconnecting from upstream...');
            await relay.shutdown();
            (relay as any).config.upstreamRelay = '';
            persistUpstreamRelay(''); // clear persisted config
            json(res, 200, { ok: true, relayUrl: '', message: 'Disconnected' });
          } else {
            ctx.addLog(`[connect] Connecting to ${relayUrl}...`);
            if (token) ctx.addLog(`[connect] Token set`);
            await relay.shutdown();
            (relay as any).config.upstreamRelay = relayUrl;
            persistUpstreamRelay(relayUrl); // persist for auto-connect on restart
            relay.connect();
            json(res, 200, { ok: true, relayUrl, message: 'Reconnecting...' });
          }
          return true;
        } else {
          const relay = ctx.relayConnection;
          const upstreamRelay = relay ? (relay as any).config?.upstreamRelay || '' : '';
          const token = ctx.relayToken || '';
          json(res, 200, {
            relayUrl: upstreamRelay,
            token: token ? token.slice(0, 8) + '…' : '(none)',
            command: upstreamRelay ? `bridge connect ${upstreamRelay}${token ? ` --token ${token.slice(0, 16)}…` : ''}` : 'bridge (default)',
            role: ctx.role || 'auto',
          });
          return true;
        }
      }

      // ── Daemon stop ──────────────────────────────────────
      case '/api/daemon/stop': {
        if (req.method !== 'POST') { res.writeHead(405); res.end(); return true; }
        json(res, 200, { ok: true, message: 'Shutting down...' });
        ctx.addLog('[daemon] Stop requested via API');
        ctx.onShutdown?.();
        setTimeout(() => { process.exit(0); }, 200);
        return true;
      }

      // ── QR Code page ──────────────────────────────────────
      case '/qr': {
        const relay = ctx.relayConnection;
        const token = url.searchParams.get('token') || ctx.relayToken || '';
        const relayUrl = url.searchParams.get('url') || (relay ? (relay as any).config?.upstreamRelay || `ws://127.0.0.1:${ctx.relayPort}` : `ws://127.0.0.1:${ctx.relayPort}`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(qrPage(relayUrl, token));
        return true;
      }

      // ── Node External Access ──────────────────────────────
      case '/api/node/external': {
        if (req.method === 'GET') {
          const hasToken = !!ctx.relayToken;
          const result = detectNetwork(ctx.relayPort, hasToken);
          json(res, 200, result);
          return true;
        }
        if (req.method === 'POST') {
          const body12 = await readBody(req);
          const { enable } = JSON.parse(body12);
          const bind = enable ? '0.0.0.0' : '127.0.0.1';
          ctx.addLog(`[external] Toggling: ${enable ? 'ON' : 'OFF'} → bind: ${bind}`);
          if (ctx.onToggleExternalAccess) {
            await ctx.onToggleExternalAccess(enable);
          }
          json(res, 200, {
            enabled: enable,
            bind,
            port: ctx.relayPort,
            message: enable
              ? `对外访问已开启: http://${bind}:${ctx.relayPort}`
              : '对外访问已关闭',
          });
          return true;
        }
        json(res, 405, { error: 'Method not allowed' });
        return true;
      }

      default:
        return false;
    }
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    return true;
  }
}
