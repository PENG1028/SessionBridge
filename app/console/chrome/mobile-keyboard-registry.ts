'use client';

import { evaluateWhen, type WhenContext } from '../../../lib/evaluate-when';

// ─── Contribution Type ──────────────────────────────────────────
// A plugin-declared button in the mobile keyboard toolbar.
// Multiple plugins can contribute; the slot host renders them all
// grouped by row, sorted by order within each row.

export interface MobileKeyboardContribution {
  id: string;
  pluginId: string;
  label: string;

  /** Characters to send when pressed. Ignored when toggle=true. */
  send?: string;

  /** If true, this is a sticky toggle key (Ctrl/Alt modifier). */
  toggle?: boolean;
  /** Which modifier this toggle represents. Only meaningful when toggle=true. */
  toggleKey?: 'ctrl' | 'alt';

  /** Row group. 0 = first row, 1 = second row, etc. Default 0. */
  row?: number;
  /** Sort order within the row. Lower = first. Default 100. */
  order?: number;

  /** When-condition for visibility. Evaluated against current context. */
  when?: string;
}

// ─── Registry ───────────────────────────────────────────────────

let items: MobileKeyboardContribution[] = [];
let _listeners: Array<() => void> = [];
let _cachedSorted: MobileKeyboardContribution[] = [];

function rebuildCache() {
  _cachedSorted = [...items].sort(sortByRowOrder);
}

/** Subscribe to contribution changes. Returns unsubscribe function. */
export function subscribeMobileKeyboardItems(listener: () => void): () => void {
  _listeners.push(listener);
  return () => { _listeners = _listeners.filter(l => l !== listener); };
}

/** Get sorted snapshot of current items (no filter). Compatible with useSyncExternalStore.
 *  MUST return a stable reference when items haven't changed — otherwise infinite loop. */
export function getSnapshotMobileKeyboardItems(): MobileKeyboardContribution[] {
  return _cachedSorted;
}

/** Replace all mobile keyboard contributions. Used by plugin-sync. */
export function syncMobileKeyboardContributions(
  contributions: MobileKeyboardContribution[],
): void {
  items = contributions;
  rebuildCache();
  for (const l of _listeners) l();
}

/** Get all active mobile keyboard contributions, sorted by row then order. */
export function getMobileKeyboardContributions(
  ctx?: WhenContext,
): MobileKeyboardContribution[] {
  if (!ctx) return [...items].sort(sortByRowOrder);
  return items
    .filter(item => evaluateWhen(item.when, ctx))
    .sort(sortByRowOrder);
}

function sortByRowOrder(a: MobileKeyboardContribution, b: MobileKeyboardContribution): number {
  const rowDiff = (a.row ?? 0) - (b.row ?? 0);
  if (rowDiff !== 0) return rowDiff;
  return (a.order ?? 100) - (b.order ?? 100);
}

/** Clear all contributions (for testing / reset). */
export function clearMobileKeyboardContributions(): void {
  items = [];
  rebuildCache();
}
