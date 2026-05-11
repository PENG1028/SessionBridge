'use client';

// ─── Phase 4K: Context Menu Registry ─────────────────────────
// Three-source merger:
//   1. Manifest menu contributions (syncContextMenus)
//   2. Action registry items with 'contextMenu' surface
//   3. Component localItems (passed at call time via ContextMenuRequest)
//
// Host-owned: all menus go through this registry for merge, filter,
// sort, dedup, and command dispatch.

import type { ContextMenuItem } from '../shell/context-menu';
import {
  evaluateWhen,
  type WhenContext,
} from '../../../lib/evaluate-when';
import { getAction, getAllActions } from '../actions/action-registry';
import type { ActionRunContext } from '../actions/action-types';
import type {
  ContextMenuRequest,
  ContextMenuItemSpec,
  ResolvedContextMenuItem,
} from './context-menu-types';

// ─── Internal state ──────────────────────────────────────────

interface MenuEntry {
  id: string;
  title: string;
  command?: string;
  menu?: string;
  group?: string;
  order?: number;
  when?: string;
  disabled?: boolean;
}

let menuEntries: MenuEntry[] = [];

// ─── Sync ────────────────────────────────────────────────────

/**
 * Accept raw menu contributions from server extension points data.
 * Called in page.tsx when extensionPointsData changes.
 */
export function syncContextMenus(data: unknown): void {
  menuEntries = [];
  if (!Array.isArray(data)) return;
  for (const item of data as Record<string, unknown>[]) {
    if (!item.id || typeof item.id !== 'string') continue;
    menuEntries.push({
      id: item.id as string,
      title: (item.title as string) || item.id,
      command: item.command as string | undefined,
      menu: (item.menu as string) || 'workbench/context',
      group: item.group as string | undefined,
      order: typeof item.order === 'number' ? item.order : undefined,
      when: item.when as string | undefined,
      disabled: !!item.disabled,
    });
  }
}

export function clearContextMenus(): void {
  menuEntries = [];
}

// ─── Query (legacy surface, kept for backward compat) ────────

const GROUP_ORDER = ['navigation', 'edit', 'debug', 'view'];

/**
 * Legacy query: get context menu items for a given menu target.
 * Only checks manifest entries and action registry (no localItems).
 * Prefer buildMenuItems() for ContextMenuRequest-based usage.
 */
export function getContextMenuItems(
  menuTarget: string,
  whenCtx: WhenContext,
  actionRunCtx?: ActionRunContext,
): ResolvedContextMenuItem[] {
  const specs: ContextMenuItemSpec[] = [];
  const seen = new Set<string>();

  // 1. Manifest menu contributions
  for (const entry of menuEntries) {
    if (entry.menu !== menuTarget) continue;
    if (entry.when && !evaluateWhen(entry.when, whenCtx)) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    specs.push({
      id: entry.id,
      title: entry.title,
      command: entry.command,
      group: entry.group,
      order: entry.order ?? 100,
      disabled: entry.disabled,
      when: entry.when,
    });
  }

  // 2. Action registry items with 'contextMenu' surface
  const allActions = getAllActions();
  for (const action of allActions) {
    if (!action.surfaces?.includes('contextMenu')) continue;
    if (action.when && !evaluateWhen(action.when, whenCtx)) continue;
    if (seen.has(action.id)) continue;
    seen.add(action.id);
    specs.push({
      id: action.id,
      title: action.title,
      shortcut: action.shortcut,
      command: action.id,
      group: action.group,
      order: action.order ?? 100,
      when: action.when,
      danger: action.danger,
    });
  }

  return resolveItems(specs, actionRunCtx, whenCtx, undefined);
}

// ─── Chain-based build (new API) ────────────────────────────

/**
 * Build menu items from a ContextMenuRequest.
 *
 * Merge order (highest priority first):
 *   1. localItems (from the calling component)
 *   2. Manifest menus matching each chain entry (most specific first)
 *   3. Action registry items with 'contextMenu' surface
 *
 * Dedup by id: earlier source wins.
 * Filter by when-condition against merged context.
 * Sort by group → order → title.
 * Resolve commands to actions.
 */
