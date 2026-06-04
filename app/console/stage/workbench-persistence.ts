// ─── Workbench Persistence — localStorage save/restore ─────
import type { WorkbenchState, PaneTab, PaneState, LayoutNode } from './workbench-state.types';

// Local tree walker (avoids circular dep on workbench-state)
function walkPanes(node: LayoutNode, fn: (pane: PaneState) => void): void {
  if (node.kind === 'pane') { fn(node); }
  else { for (const child of node.children) walkPanes(child, fn); }
}

const STORAGE_LAYOUTS_KEY = 'sb-instance-layouts';
const STORAGE_PERSISTENT_KEY = 'sb-persistent-tabs';
const STORAGE_WORKBENCH_IDS_KEY = 'sb-workbench-ids';
const STORAGE_ACTIVE_INSTANCE_KEY = 'sb-active-instance';

function serializeLayout(state: WorkbenchState): string {
  return JSON.stringify(state);
}

function deserializeLayout(json: string): WorkbenchState | null {
  try { return JSON.parse(json); } catch (_e) { return null; }
}

export function saveLayoutsToStorage(
  instanceStates: Record<string, WorkbenchState>,
  persistentTabs: PaneTab[],
  workbenchInstanceIds?: string[],
  activeInstanceId?: string | null,
): void {
  try {
    const layouts: Record<string, string> = {};
    for (const [id, state] of Object.entries(instanceStates)) {
      layouts[id] = serializeLayout(state);
    }
    localStorage.setItem(STORAGE_LAYOUTS_KEY, JSON.stringify(layouts));
    localStorage.setItem(STORAGE_PERSISTENT_KEY, JSON.stringify(persistentTabs));
    if (workbenchInstanceIds) {
      localStorage.setItem(STORAGE_WORKBENCH_IDS_KEY, JSON.stringify(workbenchInstanceIds));
    }
    if (activeInstanceId) {
      localStorage.setItem(STORAGE_ACTIVE_INSTANCE_KEY, activeInstanceId);
    } else {
      localStorage.removeItem(STORAGE_ACTIVE_INSTANCE_KEY);
    }
  } catch (_e) { /* best effort */ }
}

export function loadLayoutsFromStorage(): {
  instanceStates: Record<string, string>;
  persistentTabs: PaneTab[];
  workbenchInstanceIds: string[];
  activeInstanceId: string | null;
} | null {
  try {
    const layoutsRaw = localStorage.getItem(STORAGE_LAYOUTS_KEY);
    const persistentRaw = localStorage.getItem(STORAGE_PERSISTENT_KEY);
    const workbenchRaw = localStorage.getItem(STORAGE_WORKBENCH_IDS_KEY);
    const activeRaw = localStorage.getItem(STORAGE_ACTIVE_INSTANCE_KEY);
    if (!layoutsRaw && !persistentRaw && !workbenchRaw && !activeRaw) return null;
    return {
      instanceStates: layoutsRaw ? JSON.parse(layoutsRaw) : {},
      persistentTabs: persistentRaw ? JSON.parse(persistentRaw) : [],
      workbenchInstanceIds: workbenchRaw ? JSON.parse(workbenchRaw) : [],
      activeInstanceId: activeRaw || null,
    };
  } catch (_e) { return null; }
}

/** Clear stale instanceIds on restored tab data that no longer exist
 *  on the current relay (instance IDs rotate on every relay restart).
 *  When validIds is empty (CoreClient mode), assume all instanceIds are valid. */
function cleanStaleInstanceIds(state: WorkbenchState, validIds: Set<string>): void {
  if (validIds.size === 0) return; // CoreClient mode — no relay instances to validate against
  const clean = (pane: PaneState) => {
    for (const tab of pane.tabs) {
      if (tab.instanceId && !validIds.has(tab.instanceId)) {
        (tab as any).instanceId = undefined;
      }
    }
  };
  walkPanes(state.root, clean);
  if (state.bottom) clean(state.bottom);
}

export function restoreInstanceStatesFromStorage(
  savedStr: Record<string, string>,
  persistentTabs: PaneTab[],
  serverInstanceIds: string[],
): { states: Record<string, WorkbenchState>; persistentTabs: PaneTab[] } {
  const states: Record<string, WorkbenchState> = {};
  const validIdSet = new Set(serverInstanceIds);

  // First pass: restore states keyed by known server instance IDs
  for (const id of serverInstanceIds) {
    const saved = savedStr[id];
    if (saved) {
      const state = deserializeLayout(saved);
      if (state) {
        cleanStaleInstanceIds(state, validIdSet);
        states[id] = state;
      }
    }
  }

  // Second pass: restore states whose key doesn't match a server instance ID
  // (e.g. CoreClient node IDs like '__local__', or orphaned relay layouts).
  // Stale instance IDs are cleared; the layout (tabs, splits) is preserved.
  for (const [id, raw] of Object.entries(savedStr)) {
    if (states[id]) continue;
    if (serverInstanceIds.includes(id)) continue;
    const state = deserializeLayout(raw);
    if (state) {
      cleanStaleInstanceIds(state, validIdSet);
      states[id] = state;
    }
  }

  return { states, persistentTabs: persistentTabs.filter(t => t && t.id) };
}
