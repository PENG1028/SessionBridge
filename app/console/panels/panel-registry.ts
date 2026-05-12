'use client';

import type { ComponentType, ReactNode } from 'react';
import {
  Activity, Camera, Cpu, FileText, Folder, ListChecks, Play, ScrollText, Terminal, Upload, Zap,
} from 'lucide-react';
import { evaluateWhen, type WhenContext } from '../../../lib/evaluate-when';

// ── Icon Name Resolution ──────────────────────────────────────────
// Maps string icon names from extension manifests to lucide components.

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  activity: Activity,
  camera: Camera,
  cpu: Cpu,
  'file-text': FileText,
  folder: Folder,
  'list-checks': ListChecks,
  play: Play,
  'scroll-text': ScrollText,
  terminal: Terminal,
  upload: Upload,
  zap: Zap,
};

function resolveIcon(name?: string): ComponentType<{ className?: string }> | undefined {
  return name ? iconMap[name] : undefined;
}

// ── Panel Registration ────────────────────────────────────────

export interface PanelRegistration {
  id: string;
  /** Future: replace side with dock area once bottom/floating panel hosting exists. */
  side: 'left' | 'right';
  title: string;
  order: number;
  /** Optional when-condition for visibility. */
  when?: string;
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
/** Tracks panel IDs added by syncExtensionPanels, so stale entries can be removed on re-sync. */
const extensionPanelIds = new Set<string>();
/** Tracks panel IDs that have already been warned about missing component overrides, to avoid console spam. */
const warnedMissingComponents = new Set<string>();

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
 * When syncExtensionPanels encounters this ID, it uses this component.
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
 * panel types. Panels without a registered component are skipped.
 */
export function syncExtensionPanels(
  leftViews?: { id: string; title: string; icon: string; defaultVisible: boolean; when?: string; order?: number }[],
  rightViews?: { id: string; title: string; icon: string; defaultVisible: boolean; when?: string; order?: number }[],
): void {
  // Remove all panels from the previous sync — stale entries must not linger.
  for (const id of extensionPanelIds) {
    registry.delete(id);
  }
  extensionPanelIds.clear();

  const addViews = (views: typeof leftViews, side: 'left' | 'right') => {
    if (!views) return;
    for (const v of views) {
      if (registry.has(v.id)) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[panel-registry] Extension panel "${v.id}" (${side}) conflicts with an already-registered panel — skipping.`);
        }
        continue; // core panel — never overwrite
      }
      const comp = getPanelComponentOverride(v.id);
      if (!comp) {
        const warnKey = `${side}:${v.id}`;
        if (!warnedMissingComponents.has(warnKey)) {
          warnedMissingComponents.add(warnKey);
          console.warn(`[panel-registry] Skipping extension panel "${v.id}" (${side}): no component override registered`);
        }
        continue;
      }
      registerPanel({
        id: v.id,
        side,
        title: v.title,
        order: v.order ?? 100,
        when: v.when,
        icon: resolveIcon(v.icon),
        component: comp,
      });
      extensionPanelIds.add(v.id);
    }
  };
  addViews(leftViews, 'left');
  addViews(rightViews, 'right');
}

/** Fallback component for extension panels without a registered view. */
// Removed in Phase 4I — panels without component overrides are now
// skipped in syncExtensionPanels instead of rendering empty frames.
