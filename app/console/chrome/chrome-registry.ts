'use client';

import { evaluateWhen, type WhenContext } from '../../../lib/evaluate-when';

// ─── Local chrome types ──

export type ContextControlPlacement =
  | 'bottom-left'
  | 'bottom-right'
  | 'header-right'
  | 'status-left'
  | 'status-right'
  | 'auto';

export type ContextControlKind =
  | 'hint' | 'button' | 'toggle' | 'menu' | 'progress' | 'approval' | 'jump';

export interface HeaderChromeContribution {
  id: string; title?: string; text?: string; icon?: string;
  side?: 'left' | 'right'; group?: string; order?: number;
  when?: string; command?: string; priority?: 'low' | 'normal' | 'high';
  mobile?: 'show' | 'collapse' | 'hide';
}

export interface StatusBarChromeContribution {
  id: string; text: string; title?: string; icon?: string;
  side?: 'left' | 'right'; group?: string; order?: number;
  when?: string; command?: string; priority?: 'low' | 'normal' | 'high';
  mobile?: 'show' | 'collapse' | 'hide';
}

export interface KeyHintChromeContribution {
  id: string; label: string; keys: string; order?: number;
  when?: string; command?: string; group?: string;
  priority?: 'low' | 'normal' | 'high'; mobile?: 'show' | 'collapse' | 'hide';
}

export interface ContextControlContribution {
  id: string; kind: ContextControlKind; label: string;
  icon?: string; keys?: string; placement?: ContextControlPlacement;
  command?: string; when?: string; order?: number;
  priority?: number; group?: string; ttlMs?: number;
  collapsible?: boolean; defaultCollapsed?: boolean;
  mobile?: 'show' | 'collapse' | 'hide';
  variant?: 'default' | 'primary' | 'danger' | 'warning' | 'success';
  reason?: string;
}

// ─── State ───────────────────────────────────────────────────

let headerItems: HeaderChromeContribution[] = [];
let statusBarItems: StatusBarChromeContribution[] = [];
let keyHintItems: KeyHintChromeContribution[] = [];

/**
 * Phase 4J-b: Unified context controls (replaces keyHints as primary model).
 * keyHints are converted to contextControls with kind: "hint", placement: "bottom-right".
 */
let contextControls: ContextControlContribution[] = [];

/** Tracks IDs that have already warned about missing commands, to avoid console spam. */
const warnedMissingCommands = new Set<string>();

// ─── Sync ────────────────────────────────────────────────────

/**
 * Accept raw chrome contributions from Go Core plugin manifests.
 * Called by useCorePluginRegistrySync when plugin data changes.
 * Replaces any previously synced items.
 * Supports both legacy keyHints and new contextControls.
 */
export function syncChromeContributions(data: unknown): void {
  headerItems = [];
  statusBarItems = [];
  keyHintItems = [];
  contextControls = [];

  if (!data || typeof data !== 'object') return;
  const d = data as Record<string, unknown>;

  if (Array.isArray(d.header)) {
    headerItems = d.header as HeaderChromeContribution[];
  }
  if (Array.isArray(d.statusBar)) {
    statusBarItems = d.statusBar as StatusBarChromeContribution[];
  }
  if (Array.isArray(d.keyHints)) {
    keyHintItems = d.keyHints as KeyHintChromeContribution[];
  }

  // Phase 4J-b: Accept contextControls directly from server
  if (Array.isArray(d.contextControls)) {
    contextControls = d.contextControls as ContextControlContribution[];
  }

  // Convert legacy keyHints to contextControls, dedup by ID
  const legacyCc: ContextControlContribution[] = (d.keyHints as any[] | undefined)?.map(kh => ({
    id: kh.id,
    kind: 'hint' as const,
    label: kh.label,
    keys: kh.keys,
    placement: 'bottom-right' as ContextControlPlacement,
    command: kh.command,
    when: kh.when,
    order: kh.order,
  })) ?? [];

  // Dedup: contextControls from server take priority over legacy conversion
  const existingIds = new Set(contextControls.map(c => c.id));
  for (const legacy of legacyCc) {
    if (!existingIds.has(legacy.id)) {
      contextControls.push(legacy);
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    for (const item of [...headerItems, ...statusBarItems, ...keyHintItems, ...contextControls]) {
      if (item.id && !warnedMissingCommands.has(item.id) && item.command) {
        warnedMissingCommands.add(item.id);
      }
    }
  }
}

// ─── Sort helpers ────────────────────────────────────────────

function sortChromeItems<T extends { side?: string; group?: string; order?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    // left before right
    if ((a.side || 'left') !== (b.side || 'left')) {
      return (a.side || 'left') === 'left' ? -1 : 1;
    }
    // by group (string compare)
    const gA = a.group || '';
    const gB = b.group || '';
    if (gA !== gB) return gA < gB ? -1 : 1;
    // by order
    return (a.order ?? 100) - (b.order ?? 100);
  });
}

