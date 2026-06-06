// ─── Server State ──────────────────────────────────────────────
// Machine-level state that the UI needs before Core is running.
// Stored in ~/.sessionbridge/server-state.json.
//
// Core binary path, last known port, etc. — all independent of
// which user is logged in.
//
// This file is server-side only (uses fs). Do not import from
// client components.

import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { getServerStateFile, ensureParentDir } from './paths';

export interface ServerState {
  /** Path to the Core binary (e.g. /usr/local/bin/sessionnode). */
  coreBinaryPath: string | null;
  /** Unix ms timestamp when the binary was last verified as present. */
  coreBinaryLastFound: number | null;
  /** Last known Core WebSocket port (default 9090). */
  lastCorePort: number;
  /** Last known Core WebSocket URL (derived from port). */
  lastCoreUrl: string | null;
}

const DEFAULTS: ServerState = {
  coreBinaryPath: null,
  coreBinaryLastFound: null,
  lastCorePort: 9090,
  lastCoreUrl: null,
};

/** Read the full server state. Returns defaults on missing/corrupt file. */
export function readServerState(): ServerState {
  try {
    const file = getServerStateFile();
    if (!existsSync(file)) return { ...DEFAULTS };
    const raw = readFileSync(file, 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Write a partial server state (merges into existing). */
export function writeServerState(partial: Partial<ServerState>): ServerState {
  const current = readServerState();
  const next: ServerState = { ...current, ...partial };

  const file = getServerStateFile();
  ensureParentDir(file);
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
  renameSync(tmp, file);
  return next;
}

/** Convenience: set the Core binary path and mark it as last-found-now. */
export function setCoreBinaryPath(path: string | null): ServerState {
  return writeServerState({
    coreBinaryPath: path,
    coreBinaryLastFound: path ? Date.now() : null,
  });
}

/** Convenience: set the last known Core port (updates URL too). */
export function setLastCorePort(port: number): ServerState {
  return writeServerState({
    lastCorePort: port,
    lastCoreUrl: `ws://localhost:${port}/ws`,
  });
}
