'use client';

import type { ComponentType } from 'react';
import { evaluateWhen, type WhenContext } from '../../../lib/evaluate-when';

// ── Panel Registration ────────────────────────────────────────

export interface PanelRegistration {
  id: string;
  side: 'left' | 'right';
  title: string;
  order: number;
  /** Optional when-condition for visibility. */
  when?: string;
  component: ComponentType<any>;
}

const registry = new Map<string, PanelRegistration>();
/** Tracks panel IDs added by syncExtensionPanels, so stale entries can be removed on re-sync. */
const extensionPanelIds = new Set<string>();

export function registerPanel(reg: PanelRegistration): void {
  registry.set(reg.id, reg);
}

export function unregisterPanel(id: string): void {
  registry.delete(id);
  extensionPanelIds.delete(id);
}

export function clearPanels(): void {
  registry.clear();
  extensionPanelIds.clear();
}

// ── Panel Component Overrides ──────────────────────────────────
// Allows core to register known React components for panel IDs
// that are declared in extension manifests. Extension manifests
// describe the panel (title, side, order) but don't ship React
// components — these overrides fill in the rendering.
//
// Register a component override BEFORE syncExtensionPanels runs,
// typically at module init time.

const componentOverrides = new Map<string, ComponentType<any>>();

/**
 * Register a React component for a panel ID.
 * When syncExtensionPanels encounters this ID, it uses this component
 * instead of the default PlaceholderPanel.
 */
export function registerPanelComponent(id: string, component: ComponentType<any>): void {
  componentOverrides.set(id, component);
}

export function getPanelComponentOverride(id: string): ComponentType<any> | undefined {
  return componentOverrides.get(id);
}

/**
 * Get all panels for a sidebar side, filtered by when-condition and sorted by order.
 */
export function getPanels(side: 'left' | 'right', ctx?: WhenContext): PanelRegistration[] {
  const result: PanelRegistration[] = [];
  for (const reg of registry.values()) {
    if (reg.side !== side) continue;
    if (reg.when && ctx && !evaluateWhen(reg.when, ctx)) continue;
    result.push(reg);
  }
  result.sort((a, b) => a.order - b.order);
  return result;
}

/**
 * Sync extension panel descriptors from server manifests into the registry.
 * Removes any panels from a previous sync, then re-adds from current views.
 * Core panels (registered before the first sync) are never removed.
 * Uses component overrides (registered via registerPanelComponent) for known
 * panel types, falling back to a placeholder for unknown types.
 */
export function syncExtensionPanels(
  leftViews?: { id: string; title: string; icon: string; defaultVisible: boolean; when?: string }[],
  rightViews?: { id: string; title: string; icon: string; defaultVisible: boolean; when?: string }[],
): void {
  // Remove all panels from the previous sync — stale entries must not linger.
  for (const id of extensionPanelIds) {
    registry.delete(id);
  }
  extensionPanelIds.clear();

  const addViews = (views: typeof leftViews, side: 'left' | 'right') => {
    if (!views) return;
    for (const v of views) {
      if (registry.has(v.id)) continue; // core panel — never overwrite
      registerPanel({
        id: v.id,
        side,
        title: v.title,
        order: 100,
        when: v.when,
        component: getPanelComponentOverride(v.id) ?? PlaceholderPanel,
      });
      extensionPanelIds.add(v.id);
    }
  };
  addViews(leftViews, 'left');
  addViews(rightViews, 'right');
}

/** Fallback component for extension panels without a registered view. */
function PlaceholderPanel() {
  return null;
}
