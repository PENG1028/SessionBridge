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

export function registerPanel(reg: PanelRegistration): void {
  registry.set(reg.id, reg);
}

export function unregisterPanel(id: string): void {
  registry.delete(id);
}

export function clearPanels(): void {
  registry.clear();
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
 * Only adds panels whose IDs are not already registered by core panels.
 */
export function syncExtensionPanels(
  leftViews?: { id: string; title: string; icon: string; defaultVisible: boolean; when?: string }[],
  rightViews?: { id: string; title: string; icon: string; defaultVisible: boolean; when?: string }[],
): void {
  const addViews = (views: typeof leftViews, side: 'left' | 'right') => {
    if (!views) return;
    for (const v of views) {
      if (registry.has(v.id)) continue;
      registerPanel({
        id: v.id,
        side,
        title: v.title,
        order: 100,
        when: v.when,
        component: PlaceholderPanel,
      });
    }
  };
  addViews(leftViews, 'left');
  addViews(rightViews, 'right');
}

/** Fallback component for extension panels without a registered view. */
function PlaceholderPanel() {
  return null;
}