/**
 * Placement sort order: host regions ordered left-to-right, top-to-bottom.
 */
const PLACEMENT_ORDER: Record<string, number> = {
  'header-right': 0,
  'status-left': 1,
  'status-right': 2,
  'bottom-left': 3,
  'bottom-right': 4,
  'auto': 5,
};

function sortContextControls(items: ContextControlContribution[]): ContextControlContribution[] {
  return [...items].sort((a, b) => {
    // by placement
    const pA = PLACEMENT_ORDER[a.placement ?? 'auto'] ?? 5;
    const pB = PLACEMENT_ORDER[b.placement ?? 'auto'] ?? 5;
    if (pA !== pB) return pA - pB;
    // by priority descending (higher = more important)
    const priA = a.priority ?? 50;
    const priB = b.priority ?? 50;
    if (priA !== priB) return priB - priA;
    // by order ascending
    return (a.order ?? 100) - (b.order ?? 100);
  });
}

// ─── Getters — legacy chrome ─────────────────────────────────

export function getHeaderChromeItems(ctx?: WhenContext): HeaderChromeContribution[] {
  if (!ctx) return sortChromeItems(headerItems);
  return sortChromeItems(headerItems.filter(item => evaluateWhen(item.when, ctx)));
}

export function getStatusBarChromeItems(ctx?: WhenContext): StatusBarChromeContribution[] {
  if (!ctx) return sortChromeItems(statusBarItems);
  return sortChromeItems(statusBarItems.filter(item => evaluateWhen(item.when, ctx)));
}

/**
 * @deprecated Legacy compatibility — delegates to getContextControls().filter(kind === 'hint').
 * Returns results mapped to KeyHintChromeContribution shape.
 */
export function getKeyHintItems(ctx?: WhenContext): KeyHintChromeContribution[] {
  const hints = getContextControls(ctx).filter(i => i.kind === 'hint');
  return hints.map(c => ({
    id: c.id,
    label: c.label,
    keys: c.keys || '',
    order: c.order,
    when: c.when,
    command: c.command,
    group: c.group,
  }));
}

// ─── Getters — context controls (Phase 4J-b) ────────────────

/**
 * Get all context controls, optionally filtered by when condition.
 * Sorted by placement → priority (desc) → order (asc).
 * This is the primary API for adaptive context controls.
 */
export function getContextControls(ctx?: WhenContext): ContextControlContribution[] {
  if (!ctx) return sortContextControls(contextControls);
  return sortContextControls(contextControls.filter(item => evaluateWhen(item.when, ctx)));
}

/**
 * Get only hint-kind context controls. Replaces direct getKeyHintItems usage.
 */
export function getContextControlHints(ctx?: WhenContext): ContextControlContribution[] {
  return getContextControls(ctx).filter(i => i.kind === 'hint');
}

/**
 * Get context controls eligible for the bottom-right overlay.
 *
 * Inclusion rules:
 *   - placement === "bottom-right" → always included
 *   - placement === "auto" → host decides bottom-right (phase 4J-b fallback)
 *   - placement is undefined and kind === "hint" → legacy keyHint → bottom-right
 *   - placement === "header-right" | "status-left" | "status-right" | "bottom-left" → excluded
 *
 * This is the primary data source for KeyHintOverlay.
 */
export function getBottomRightContextControls(ctx?: WhenContext): ContextControlContribution[] {
  const items = getContextControls(ctx);
  return items.filter(c =>
    c.placement === 'bottom-right'
    || c.placement === 'auto'
    || (!c.placement && c.kind === 'hint')
  );
}

// ─── Clear (for testing / reset) ─────────────────────────────

export function clearChromeContributions(): void {
  headerItems = [];
  statusBarItems = [];
  keyHintItems = [];
  contextControls = [];
  warnedMissingCommands.clear();
}
