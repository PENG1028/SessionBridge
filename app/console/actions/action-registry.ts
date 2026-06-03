'use client';

// ── Action Surface Registry ────────────────────────────────────
// Phase 4E: Central registry for all workbench actions. Actions
// are registered once at startup and queried by surface at render
// time. Supports when-condition filtering and group/order sorting.
//
// Usage:
//   registerAction({ id: 'host.settings.open', title: 'Settings', ... });
//   const headerActions = getActions('header.right', whenContext);

import type { WorkbenchAction, ActionSurface, ActionRunContext } from './action-types';
import { evaluateWhen } from '../../../lib/evaluate-when';

const _actions = new Map<string, WorkbenchAction>();
const _initialized = { current: false };

export function registerAction(action: WorkbenchAction): void {
  _actions.set(action.id, action);
}

export function unregisterAction(id: string): void {
  _actions.delete(id);
}

export function getAction(id: string): WorkbenchAction | undefined {
  return _actions.get(id);
}

/** Get all actions for a given surface, optionally filtered by when-context. */
export function getActions(
  surface: ActionSurface,
  whenContext?: Record<string, unknown>,
): WorkbenchAction[] {
  const results: WorkbenchAction[] = [];
  for (const action of _actions.values()) {
    if (!action.surfaces.includes(surface)) continue;
    if (whenContext && action.when) {
      if (!evaluateWhen(action.when, whenContext)) continue;
    }
    results.push(action);
  }
  results.sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  return results;
}

/** Execute an action by ID with the given context. */
export function runAction(id: string, ctx: ActionRunContext): void {
  const action = _actions.get(id);
  if (action) {
    action.run(ctx);
  } else {
    if (process.env.NODE_ENV !== 'production') console.warn(`[actions] No handler registered for "${id}"`);
  }
}

export function getAllActions(): WorkbenchAction[] {
  return Array.from(_actions.values());
}

/** Guard flag to ensure core actions are registered only once. */
export function isInitialized(): boolean {
  return _initialized.current;
}

export function setInitialized(): void {
  _initialized.current = true;
}
