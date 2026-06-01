// ─── Transport Debug Logging ──────────────────────────────────────
// Structured debug logging for CoreClient transport layer.
// Toggle with NEXT_PUBLIC_CORE_DEBUG=1 or localStorage key.
// NEVER logs tokens, passwords, or raw message bodies.

const DEBUG_KEY = 'bridge-core-debug';
const _env = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_CORE_DEBUG === '1';
const _storage = typeof localStorage !== 'undefined' && localStorage.getItem(DEBUG_KEY) === '1';

export const CORE_DEBUG = _env || _storage;

// Enable via: localStorage.setItem('bridge-core-debug', '1')

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

function tag(channel: string): string {
  return `%c[${ts()}] %c[${channel}]%c`;
}

const styles = ['color:#888', 'color:#c084fc;font-weight:bold', ''];

export function debug(channel: string, msg: string, detail?: unknown): void {
  if (!CORE_DEBUG) return;
  if (detail !== undefined) {
    console.log(tag(channel), ...styles, msg, detail);
  } else {
    console.log(tag(channel), ...styles, msg);
  }
}

export function debugWarn(channel: string, msg: string, detail?: unknown): void {
  if (!CORE_DEBUG) return;
  console.warn(tag(channel), ...styles, msg, detail ?? '');
}

export function debugError(channel: string, msg: string, detail?: unknown): void {
  // Always log errors, not just when debug is on
  console.error(`[${ts()}] [${channel}]`, msg, detail ?? '');
}
