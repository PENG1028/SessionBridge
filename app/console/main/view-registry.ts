'use client';

import type { ComponentType } from 'react';
import { Cpu } from 'lucide-react';

// ── View Registry Entry ────────────────────────────────────────

export interface ViewMeta {
  title: string;
  icon: ComponentType<{ className?: string }>;
  sidebarRequirements?: {
    left?: 'auto' | 'hidden' | 'shown';
    right?: 'auto' | 'hidden' | 'shown';
  };
  /** Optional host chrome preferences for this view. */
  chrome?: {
    header?: 'full' | 'minimal' | 'hidden';
    statusBar?: 'auto' | 'hidden' | 'shown';
    commandPalette?: boolean;
    globalShortcuts?: boolean;
  };
  /**
   * How this view handles instance binding.
   * - 'singleton': static view, no instance needed (default)
   * - 'instance-bound': requires a runtime instance (terminal, claude-chat)
   * - 'session-bound': binds to a session (future)
   * - 'node-bound': binds to a workspace node (future)
   * - 'runtime-create': creating this view should prompt for new instance (future)
   */
  openMode?: 'singleton' | 'instance-bound' | 'session-bound' | 'node-bound' | 'runtime-create';
  /** Show this view in the "Open View" selector. Core workspace views set this. */
  showInSelector?: boolean;
  /** Category label in the view selector (e.g. "workspace", "adapter"). */
  category?: string;
  /**
   * Whether this view can be launched as a standalone tab/window.
   * Views without this flag only appear when bound to a runtime instance
   * (via adapter mapping) — they are NOT selectable in the ViewSelector.
   */
  launchable?: boolean;
  /**
   * How this view is launched:
   * - 'direct': user can open it directly from the ViewSelector (default)
   * - 'runtime': requires a running instance (terminal, claude-chat)
   * - 'session': binds to an active session
   * - 'hidden': never shown in selector, only opened programmatically
   */
  launchMode?: 'direct' | 'runtime' | 'session' | 'hidden';
  /**
   * The surface type this view occupies.
   * - 'main.editor': shown as a tab in the main work area
   * - 'panel.bottom', 'sidebar.left', etc.: auxiliary slots
   * Only 'main.editor' views can be launchable. Panels never are.
   */
  viewType?: string;
  /**
   * The plugin that owns this view. Used by plugin-manager and plugin-detail
   * to filter launchable views per plugin.
   */
  pluginId?: string;
}

export interface ViewRegistryEntry {
  component: ComponentType<any>;
  meta: ViewMeta;
}

const _dynamicViews = new Map<string, ViewRegistryEntry>();

export function registerView(viewId: string, entry: ViewRegistryEntry): void {
  _dynamicViews.set(viewId, entry);
}

export function unregisterView(viewId: string): void {
  _dynamicViews.delete(viewId);
}

export function getViewEntry(viewId: string): ViewRegistryEntry | undefined {
  return _dynamicViews.get(viewId);
}

/** Get all registered view entries (for the view selector UI). */
export function getAllViewEntries(): Array<[string, ViewRegistryEntry]> {
  return [..._dynamicViews.entries()];
}

// ── Backward-compatible viewRegistry (ComponentType map) ───────

export const viewRegistry: Record<string, ComponentType<any>> = {};

export function syncLegacyRegistry(): void {
  for (const [id, entry] of _dynamicViews) {
    viewRegistry[id] = entry.component;
  }
}

// ── Adapter-to-View mapping ───────────────────────────────────
// Populated by adapter code at module init time and by server sync
// at runtime. The lookup functions check dynamic data first, then
// fall back to module-level registrations.

const _adapterToViewId = new Map<string, string>();

export function registerAdapterMapping(adapterId: string, viewId: string): void {
  if (!_adapterToViewId.has(adapterId)) {
    _adapterToViewId.set(adapterId, viewId);
  }
}

export function setAdapterViewMap(map: Record<string, string>): void {
  for (const [key, value] of Object.entries(map)) {
    _adapterToViewId.set(key, value);
  }
}

export function getAdapterViewId(adapterId: string): string | undefined {
  return _adapterToViewId.get(adapterId);
}

/** Reverse lookup: find the adapter ID that produces a given view ID. */
export function getAdapterIdForView(viewId: string): string | undefined {
  for (const [adapterId, vid] of _adapterToViewId) {
    if (vid === viewId) return adapterId;
  }
  return undefined;
}

// ── Adapter display metadata ──────────────────────────────────

export interface AdapterMeta {
  icon: ComponentType<{ className?: string }>;
  label: string;
  emoji: string;
}

const _adapterMeta = new Map<string, AdapterMeta>();

export function registerAdapterMeta(adapterId: string, meta: AdapterMeta): void {
  if (!_adapterMeta.has(adapterId)) {
    _adapterMeta.set(adapterId, meta);
  }
}

const fallbackMeta: AdapterMeta = { icon: Cpu, label: 'Unknown', emoji: '▶' };
export function getAdapterMeta(adapterId?: string): AdapterMeta {
  return _adapterMeta.get(adapterId || '') || fallbackMeta;
}

export function getAllAdapterTypes(): Array<{ id: string; meta: AdapterMeta }> {
  return [..._adapterMeta.entries()].map(([id, meta]) => ({ id, meta }));
}

// ─── Adapter Capabilities ───────────────────────────────────

const dynamicAdapterCapabilities = new Map<string, Record<string, boolean>>();

export function getAdapterCapabilities(adapterId: string): Record<string, boolean> | undefined {
  return dynamicAdapterCapabilities.get(adapterId);
}

// ─── Chrome Policy ─────────────────────────────────────────────
// Resolved per-view chrome policy with defaults filled in.

export interface ChromePolicy {
  header: 'full' | 'minimal' | 'hidden';
  statusBar: 'auto' | 'hidden' | 'shown';
  commandPalette: boolean;
  globalShortcuts: boolean;
}

export function resolveChromePolicy(chrome?: ViewMeta['chrome']): ChromePolicy {
  return {
    header: chrome?.header ?? 'full',
    statusBar: chrome?.statusBar ?? 'auto',
    commandPalette: chrome?.commandPalette ?? true,
    globalShortcuts: chrome?.globalShortcuts ?? true,
  };
}