export function buildMenuItems(
  request: ContextMenuRequest,
  actionRunCtx?: ActionRunContext,
): ResolvedContextMenuItem[] {
  const { target, chain, localItems, localOnly, whenContext: extraCtx, menu } = request;

  // Merged when-context: target fields + extra + view/adapterId from target
  const mergedWhen: Record<string, unknown> = {
    ...(target.view ? { view: target.view } : {}),
    ...(target.adapterId ? { activeAdapterId: target.adapterId } : {}),
    ...(target.instanceId ? { instanceId: target.instanceId } : {}),
    ...(target.isRunning !== undefined ? { isRunning: target.isRunning } : {}),
    ...(extraCtx || {}),
  };

  const specs: ContextMenuItemSpec[] = [];
  const seen = new Set<string>();

  // 1. Local items (highest priority)
  if (localItems) {
    for (const item of localItems) {
      if (seen.has(item.id)) continue;
      if (item.when && !evaluateWhen(item.when, mergedWhen)) continue;
      seen.add(item.id);
      specs.push(item);
    }
  }

  if (!localOnly) {
    // 2. Manifest menus — walk chain from most specific to most generic
    const targets = chain ?? (menu ? [menu] : ['workbench/context']);
    for (const t of targets) {
      for (const entry of menuEntries) {
        if (entry.menu !== t) continue;
        if (entry.when && !evaluateWhen(entry.when, mergedWhen)) continue;
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        specs.push({
          id: entry.id,
          title: entry.title,
          command: entry.command,
          group: entry.group,
          order: entry.order ?? 100,
          disabled: entry.disabled,
          when: entry.when,
        });
      }
    }

    // 3. Action registry items with 'contextMenu' surface
    const allActions = getAllActions();
    for (const action of allActions) {
      if (!action.surfaces?.includes('contextMenu')) continue;
      if (action.when && !evaluateWhen(action.when, mergedWhen)) continue;
      if (seen.has(action.id)) continue;
      seen.add(action.id);
      specs.push({
        id: action.id,
        title: action.title,
        shortcut: action.shortcut,
        command: action.id,
        group: action.group,
        order: action.order ?? 100,
        when: action.when,
        danger: action.danger,
      });
    }
  }

  return resolveItems(specs, actionRunCtx, mergedWhen, target);
}

// ─── Resolution: specs → renderable items ───────────────────

function resolveItems(
  specs: ContextMenuItemSpec[],
  actionRunCtx?: ActionRunContext,
  whenCtx?: Record<string, unknown>,
  target?: ContextMenuRequest['target'],
): ResolvedContextMenuItem[] {
  // Sort: group order → item order → title
  const sorted = [...specs].sort((a, b) => {
    const gA = a.group ? GROUP_ORDER.indexOf(a.group) : -1;
    const gB = b.group ? GROUP_ORDER.indexOf(b.group) : -1;
    if (gA !== gB) return (gB === -1 ? 1 : gA === -1 ? -1 : gA - gB);
    if ((a.order ?? 100) !== (b.order ?? 100)) return (a.order ?? 100) - (b.order ?? 100);
    return a.title.localeCompare(b.title);
  });

  return sorted.map(spec => specToResolved(spec, actionRunCtx, whenCtx, target));
}

function specToResolved(
  spec: ContextMenuItemSpec,
  actionRunCtx?: ActionRunContext,
  whenCtx?: Record<string, unknown>,
  target?: ContextMenuRequest['target'],
): ResolvedContextMenuItem {
  const hasChildren = spec.children && spec.children.length > 0;

  let action: () => void;
  if (hasChildren) {
    action = () => {}; // submenu parent — no-op on click
  } else if (spec.command) {
    action = () => dispatchCommand(spec.command!, spec.args, actionRunCtx, target);
  } else {
    action = () => {}; // no command, no children — info item
  }

  return {
    id: spec.id,
    label: spec.title,
    icon: spec.icon,
    shortcut: spec.shortcut,
    action,
    disabled: spec.disabled,
    disabledReason: spec.disabledReason,
    danger: spec.danger,
    checked: spec.checked,
    divider: spec.separator,
    group: spec.group,
    order: spec.order,
    children: spec.children
      ? spec.children.map(c => specToResolved(c, actionRunCtx, whenCtx, target))
      : undefined,
  };
}

// ─── Command dispatch ───────────────────────────────────────

function dispatchCommand(
  command: string,
  args: Record<string, unknown> | undefined,
  actionRunCtx?: ActionRunContext,
  target?: ContextMenuRequest['target'],
): void {
  // 1. Action registry first
  const action = getAction(command);
  if (action && actionRunCtx) {
    const mergedCtx = {
      ...actionRunCtx,
      ...(target ? { target } : {}),
      ...(args ? { args } : {}),
    };
    action.run(mergedCtx as any);
    return;
  }

  // 2. Fallback sendCommand
  if (actionRunCtx && 'sendCommand' in actionRunCtx) {
    const payload = {
      ...(args || {}),
      ...(target ? { target } : {}),
    };
    (actionRunCtx as any).sendCommand(command, payload);
    return;
  }

  console.warn(`[context-menu] No handler for command "${command}" and no sendCommand available`);
}
