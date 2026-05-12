// ─── Dashboard Auth ─────────────────────────────────────────────
// Session-based authentication for the dashboard HTTP server.
// Uses HMAC-signed cookies with a configurable TTL (default 14 days).
// Sessions are persisted to disk so they survive restarts.

import { createHmac, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import type { IncomingMessage } from 'http';
import { configDir } from './config';

// ── Types ──────────────────────────────────────────────────────

export interface DashboardSession {
  id: string;
  createdAt: number;
  expiresAt: number;
  userAgent?: string;
}

interface SessionsFile {
  version: 1;
  sessions: DashboardSession[];
}

// ── Store ──────────────────────────────────────────────────────

const sessions = new Map<string, DashboardSession>();

function sessionsPath(): string {
  return join(configDir(), 'dashboard-sessions.json');
}

function loadSessions(): void {
  try {
    const path = sessionsPath();
    if (!existsSync(path)) return;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as SessionsFile;
    const now = Date.now();
    for (const s of raw.sessions) {
      if (s.expiresAt > now) {
        sessions.set(s.id, s);
      }
    }
  } catch { /* corrupt or missing — start fresh */ }
}

function persistSessions(): void {
  try {
    const path = sessionsPath();
    mkdirSync(dirname(path), { recursive: true });
    const data: SessionsFile = {
      version: 1,
      sessions: Array.from(sessions.values()),
    };
    writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
  } catch { /* best effort */ }
}

// ── HMAC helpers ───────────────────────────────────────────────

function sign(sessionId: string, secret: string): string {
  return createHmac('sha256', secret).update(sessionId).digest('hex');
}

function verify(sessionId: string, signature: string, secret: string): boolean {
  try {
    return sign(sessionId, secret) === signature;
  } catch {
    return false;
  }
}

// ── Public API ─────────────────────────────────────────────────

let token: string | null = null;
let sessionTtl: number = 1209600; // 14 days default
let authEnabled: boolean = true;

/** Initialize auth with the dashboard token, auth toggle, and session TTL. */
export function initAuth(t: string, enabled?: boolean, ttl?: number): void {
  token = t;
  if (enabled !== undefined) authEnabled = enabled;
  if (ttl) sessionTtl = ttl;
  loadSessions();
}

/** Whether authentication is currently enabled. */
export function isAuthEnabled(): boolean {
  return authEnabled;
}

/** Enable or disable authentication at runtime. */
export function setAuthEnabled(enabled: boolean): void {
  authEnabled = enabled;
}

/** Generate a new random token (32 hex chars). */
export function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/** Get the current dashboard token. */
export function getToken(): string | null {
  return token;
}

/** Whether a dashboard token has been set. */
export function isTokenSet(): boolean {
  return !!token;
}

// ── Session management ─────────────────────────────────────────

export function createSession(userAgent?: string): { sessionId: string; cookie: string; expiresAt: number } {
  if (!token) throw new Error('Auth not initialized');
  const sessionId = randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + sessionTtl * 1000;
  const session: DashboardSession = {
    id: sessionId,
    createdAt: now,
    expiresAt,
    userAgent,
  };
  sessions.set(sessionId, session);
  persistSessions();

  const signature = sign(sessionId, token);
  const maxAge = sessionTtl;
  const cookie = `sb_session=${sessionId}.${signature}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Path=/`;

  return { sessionId, cookie, expiresAt };
}

export function validateSession(sessionId: string, signature: string): DashboardSession | null {
  if (!token) return null;
  if (!verify(sessionId, signature, token)) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    persistSessions();
    return null;
  }
  return session;
}

export function revokeSession(sessionId: string): boolean {
  const removed = sessions.delete(sessionId);
  if (removed) persistSessions();
  return removed;
}

export function listSessions(): DashboardSession[] {
  // Clean expired
  const now = Date.now();
  let cleaned = false;
  for (const [id, s] of sessions) {
    if (now > s.expiresAt) {
      sessions.delete(id);
      cleaned = true;
    }
  }
  if (cleaned) persistSessions();
  return Array.from(sessions.values());
}

export function changePassword(newToken: string): void {
  token = newToken;
  sessions.clear();
  persistSessions();
}

// ── Cookie parsing ─────────────────────────────────────────────

const COOKIE_RE = /sb_session=([^;]+)/;

export function parseAuthCookie(req: IncomingMessage): { sessionId: string; signature: string } | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const m = cookieHeader.match(COOKIE_RE);
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 2) return null;
  return { sessionId: parts[0], signature: parts[1] };
}

export function parseBearerToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

// ── Auth check (for middleware) ────────────────────────────────

export interface AuthResult {
  authenticated: boolean;
  session?: DashboardSession;
}

export function checkAuth(req: IncomingMessage): AuthResult {
  // Try cookie first
  const cookie = parseAuthCookie(req);
  if (cookie) {
    const session = validateSession(cookie.sessionId, cookie.signature);
    if (session) return { authenticated: true, session };
  }
  // Then Bearer token
  const bearer = parseBearerToken(req);
  if (bearer && token && bearer === token) {
    return { authenticated: true };
  }
  return { authenticated: false };
}

