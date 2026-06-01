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

// ─── Public API ───────────────────────────────────────────────────

/** Fetch and cache the app list from the server. */
export async function loadApps(): Promise<AppSummary[]> {
  if (_loaded) return _summaries;

  try {
    const res = await fetch('/api/apps/list', { credentials: 'same-origin' });
    if (!res.ok) return [];
    const data = await res.json();
    _summaries = data.apps ?? [];
    _loaded = true;
    notify();
    return _summaries;
  } catch {
    return _summaries;
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

/** Check if an app is enabled. Defaults to true for unknown apps. */
export function isEnabled(appId: string): boolean {
  return _states.get(appId)?.enabled ?? true;
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

/** Toggle enable/disable for an app. Persists to server. */
export async function setEnabled(appId: string, enabled: boolean): Promise<void> {
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
}

// ─── Internal ─────────────────────────────────────────────────────
function notify(): void {
  _listeners.forEach(fn => { try { fn(); } catch { /* listener error */ } });
}
