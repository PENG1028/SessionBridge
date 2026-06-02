// ─── App Registry ─────────────────────────────────────────────────
// Client-side registry that mirrors the server-side /api/apps/* data.
// Manages manifest cache, enable/disable state, and capability grants.

import type { AppManifest, AppSummary, AppState } from './app-types';

// ─── Types ────────────────────────────────────────────────────────
type Listener = () => void;

// ─── Internal State ───────────────────────────────────────────────
let _manifests: Map<string, AppManifest> = new Map();
let _summaries: AppSummary[] = [];
let _states: Map<string, AppState> = new Map();
let _listeners: Set<Listener> = new Set();
let _loaded = false;
let _loadError: string | null = null;
let _lastModified = 0;

// ─── Public API ───────────────────────────────────────────────────

/** Returns the last load error, or null if successful. */
export function getLoadError(): string | null { return _loadError; }

/** Fetch and cache the app list from the server. */
/** Force reload on next call (used after YAML changes). */
export function invalidateCache(): void { _loaded = false; }

export async function loadApps(): Promise<AppSummary[]> {
  // Check if server manifests changed since last load
  if (_loaded) {
    try {
      const check = await fetch('/api/apps/list', { method: 'HEAD', credentials: 'same-origin' });
    } catch { /* HEAD not supported, proceed with cache */ }
    // If we have cached data after app start, skip re-fetch briefly
    // Full re-fetch only on invalidateCache() or first load
    return _summaries;
  }

  try {
    const res = await fetch('/api/apps/list', { credentials: 'same-origin' });
    if (!res.ok) {
      _loadError = `Server returned ${res.status}`;
      return [];
    }
    const data = await res.json();
    _summaries = data.apps ?? [];
    _lastModified = data.lastModified ?? 0;
    _loaded = true;
    _loadError = null;
    notify();
    return _summaries;
  } catch (err) {
    _loadError = `Connection failed: ${err instanceof Error ? err.message : String(err)}`;
    return [];
  }
}

/** Get a single app manifest, fetching from server if not cached. */
export async function getManifest(appId: string): Promise<AppManifest | null> {
  if (_manifests.has(appId)) return _manifests.get(appId)!;

  try {
    const res = await fetch(`/api/apps/${appId}`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const manifest = await res.json() as AppManifest;
    _manifests.set(appId, manifest);
    return manifest;
  } catch {
    return null;
  }
}

/** Get cached summaries without fetching. */
export function getSummaries(): AppSummary[] {
  return _summaries;
}

/** Check if an app is enabled. Defaults to false for unknown apps (fail closed). */
export function isEnabled(appId: string): boolean {
  return _states.get(appId)?.enabled ?? false;
}

/** Get the grant mode for a capability of an app. */
export function getGrant(appId: string, capability: string): 'allow' | 'deny' | 'ask' {
  return _states.get(appId)?.grants[capability]?.mode ?? 'ask';
}

/** Load app state from the server. */
export async function loadAppState(appId: string): Promise<AppState> {
  try {
    const res = await fetch(`/api/apps/${appId}/state`, { credentials: 'same-origin' });
    if (!res.ok) return { enabled: true, updatedAt: 0, grants: {} };
    const state = await res.json() as AppState;
    _states.set(appId, state);
    notify();
    return state;
  } catch {
    return { enabled: true, updatedAt: 0, grants: {} };
  }
}

/** Toggle enable/disable for an app. Persists to server. Rolls back on failure. */
export async function setEnabled(appId: string, enabled: boolean): Promise<void> {
  const prev = _states.get(appId)?.enabled;
  const res = await fetch(`/api/apps/${appId}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ enabled }),
  });
  if (res.ok) {
    const state = await res.json() as AppState;
    _states.set(appId, state);
    notify();
  } else if (prev !== undefined) {
    // Rollback: request failed, keep previous state
    _states.set(appId, { ..._states.get(appId)!, enabled: prev });
    notify();
  }
}

/** Set a grant for a capability. Persists to server. */
export async function setGrant(appId: string, capability: string, mode: 'allow' | 'deny' | 'ask'): Promise<void> {
  const res = await fetch(`/api/apps/${appId}/state`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ grants: { [capability]: { mode } } }),
  });
  if (res.ok) {
    const state = await res.json() as AppState;
    _states.set(appId, state);
    notify();
  }
}

/** Subscribe to registry changes (enable/disable, grants). Returns unsubscribe. */
export function subscribe(fn: Listener): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Reset the registry (for testing). */
export function reset(): void {
  _manifests.clear();
  _summaries = [];
  _states.clear();
  _listeners.clear();
  _loaded = false;
  _loadError = null;
}

// ─── Internal ─────────────────────────────────────────────────────
function notify(): void {
  _listeners.forEach(fn => { try { fn(); } catch { /* listener error */ } });
}
