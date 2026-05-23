// ─── Adapter Fallback Utilities ──────────────────────────
// Minimal replacements for extensions/registry functions.
// The relay no longer loads adapter extensions — these functions
// return sensible defaults for the shell/terminal baseline.

/** Default adapter ID used when no adapter is specified. */
export function getDefaultAdapterId(): string {
  return 'shell';
}

/** The first terminal-capable adapter ID — no adapters loaded, returns undefined. */
export function getTerminalAdapterId(): string | undefined {
  return undefined;
}

/** Resolve an adapter by ID — no adapters loaded, returns undefined. */
export function resolveAdapter(_adapterId?: string): any {
  return undefined;
}

/** Resolve first adapter matching a capability — no adapters loaded, returns undefined. */
export function resolveAdapterByCapability<K extends string, V>(
  _key: K,
  _value: V,
): any {
  return undefined;
}
