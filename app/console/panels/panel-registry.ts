'use client';

import type { ComponentType, ReactNode } from 'react';
import { evaluateWhen, type WhenContext } from '../../../lib/evaluate-when';
import { hostComponentRegistry } from '../plugin-host/host-component-registry';
import { resolveIcon } from '../shared/icon-registry';

// ── Icon Name Resolution ──────────────────────────────────────────
// Maps string icon names from plugin manifests to lucide components.

// ── Icon resolution — delegated to shared icon-registry ─────────


export interface PanelRegistration {
  id: string;
  /** Future: replace side with dock area once bottom/floating panel hosting exists. */
  side: 'left' | 'right';
  title: string;
  order: number;
  /** Optional when-condition for visibility. */
  when?: string;
  /** If true, panel is always visible regardless of context.
   *  Default (false): panel only shows when its plugin has an active view. */
  alwaysVisible?: boolean;
  component: ComponentType<any>;
  /** Icon component rendered in the DockPanelFrame header. Stable — visible even when collapsed. */
  icon?: ComponentType<{ className?: string }>;
  /**
   * Returns action ReactNodes rendered in the DockPanelFrame header.
   * Called with the panel's props at sidebar render time, so actions
   * are always available regardless of collapse state.
   * For stateful actions that need to reach into the panel, use
   * {@link onPanelAction} / {@link emitPanelAction}.
   */
  getActions?: (props: Record<string, any>) => ReactNode;

  // ── Dock Profile / Layout hints (Phase 4I+, prepared but not enforced) ──

  /** Default panel size hint before user customization. */
  defaultSize?: 'compact' | 'normal' | 'expanded' | number;
  minSize?: number;
  maxSize?: number;
  /** Keep panel mounted even when filtered out by when? */
  keepMounted?: boolean;
  /** Preferred and allowed dock areas for this panel. */
  preferredArea?: 'left' | 'right' | 'bottom' | 'floating';
  allowedAreas?: Array<'left' | 'right' | 'bottom' | 'floating'>;
  /** Mobile placement hint — host may override for safety. */
  mobile?: {
    placement?: 'auto' | 'drawer' | 'sheet' | 'fullscreen' | 'hidden';
    priority?: number;
    custom?: boolean;
  };
}

const registry = new Map<string, PanelRegistration>();
/** Tracks panel IDs added by syncPluginPanels, so stale entries can be removed on re-sync. */
const pluginPanelIds = new Set<string>();
/** Tracks panel IDs that have already been warned about missing component overrides, to avoid console spam. */
const warnedMissingComponents = new Set<string>();

export function registerPanel(reg: PanelRegistration): void {
  registry.set(reg.id, reg);
}

export function unregisterPanel(id: string): void {
  registry.delete(id);
  pluginPanelIds.delete(id);
}

export function clearPanels(): void {
  registry.clear();
  pluginPanelIds.clear();
}

// ── Panel Component Overrides ──────────────────────────────────
// Allows core to register known React components for panel IDs
// that are declared in plugin manifests. Plugin manifests
// describe the panel (title, side, order) but don't ship React
// components — these overrides fill in the rendering.
//
// Register a component override BEFORE syncPluginPanels runs,
// typically at module init time.

const componentOverrides = new Map<string, ComponentType<any>>();

/**
 * Register a React component for a panel ID.
 * When syncPluginPanels encounters this ID, it uses this component.
 * Panels without a registered component override are skipped.
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

    // Explicit when-condition
    if (reg.when && ctx && !evaluateWhen(reg.when, ctx)) continue;

    // Default visibility: panels without when and without alwaysVisible
    // only show when there's an active adapter (plugin context is active).
    if (!reg.when && !reg.alwaysVisible && ctx && !ctx.activeAdapterId) continue;

    result.push(reg);
  }
  result.sort((a, b) => a.order - b.order);
  return result;
}

/**
 * Sync plugin panel descriptors from Go Core manifests into the registry.
 * Removes any panels from a previous sync, then re-adds from current views.
 * Core panels (registered before the first sync) are never removed.
 * Uses component overrides (registered via registerPanelComponent) for known
 * panel types. Panels without a registered component are skipped.
 */
export function syncPluginPanels(
  leftViews?: { id: string; title: string; icon: string; defaultVisible: boolean; componentId?: string; when?: string; order?: number; alwaysVisible?: boolean }[],
  rightViews?: { id: string; title: string; icon: string; defaultVisible: boolean; componentId?: string; when?: string; order?: number; alwaysVisible?: boolean }[],
): void {
  // Remove all panels from the previous sync — stale entries must not linger.
  for (const id of pluginPanelIds) {
    registry.delete(id);
  }
  pluginPanelIds.clear();

  const addViews = (views: typeof leftViews, side: 'left' | 'right') => {
    if (!views) return;
    for (const v of views) {
      if (registry.has(v.id)) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[panel-registry] Plugin panel "${v.id}" (${side}) conflicts with an already-registered panel — skipping.`);
        }
        continue; // core panel — never overwrite
      }
      // Try explicit component override first (registered via registerPanelComponent),
      // then fall back to hostComponentRegistry by componentId.
      let comp = getPanelComponentOverride(v.id);
      if (!comp && v.componentId) {
        comp = hostComponentRegistry.get(v.componentId);
      }
      if (!comp) {
        const warnKey = `${side}:${v.id}`;
        if (!warnedMissingComponents.has(warnKey)) {
          warnedMissingComponents.add(warnKey);
          console.warn(`[panel-registry] Skipping plugin panel "${v.id}" (${side}): no component override registered`);
        }
        continue;
      }
      registerPanel({
        id: v.id,
        side,
        title: v.title,
        order: v.order ?? 100,
        when: v.when,
        alwaysVisible: v.alwaysVisible,
        icon: resolveIcon(v.icon),
        component: comp,
      });
      pluginPanelIds.add(v.id);
    }
  };
  addViews(leftViews, 'left');
  addViews(rightViews, 'right');
}
