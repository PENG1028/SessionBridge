// ─── Dynamic Core WebSocket target ─────────────────────────
// Shared server-side state for the Core connection target.
// Updated by POST /api/core/target; consumed by /api/core/call
// and /api/core/events.
//
// Falls back to SESSIONBRIDGE_CORE_WS_URL env var when no
// custom target has been set via the API.

let _customTarget: string | null = null;

export function getCoreWsUrl(): string {
  return _customTarget || process.env.SESSIONBRIDGE_CORE_WS_URL || 'ws://127.0.0.1:9090/ws';
}

export function setCoreTargetPort(port: number): void {
  _customTarget = `ws://localhost:${port}/ws`;
}

export function setCoreTargetUrl(url: string): void {
  _customTarget = url;
}

/** Server-side Core token from env (never sent to the browser). */
export function getCoreToken(): string | undefined {
  return process.env.SESSIONNODE_TOKEN || undefined;
}
