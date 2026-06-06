// ─── Dynamic Core WebSocket target ─────────────────────────
// Shared server-side state for the Core connection target.
// Updated by POST /api/core/target; consumed by /api/core/call
// and /api/core/events.
//
// Falls back to SESSIONBRIDGE_CORE_WS_URL env var when no
// custom target has been set via the API.
//
// Core token resolution: SESSIONNODE_TOKEN env → Go Core
// config file (~/.sessionnode/config.json) → undefined.

import { readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getServerStateFile, ensureBaseDir } from './server-state/paths';

let _customTarget: string | null = null;

/**
 * Reset in-memory target (testing use only).
 * Clears both the custom target and any restored state.
 */
export function resetCoreTarget(): void {
  _customTarget = null;
}

// ── Auto-restore (separated for testability) ────────────────────

/**
 * Restore _customTarget from persisted server-state.json.
 * Skips if SESSIONBRIDGE_CORE_WS_URL env is set (env wins).
 * Exported for testing — IIFE below calls it at module init.
 */
export function restoreCoreTargetFromServerState(): void {
  if (process.env.SESSIONBRIDGE_CORE_WS_URL) return; // env override wins
  try {
    const statePath = getServerStateFile();
    const raw = readFileSync(statePath, 'utf-8');
    const state = JSON.parse(raw);
    if (state.lastCoreUrl) {
      _customTarget = state.lastCoreUrl;
    }
  } catch {
    // File missing or corrupt — use defaults, leave _customTarget null
  }
}

// Run at module init
restoreCoreTargetFromServerState();

export function getCoreWsUrl(): string {
  return _customTarget || process.env.SESSIONBRIDGE_CORE_WS_URL || 'ws://localhost:9090/ws';
}

export function setCoreTargetPort(port: number): void {
  _customTarget = `ws://localhost:${port}/ws`;
  // Persist to server-state so it survives restarts
  try {
    const statePath = getServerStateFile();
    ensureBaseDir();
    let state: Record<string, unknown> = {};
    try {
      const raw = readFileSync(statePath, 'utf-8');
      state = JSON.parse(raw);
    } catch { /* start fresh */ }
    state.lastCorePort = port;
    state.lastCoreUrl = _customTarget;
    const tmp = statePath + '.tmp';
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    renameSync(tmp, statePath);
  } catch { /* persistence failure is non-fatal */ }
}

export function setCoreTargetUrl(url: string): void {
  _customTarget = url;
}

/** Server-side Core token. Resolves from env, then Go Core config file. */
export function getCoreToken(): string | undefined {
  const envToken = process.env.SESSIONNODE_TOKEN;
  if (envToken) return envToken;

  try {
    const cfgPath = join(homedir(), '.sessionnode', 'config.json');
    const raw = readFileSync(cfgPath, 'utf-8');
    const cfg = JSON.parse(raw);
    return cfg?.core?.auth?.adminToken || undefined;
  } catch (_e) {
    return undefined;
  }
}
