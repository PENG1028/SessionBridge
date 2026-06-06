// ─── Server-Side Paths ──────────────────────────────────────────
// Centralized path resolution for all .sessionbridge/ state files.
// All files live under ~/.sessionbridge/ (user home directory),
// NOT the project root — this ensures persistence across deployments
// and keeps multi-user scope clean.
//
// Machine-level files: root of ~/.sessionbridge/
//   server-state.json       Core binary path, last port, etc.
//   installed-apps.json     Install tracking per plugin
//   install-history.json    Install operation history
//   app-ui-auth.json        Auth configuration
//
// User-level files: ~/.sessionbridge/users/<userId>/
//   app-state.json          Plugin enabled/disabled, grants
//
// Current default user is "system" (single-user mode). Multi-user
// isolation is a future layer — the path structure is ready for it.

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

/** Root directory: ~/.sessionbridge/. Override via SESSIONBRIDGE_DATA_DIR env. */
function baseDir(): string {
  return process.env.SESSIONBRIDGE_DATA_DIR || join(homedir(), '.sessionbridge');
}

/**
 * Ensure a directory exists (idempotent). Call this only when
 * about to write — not on every path read.
 */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ─── Machine-level paths ───────────────────────────────────────

/** server-state.json — Core binary path, last port, etc. */
export function getServerStateFile(): string {
  return join(baseDir(), 'server-state.json');
}

/** installed-apps.json — per-plugin install tracking (binary, version, path). */
export function getInstalledAppsFile(): string {
  return join(baseDir(), 'installed-apps.json');
}

/** install-history.json — install operation logs. */
export function getInstallHistoryFile(): string {
  return join(baseDir(), 'install-history.json');
}

/** app-ui-auth.json — auth configuration. Override via SESSIONBRIDGE_APP_UI_AUTH_FILE env. */
export function getAuthFile(): string {
  return process.env.SESSIONBRIDGE_APP_UI_AUTH_FILE || join(baseDir(), 'app-ui-auth.json');
}

// ─── User-level paths (single-user default: "system") ─────────

const DEFAULT_USER_ID = 'system';

/** users/<userId>/ directory. Defaults to "system" when no userId given. */
export function getUserDir(userId: string = DEFAULT_USER_ID): string {
  return join(baseDir(), 'users', userId);
}

/** app-state.json — per-app enabled/disabled + grants for a given user. */
export function getAppStateFile(userId: string = DEFAULT_USER_ID): string {
  return join(getUserDir(userId), 'app-state.json');
}

// ─── Directory ensure helpers (call only on write) ────────────

/** Ensure the base ~/.sessionbridge/ directory exists. */
export function ensureBaseDir(): string {
  const dir = baseDir();
  ensureDir(dir);
  return dir;
}

/** Ensure a user-level directory exists. */
export function ensureUserDir(userId: string = DEFAULT_USER_ID): string {
  const dir = getUserDir(userId);
  ensureDir(dir);
  return dir;
}

/** Ensure any parent directory for a given file path exists. */
export function ensureParentDir(filePath: string): void {
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  if (dir) ensureDir(dir);
}
