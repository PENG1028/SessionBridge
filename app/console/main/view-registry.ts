'use client';

import type { ComponentType } from 'react';
import { Sparkles, Terminal as TerminalIcon, Cpu } from 'lucide-react';

// ── View Registry Entry ────────────────────────────────────────

export interface ViewMeta {
  title: string;
  icon: ComponentType<{ className?: string }>;
  sidebarRequirements?: {
    left?: 'auto' | 'hidden' | 'shown';
    right?: 'auto' | 'hidden' | 'shown';
  };
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

// ── Backward-compatible viewRegistry (ComponentType map) ───────

export const viewRegistry: Record<string, ComponentType<any>> = {};

export function syncLegacyRegistry(): void {
  for (const [id, entry] of _dynamicViews) {
    viewRegistry[id] = entry.component;
  }
}

// ── Adapter-to-View mapping ───────────────────────────────────

export const adapterToViewId: Record<string, string> = {
  'claude-code': 'claude-chat',
  'shell': 'terminal',
};

const dynamicAdapterToViewId = new Map<string, string>();

export function setAdapterViewMap(map: Record<string, string>): void {
  for (const [key, value] of Object.entries(map)) {
    dynamicAdapterToViewId.set(key, value);
  }
}

export function getAdapterViewId(adapterId: string): string | undefined {
  return dynamicAdapterToViewId.get(adapterId) ?? adapterToViewId[adapterId];
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

export const adapterMeta: Record<string, AdapterMeta> = {
  'claude-code': { icon: Sparkles, label: 'Claude Code', emoji: '💬' },
  'shell': { icon: TerminalIcon, label: 'Terminal', emoji: '⌨' },
};

const fallbackMeta: AdapterMeta = { icon: Cpu, label: 'Unknown', emoji: '▶' };
export function getAdapterMeta(adapterId?: string): AdapterMeta {
  return adapterMeta[adapterId || 'shell'] || dynamicAdapterMeta.get(adapterId || '') || fallbackMeta;
}

const dynamicAdapterMeta = new Map<string, AdapterMeta>();

export function syncAdapterMetaFromExtensionData(eps: Record<string, unknown> | null): void {
  if (!eps) return;
  const extMeta = eps.adapterMeta as Record<string, { label?: string; emoji?: string }> | undefined;
  if (extMeta) {
    for (const [id, meta] of Object.entries(extMeta)) {
      if (!adapterMeta[id]) {
        dynamicAdapterMeta.set(id, {
          icon: Cpu,
          label: meta.label || id,
          emoji: meta.emoji || '▶',
        });
      }
    }
  }
}

export function getAllAdapterTypes(): Array<{ id: string; meta: AdapterMeta }> {
  const result: Array<{ id: string; meta: AdapterMeta }> = [];
  const seen = new Set<string>();
  for (const [id, meta] of Object.entries(adapterMeta)) {
    result.push({ id, meta });
    seen.add(id);
  }
  for (const [id, meta] of dynamicAdapterMeta) {
    if (!seen.has(id)) {
      result.push({ id, meta });
      seen.add(id);
    }
  }
  return result;
}
