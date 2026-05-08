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
  /** Show this view in the "Open View" selector. Core workspace views set this. */
  showInSelector?: boolean;
  /** Category label in the view selector (e.g. "workspace", "adapter"). */
  category?: string;
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

export function syncAdapterViewsFromExtensionData(eps: Record<string, unknown> | null): void {
  if (!eps) return;
  const adapterViews = eps.adapterViews as Record<string, string> | undefined;
  if (adapterViews) {
    setAdapterViewMap(adapterViews);
  }
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

export function syncAdapterMetaFromExtensionData(eps: Record<string, unknown> | null): void {
  if (!eps) return;
  const extMeta = eps.adapterMeta as Record<string, { label?: string; emoji?: string }> | undefined;
  if (extMeta) {
    for (const [id, meta] of Object.entries(extMeta)) {
      if (!_adapterMeta.has(id)) {
        _adapterMeta.set(id, {
          icon: Cpu,
          label: meta.label || id,
          emoji: meta.emoji || '▶',
        });
      }
    }
  }
}

export function getAllAdapterTypes(): Array<{ id: string; meta: AdapterMeta }> {
  return [..._adapterMeta.entries()].map(([id, meta]) => ({ id, meta }));
}

// ─── Adapter Capabilities (from extension manifests) ────────────

const dynamicAdapterCapabilities = new Map<string, Record<string, boolean>>();

export function syncAdapterCapabilitiesFromExtensionData(eps: Record<string, unknown> | null): void {
  if (!eps?.adapterCapabilities) return;
  const caps = eps.adapterCapabilities as Record<string, Record<string, boolean>>;
  for (const [id, cap] of Object.entries(caps)) {
    dynamicAdapterCapabilities.set(id, cap);
  }
}

export function getAdapterCapabilities(adapterId: string): Record<string, boolean> | undefined {
  return dynamicAdapterCapabilities.get(adapterId);
}
