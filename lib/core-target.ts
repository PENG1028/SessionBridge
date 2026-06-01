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

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

let _customTarget: string | null = null;

export function getCoreWsUrl(): string {
  return _customTarget || process.env.SESSIONBRIDGE_CORE_WS_URL || 'ws://localhost:9090/ws';
}

export function setCoreTargetPort(port: number): void {
  _customTarget = `ws://localhost:${port}/ws`;
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
  } catch {
    return undefined;
  }
}