// ── Login page ─────────────────────────────────────────────────

export function loginPageHtml(error?: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>SessionBridge — 登录</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0d1117; color: #c9d1d9;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 24px;
  }
  .card {
    background: #161b22; border: 1px solid #30363d;
    border-radius: 12px; padding: 32px; max-width: 380px; width: 100%;
    text-align: center;
  }
  h1 { font-size: 1.25rem; margin-bottom: 4px; color: #58a6ff; }
  .sub { font-size: 0.8rem; color: #8b949e; margin-bottom: 24px; }
  .field { margin-bottom: 16px; text-align: left; }
  .field label { display: block; font-size: 0.8rem; color: #8b949e; margin-bottom: 4px; }
  .field input {
    width: 100%; padding: 10px 12px; border-radius: 6px;
    border: 1px solid #30363d; background: #0d1117; color: #c9d1d9;
    font-size: 0.95rem; font-family: Menlo, Monaco, monospace;
    outline: none; transition: border-color .15s;
  }
  .field input:focus { border-color: #58a6ff; }
  .btn {
    width: 100%; padding: 10px; border-radius: 6px; border: none;
    background: #238636; color: #fff; font-size: 0.95rem; font-weight: 500;
    cursor: pointer; transition: background .15s;
  }
  .btn:hover { background: #2ea043; }
  .btn:active { background: #196c2e; }
  .error {
    background: rgba(248,81,73,.1); border: 1px solid rgba(248,81,73,.3);
    color: #f85149; padding: 8px 12px; border-radius: 6px;
    font-size: 0.8rem; margin-bottom: 16px;
  }
  .hint {
    margin-top: 16px; font-size: 0.75rem; color: #8b949e;
    line-height: 1.5;
  }
  .hint code {
    background: #21262d; padding: 1px 5px; border-radius: 3px;
    font-family: Menlo, Monaco, monospace; font-size: 0.8em;
  }
</style>
</head>
<body>
<div class="card">
  <h1>SessionBridge</h1>
  <p class="sub">输入访问密钥以继续</p>
  ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
  <form method="post" action="/api/auth/login">
    <div class="field">
      <label for="token">访问密钥</label>
      <input id="token" name="token" type="password" autocomplete="off" placeholder="输入 dashboard token…" autofocus>
    </div>
    <button class="btn" type="submit">登录</button>
  </form>
  <p class="hint">
    密钥在节点首次启动时自动生成，可在日志或配置文件<br>
    <code>~/.sessionbridge/session-bridge/agent.json</code> 中查看
  </p>
</div>
</body>
</html>`;
}

// ── Setup page (first-run, no token set yet) ──────────────────

export function setupPageHtml(error?: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>SessionBridge — 设置访问密钥</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0d1117; color: #c9d1d9;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 24px;
  }
  .card {
    background: #161b22; border: 1px solid #30363d;
    border-radius: 12px; padding: 32px; max-width: 380px; width: 100%;
    text-align: center;
  }
  h1 { font-size: 1.25rem; margin-bottom: 4px; color: #58a6ff; }
  .sub { font-size: 0.8rem; color: #8b949e; margin-bottom: 24px; }
  .field { margin-bottom: 14px; text-align: left; }
  .field label { display: block; font-size: 0.8rem; color: #8b949e; margin-bottom: 4px; }
  .field input {
    width: 100%; padding: 10px 12px; border-radius: 6px;
    border: 1px solid #30363d; background: #0d1117; color: #c9d1d9;
    font-size: 0.95rem; outline: none; transition: border-color .15s;
  }
  .field input:focus { border-color: #58a6ff; }
  .btn {
    width: 100%; padding: 10px; border-radius: 6px; border: none;
    background: #238636; color: #fff; font-size: 0.95rem; font-weight: 500;
    cursor: pointer; transition: background .15s;
  }
  .btn:hover { background: #2ea043; }
  .btn:active { background: #196c2e; }
  .error {
    background: rgba(248,81,73,.1); border: 1px solid rgba(248,81,73,.3);
    color: #f85149; padding: 8px 12px; border-radius: 6px;
    font-size: 0.8rem; margin-bottom: 16px; text-align: left;
  }
  .hint {
    margin-top: 16px; font-size: 0.75rem; color: #8b949e;
    line-height: 1.5;
  }
</style>
</head>
<body>
<div class="card">
  <h1>SessionBridge</h1>
  <p class="sub">首次使用，请设置访问密钥</p>
  ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
  <form method="post" action="/api/auth/setup">
    <div class="field">
      <label for="password">访问密钥</label>
      <input id="password" name="password" type="password" autocomplete="new-password" placeholder="至少 8 个字符…" autofocus>
    </div>
    <div class="field">
      <label for="confirm">确认密钥</label>
      <input id="confirm" name="confirm" type="password" autocomplete="new-password" placeholder="再次输入以确认">
    </div>
    <button class="btn" type="submit">设置密钥</button>
  </form>
  <p class="hint">
    设置后将使用此密钥登录仪表盘。<br>
    请妥善保管，密钥会存储在配置文件中。
  </p>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
