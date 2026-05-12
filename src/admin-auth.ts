// ─── Admin Auth ─────────────────────────────────────────────
// Session-based authentication for admin API routes.
// Uses HMAC-signed cookies with a configurable TTL (default 14 days).
// Sessions are persisted to disk so they survive restarts.

import { createHmac, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import type { IncomingMessage } from 'http';
import { configDir } from '../agent-core/config';

// ── Types ──────────────────────────────────────────────────────

export interface AdminSession {
  id: string;
  createdAt: number;
  expiresAt: number;
  userAgent?: string;
}

interface SessionsFile {
  version: 1;
  sessions: AdminSession[];
}

// ── Store ──────────────────────────────────────────────────────

const sessions = new Map<string, AdminSession>();

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

/** Initialize auth with the admin token, auth toggle, and session TTL. */
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

/** Get the current admin token. */
export function getToken(): string | null {
  return token;
}

/** Whether an admin token has been set. */
export function isTokenSet(): boolean {
  return !!token;
}

// ── Session management ─────────────────────────────────────────

export function createSession(userAgent?: string): { sessionId: string; cookie: string; expiresAt: number } {
  if (!token) throw new Error('Auth not initialized');
  const sessionId = randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + sessionTtl * 1000;
  const session: AdminSession = {
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

export function validateSession(sessionId: string, signature: string): AdminSession | null {
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

export function listSessions(): AdminSession[] {
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
  session?: AdminSession;
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
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SessionBridge — 登录</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body {
    font-family: "Menlo", "Cascadia Code", "JetBrains Mono", "Fira Code", monospace;
    background: #0d0d0d; color: #c9d1d9;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 24px;
  }
  .wrap {
    max-width: 360px; width: 100%;
  }
  h1 {
    font-size: 1rem; font-weight: 500; color: #a78bfa;
    letter-spacing: .05em; margin-bottom: 4px;
    text-transform: uppercase;
  }
  h1::before { content: "> "; color: #22d3ee; }
  .sub {
    font-size: 0.75rem; color: #6b7280;
    margin-bottom: 28px; padding-left: 1.2em;
  }
  .field { margin-bottom: 14px; }
  .field input {
    width: 100%; padding: 10px 12px;
    background: #111; color: #e6edf3;
    border: 1px solid #222; border-radius: 0;
    font-size: 0.85rem; font-family: inherit;
    outline: none; transition: border-color .15s;
  }
  .field input:focus { border-color: #a78bfa; }
  .field input::placeholder { color: #333; }
  .btn {
    width: 100%; padding: 10px;
    background: transparent; color: #22d3ee;
    border: 1px solid #22d3ee; border-radius: 0;
    font-size: 0.8rem; font-family: inherit; cursor: pointer;
    text-transform: uppercase; letter-spacing: .05em;
    transition: all .15s;
  }
  .btn:hover { background: #22d3ee; color: #0d0d0d; }
  .error {
    color: #f87171; font-size: 0.75rem;
    margin-bottom: 14px; padding: 8px 10px;
    border: 1px solid rgba(248,113,113,.2);
    background: rgba(248,113,113,.05);
  }
  .hint {
    margin-top: 16px; font-size: 0.65rem; color: #444;
    line-height: 1.6;
  }
  .hint::before { content: "# "; color: #22d3ee; }
</style>
</head>
<body>
<div class="wrap">
  <h1>SessionBridge</h1>
  <p class="sub">输入访问密钥以继续</p>
  ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
  <form method="post" action="/api/auth/login">
    <div class="field">
      <input id="token" name="token" type="password" autocomplete="off" placeholder="访问密钥" autofocus>
    </div>
    <button class="btn" type="submit">登录</button>
  </form>
  <p class="hint">密钥在节点首次启动时自动生成，可在配置文件中查看</p>
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
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SessionBridge — 设置访问密钥</title>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body {
    font-family: "Menlo", "Cascadia Code", "JetBrains Mono", "Fira Code", monospace;
    background: #0d0d0d; color: #c9d1d9;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; padding: 24px;
  }
  .wrap {
    max-width: 360px; width: 100%;
  }
  h1 {
    font-size: 1rem; font-weight: 500; color: #a78bfa;
    letter-spacing: .05em; margin-bottom: 4px;
    text-transform: uppercase;
  }
  h1::before { content: "> "; color: #22d3ee; }
  .sub {
    font-size: 0.75rem; color: #6b7280;
    margin-bottom: 28px; padding-left: 1.2em;
  }
  .field { margin-bottom: 14px; }
  .field input {
    width: 100%; padding: 10px 12px;
    background: #111; color: #e6edf3;
    border: 1px solid #222; border-radius: 0;
    font-size: 0.85rem; font-family: inherit;
    outline: none; transition: border-color .15s;
  }
  .field input:focus { border-color: #a78bfa; }
  .field input::placeholder { color: #333; }
  .btn {
    width: 100%; padding: 10px;
    background: transparent; color: #22d3ee;
    border: 1px solid #22d3ee; border-radius: 0;
    font-size: 0.8rem; font-family: inherit; cursor: pointer;
    text-transform: uppercase; letter-spacing: .05em;
    transition: all .15s;
  }
  .btn:hover { background: #22d3ee; color: #0d0d0d; }
  .error {
    color: #f87171; font-size: 0.75rem;
    margin-bottom: 14px; padding: 8px 10px;
    border: 1px solid rgba(248,113,113,.2);
    background: rgba(248,113,113,.05);
  }
  .hint {
    margin-top: 16px; font-size: 0.65rem; color: #444;
    line-height: 1.6;
  }
  .hint::before { content: "# "; color: #22d3ee; }
</style>
</head>
<body>
<div class="wrap">
  <h1>SessionBridge</h1>
  <p class="sub">首次使用，请设置访问密钥</p>
  ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
  <form method="post" action="/api/auth/setup">
    <div class="field">
      <input id="password" name="password" type="password" autocomplete="new-password" placeholder="访问密钥（至少 8 位）" autofocus>
    </div>
    <div class="field">
      <input id="confirm" name="confirm" type="password" autocomplete="new-password" placeholder="再次输入以确认">
    </div>
    <button class="btn" type="submit">设置密钥</button>
  </form>
  <p class="hint">设置后将使用此密钥从远程设备登录。本机访问不需要密钥。</p>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
