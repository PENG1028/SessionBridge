// ─── App UI Auth Config — Server-Only ──────────────────────────
// Handles password setup, verification, and session token management
// for the App UI's public access control layer.
//
// This is server-side code only. It uses Node crypto (scrypt, HMAC).
// Never import in client components.

import { scryptSync, randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';

// ─── Types ─────────────────────────────────────────────────────

export interface AppUiAuthConfig {
  version: 1;
  passwordHash: string;      // scrypt hex output
  passwordSalt: string;       // base64
  sessionSecret: string;      // base64
  sessionTtlSeconds: number;  // default 86400 (1 day)
  createdAt: string;          // ISO 8601
  updatedAt: string;          // ISO 8601
}

export interface SessionPayload {
  sid: string;       // random session id
  iat: number;       // issued at (unix ms)
  exp: number;       // expires at (unix ms)
}

export interface SessionResult {
  ok: true;
  payload: SessionPayload;
}

export interface SessionError {
  ok: false;
  reason: 'missing' | 'malformed' | 'expired' | 'invalid';
}

// ─── Config Path ───────────────────────────────────────────────
// Default: ~/.sessionbridge/app-ui-auth.json
// Override via SESSIONBRIDGE_APP_UI_AUTH_FILE env (used in e2e tests).

import { getAuthFile } from '../server-state/paths';

function getAuthFilePath(): string {
  return getAuthFile();
}

// ─── Helpers ───────────────────────────────────────────────────

const SCRYPT_KEYLEN = 64;
const SCRYPT_N = 16384;   // ~0.1s on modern hardware
const SCRYPT_R = 8;
const SCRYPT_P = 1;

function hashPassword(password: string, salt: string): string {
  const buf = scryptSync(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P } as any);
  return buf.toString('hex');
}

function generateSalt(): string {
  return randomBytes(32).toString('base64');
}

function generateSessionId(): string {
  return randomBytes(16).toString('hex');
}

// ─── Public API ────────────────────────────────────────────────

/** Check whether the auth config file exists on disk. */
export async function isAuthConfigured(): Promise<boolean> {
  const p = getAuthFilePath();
  try {
    await access(p);
    return true;
  } catch (_e) {
    return false;
  }
}

/** Load and parse the auth config file. Returns null if missing or corrupt. */
export async function loadAuthConfig(): Promise<AppUiAuthConfig | null> {
  const p = getAuthFilePath();
  try {
    const raw = await readFile(p, 'utf-8');
    const parsed = JSON.parse(raw) as AppUiAuthConfig;
    if (!parsed.passwordHash || !parsed.passwordSalt || !parsed.sessionSecret) return null;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch (_e) {
    return null;
  }
}

/**
 * Create a new auth config with the given password.
 * Rejects if the file already exists (use force = true to overwrite).
 * Password must be at least 8 characters.
 */
export async function createAuthConfig(password: string, force = false): Promise<AppUiAuthConfig> {
  if (!password || password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  if (!force) {
    const exists = await isAuthConfigured();
    if (exists) {
      throw new Error('Auth already configured. Use force = true to overwrite.');
    }
  }

  const salt = generateSalt();
  const hash = hashPassword(password, salt);
  const secret = randomBytes(32).toString('base64');
  const now = new Date().toISOString();

  const config: AppUiAuthConfig = {
    version: 1,
    passwordHash: hash,
    passwordSalt: salt,
    sessionSecret: secret,
    sessionTtlSeconds: 86400,
    createdAt: now,
    updatedAt: now,
  };

  const p = getAuthFilePath();
  const dir = dirname(p);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
  }

  await writeFile(p, JSON.stringify(config, null, 2), { mode: 0o600 });
  return config;
}

/** Verify a password against the on-disk auth config. */
export async function verifyPassword(password: string): Promise<boolean> {
  const config = await loadAuthConfig();
  if (!config || !password) return false;

  const hash = hashPassword(password, config.passwordSalt);
  // timing-safe compare to prevent timing attacks
  const hashBuf = Buffer.from(hash, 'hex');
  const storedBuf = Buffer.from(config.passwordHash, 'hex');
  if (hashBuf.length !== storedBuf.length) return false;

  try {
    return timingSafeEqual(hashBuf, storedBuf);
  } catch (_e) {
    return false;
  }
}

/** Sign a session payload, returning a cookie-safe token string. */
export function signSession(payload: SessionPayload, secret: string): string {
  const data = JSON.stringify(payload);
  const b64 = Buffer.from(data).toString('base64url');
  const sig = createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(b64)
    .digest()
    .toString('base64url');
  return `v1.${b64}.${sig}`;
}

/**
 * Verify and decode a session token.
 * Returns the payload if valid, or an error reason if not.
 */
export function verifySession(cookieValue: string | undefined, secret: string): SessionResult | SessionError {
  if (!cookieValue) {
    return { ok: false, reason: 'missing' };
  }

  const parts = cookieValue.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') {
    return { ok: false, reason: 'malformed' };
  }

  const b64 = parts[1];
  const sig = parts[2];

  // Verify signature
  const expectedSig = createHmac('sha256', Buffer.from(secret, 'base64'))
    .update(b64)
    .digest()
    .toString('base64url');

  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return { ok: false, reason: 'invalid' };
  }

  // Decode payload
  let payload: SessionPayload;
  try {
    const json = Buffer.from(b64, 'base64url').toString('utf-8');
    payload = JSON.parse(json) as SessionPayload;
  } catch (_e) {
    return { ok: false, reason: 'malformed' };
  }

  if (!payload.sid || !payload.iat || !payload.exp) {
    return { ok: false, reason: 'malformed' };
  }

  // Check expiry
  if (Date.now() > payload.exp) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, payload };
}

/**
 * Create a new session token for the given config.
 * Returns the cookie value string.
 */
export function createSession(config: AppUiAuthConfig): string {
  const now = Date.now();
  const payload: SessionPayload = {
    sid: generateSessionId(),
    iat: now,
    exp: now + config.sessionTtlSeconds * 1000,
  };
  return signSession(payload, config.sessionSecret);
}

/** Get the session TTL in seconds from the config (default 86400). */
export async function getSessionTtlSeconds(): Promise<number> {
  const config = await loadAuthConfig();
  return config?.sessionTtlSeconds ?? 86400;
}

/**
 * Verify a session token from a cookie value.
 * Loads the auth config to get the secret.
 */
export async function verifySessionFromCookie(cookieValue: string | undefined): Promise<SessionResult | SessionError> {
  if (!cookieValue) {
    return { ok: false, reason: 'missing' };
  }

  const config = await loadAuthConfig();
  if (!config) {
    return { ok: false, reason: 'invalid' };
  }

  return verifySession(cookieValue, config.sessionSecret);
}
