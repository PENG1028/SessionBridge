// ─── Workbench State — unified Pane/Tab/View model ────────────
// Replaces the ad-hoc splitLayout + showTerminal pattern with a
// proper recursive layout tree where all views are first-class panes.

// Re-export types from the dedicated types file
export type {
  ViewType,
  PaneTab,
  PaneState,
  SplitNode,
  LayoutNode,
  WorkbenchState,
  WorkbenchAction,
  AppWorkbenchState,
  AppWorkbenchAction,
} from './workbench-state.types';

// Re-export persistence
export {
  saveLayoutsToStorage,
  loadLayoutsFromStorage,
  restoreInstanceStatesFromStorage,
} from './workbench-persistence';

import type { PaneTab, PaneState, LayoutNode, WorkbenchState, WorkbenchAction, AppWorkbenchState, AppWorkbenchAction, ViewType } from './workbench-state.types';
import { getAllViewEntries } from '../main/view-registry';
import { firstLaunchableViewId } from '../plugin-host/launchability';

/** Collect all non-empty tabs from a workbench state (flat list). */
export function collectAllTabs(state: WorkbenchState): PaneTab[] {
  const tabs: PaneTab[] = [];
  visitPanes(state.root, pane => {
    for (const tab of pane.tabs) {
      if (tab.viewType !== 'empty') tabs.push(tab);
    }
  });
  if (state.bottom) {
    for (const tab of state.bottom.tabs) {
      if (tab.viewType !== 'empty') tabs.push(tab);
    }
  }
  return tabs;
}

/** Build a single-pane WorkbenchState from a flat tab list. */
export function buildStateFromTabs(tabs: PaneTab[], preserveActiveTabId?: string): WorkbenchState {
  const paneId = genPaneId();
  if (tabs.length === 0) {
    return createInitialState();
  }
  const activeTabId = preserveActiveTabId && tabs.some(t => t.id === preserveActiveTabId)
    ? preserveActiveTabId
    : tabs[0].id;
  return {
    root: { kind: 'pane' as const, id: paneId, tabs, activeTabId, zone: 'main' as const },
    activePaneId: paneId,
    bottom: null,
  };
}

// ─── ID generation ─────────────────────────────────────────────

let _counter = 0;
export function genPaneId(): string {
  return `pane_${++_counter}_${Date.now().toString(36)}`;
}
export function genTabId(): string {
  return `tab_${++_counter}_${Date.now().toString(36)}`;
}

/** Pick the best default view type from registered views that are launchable.
 *  Returns the first direct-launchable view, NOT an adapter-only mapping.
 *  If no direct launchable view exists, returns 'empty'. */
export function getDefaultViewType(): string {
  const entries = getAllViewEntries();
  return firstLaunchableViewId(entries) || 'empty';
}

// ─── Tree helpers ──────────────────────────────────────────────

export function findPane(node: LayoutNode, paneId: string): PaneState | null {
  if (node.kind === 'pane') {
    return node.id === paneId ? node : null;
  }
  for (const child of node.children) {
    const found = findPane(child, paneId);
    if (found) return found;
  }
  return null;
}

export function visitPanes(node: LayoutNode, fn: (pane: PaneState) => void): void {
  if (node.kind === 'pane') {
    fn(node);
  } else {
    for (const child of node.children) {
      visitPanes(child, fn);
    }
  }
}

function replaceNode(root: LayoutNode, paneId: string, replacement: LayoutNode): LayoutNode {
  if (root.kind === 'pane') {
    return root.id === paneId ? replacement : root;
  }
  return {
    ...root,
    children: root.children.map(c => replaceNode(c, paneId, replacement)),
  };
}

function removeNode(root: LayoutNode, paneId: string): LayoutNode | null {
  if (root.kind === 'pane') {
    return root.id === paneId ? null : root;
  }
  const filtered = root.children
    .map(c => removeNode(c, paneId))
    .filter((c): c is LayoutNode => c !== null);
  if (filtered.length === 0) return null;
  if (filtered.length === 1 && root.children.length !== filtered.length) {
    // Collapse single-child split
    return filtered[0];
  }
  return { ...root, children: filtered };
}

// ─── Initial state ─────────────────────────────────────────────

export function createInitialState(instanceId?: string, viewType?: string): WorkbenchState {
  const tabId = genTabId();
  const paneId = genPaneId();
  const vtype = viewType || 'empty';
  const tab: PaneTab = {
    id: tabId,
    title: vtype === 'terminal' ? 'Terminal' : 'New',
    viewType: vtype as ViewType,
    instanceId: instanceId || undefined,
  };
  return {
    root: { kind: 'pane', id: paneId, tabs: [tab], activeTabId: tabId, zone: 'main' },
    activePaneId: paneId,
    bottom: null,
  };
}

export function createEmptyPane(zone: 'main' | 'bottom' = 'main'): PaneState {
  const tabId = genTabId();
  const paneId = genPaneId();
  return {
    kind: 'pane',
    id: paneId,
    tabs: [{ id: tabId, title: 'New', viewType: 'empty' }],
    activeTabId: tabId,
    zone,
  };
}

// ─── Reducer ───────────────────────────────────────────────────

export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case 'FOCUS_PANE':
      return { ...state, activePaneId: action.paneId };

    case 'CLOSE_TAB': {
      const pane = findPane(state.root, action.paneId) || state.bottom;
      if (!pane || pane.kind !== 'pane') return state;
      // Last tab is 'empty' placeholder — cannot close
      if (pane.tabs.length === 1 && pane.tabs[0].viewType === 'empty') return state;
      if (pane.tabs.length <= 1) {
        // Last non-empty tab — replace with empty tab so user can pick a new view
        const emptyTabId = genTabId();
        const emptyTab: PaneTab = { id: emptyTabId, title: 'New', viewType: 'empty' };
        const updatedPane: PaneState = { ...pane, tabs: [emptyTab], activeTabId: emptyTabId };
        if (pane.zone === 'bottom') {
          return { ...state, bottom: updatedPane };
        }
        return { ...state, root: replaceNode(state.root, action.paneId, updatedPane) };
      }
      const newTabs = pane.tabs.filter(t => t.id !== action.tabId);
      const wasActive = pane.activeTabId === action.tabId;
      const newActiveTabId = wasActive ? newTabs[newTabs.length - 1].id : pane.activeTabId;
      const updatedPane: PaneState = { ...pane, tabs: newTabs, activeTabId: newActiveTabId };
      if (pane.zone === 'bottom') {
        return { ...state, bottom: updatedPane };
      }
      return { ...state, root: replaceNode(state.root, action.paneId, updatedPane) };
    }

    case 'SPLIT_PANE': {
      const pane = findPane(state.root, action.paneId);
      if (!pane || pane.kind !== 'pane') return state;
      const tabId = genTabId();
      const newPane: PaneState = {
        kind: 'pane',
        id: genPaneId(),
        tabs: [{
          id: tabId,
          title: action.newInstanceId ? action.newInstanceId.slice(0, 12) : 'New',
          viewType: (action.viewType as ViewType) || getDefaultViewType(),
          instanceId: action.newInstanceId,
        }],
        activeTabId: tabId,
        zone: 'main',
      };
      const split: import('./workbench-state.types').SplitNode = {
        kind: 'split',
        id: genPaneId(),
        direction: action.direction,
        children: [pane, newPane],
      };
      return {
        ...state,
        root: replaceNode(state.root, action.paneId, split),
        activePaneId: newPane.id,
      };
    }

    case 'UNSPLIT_PANE': {
      const found = findPane(state.root, action.paneId);
      if (!found) return state;
      const keep: PaneState = {
        ...found,
        id: genPaneId(),
        tabs: found.tabs.map(t => ({ ...t, id: genTabId() })),
        activeTabId: found.activeTabId,
      };
      return { ...state, root: keep, activePaneId: keep.id };
    }

    case 'ADD_TAB': {
      const pane = findPane(state.root, action.paneId) || state.bottom;
      if (!pane || pane.kind !== 'pane') return state;
      const shouldActivate = action.activate !== false;
      const updatedPane: PaneState = {
        ...pane,
        tabs: [...pane.tabs, action.tab],
        activeTabId: shouldActivate ? action.tab.id : pane.activeTabId,
      };
      if (pane.zone === 'bottom') {
        return { ...state, bottom: updatedPane };
      }
      return { ...state, root: replaceNode(state.root, action.paneId, updatedPane) };
    }

    case 'SET_ACTIVE_TAB': {
      const pane = findPane(state.root, action.paneId) || state.bottom;
      if (!pane || pane.kind !== 'pane') return state;
      if (pane.zone === 'bottom') {
        return { ...state, bottom: { ...pane, activeTabId: action.tabId } };
      }
      return {
        ...state,
        root: replaceNode(state.root, action.paneId, { ...pane, activeTabId: action.tabId }),
      };
    }

    case 'SET_TAB_VIEW': {
      const pane = findPane(state.root, action.paneId) || state.bottom;
      if (!pane || pane.kind !== 'pane') return state;
      const newTabs = pane.tabs.map(t => {
        if (t.id !== action.tabId) return t;
        const updated = { ...t, viewType: action.viewType, title: action.title, instanceId: action.instanceId };
        if (action._surfaceId !== undefined) (updated as any)._surfaceId = action._surfaceId;
        return updated;
      });
      const updatedPane: PaneState = { ...pane, tabs: newTabs };
      if (pane.zone === 'bottom') {
        return { ...state, bottom: updatedPane };
      }
      return { ...state, root: replaceNode(state.root, action.paneId, updatedPane) };
    }

    case 'SPLIT_PANE_VERTICAL':
      return workbenchReducer(state, { type: 'SPLIT_PANE', paneId: action.paneId, direction: 'vertical', newInstanceId: action.newInstanceId });

    case 'SPLIT_PANE_HORIZONTAL':
      return workbenchReducer(state, { type: 'SPLIT_PANE', paneId: action.paneId, direction: 'horizontal', newInstanceId: action.newInstanceId });

    case 'ADD_EMPTY_PANE': {
      const empty = createEmptyPane('main');
      if (state.root.kind === 'pane') {
        return {
          ...state,
          root: {
            kind: 'split',
            id: genPaneId(),
            direction: 'horizontal',
            children: [state.root, empty],
          },
          activePaneId: empty.id,
        };
      }
      return {
        ...state,
        root: { ...state.root, children: [...state.root.children, empty] },
        activePaneId: empty.id,
      };
    }

    case 'ADD_BOTTOM_PANE': {
      if (state.bottom) return state;
      const tabId = genTabId();
      const bottom: PaneState = {
        kind: 'pane',
        id: genPaneId(),
        tabs: [action.tab || { id: tabId, title: 'Terminal', viewType: 'terminal' as ViewType }],
        activeTabId: action.tab?.id || tabId,
        zone: 'bottom',
        minSize: 100,
      };
      return { ...state, bottom };
    }

    case 'SET_BOTTOM_HEIGHT':
      return state.bottom
        ? { ...state, bottom: { ...state.bottom, minSize: action.height } }
        : state;

    case 'CLOSE_BOTTOM_PANE':
      return { ...state, bottom: null };

    case 'REMOVE_PANE': {
      if (state.bottom?.id === action.paneId) {
        return { ...state, bottom: null };
      }
      const newRoot = removeNode(state.root, action.paneId);
      if (!newRoot) return state;
      let newFocus = state.activePaneId;
      if (action.paneId === state.activePaneId) {
        const first = findFirstPane(newRoot);
        newFocus = first?.id || state.activePaneId;
      }
      return { ...state, root: newRoot, activePaneId: newFocus };
    }

    case 'REORDER_TABS': {
      const pane = findPane(state.root, action.paneId) || state.bottom;
      if (!pane || pane.kind !== 'pane') return state;
      const tabs = [...pane.tabs];
      const srcIdx = tabs.findIndex(t => t.id === action.tabId);
      const tgtIdx = tabs.findIndex(t => t.id === action.targetId);
      if (srcIdx < 0 || tgtIdx < 0) return state;
      const [moved] = tabs.splice(srcIdx, 1);
      tabs.splice(tgtIdx, 0, moved);
      const updatedPane: PaneState = { ...pane, tabs };
      if (pane.zone === 'bottom') {
        return { ...state, bottom: updatedPane };
      }
      return { ...state, root: replaceNode(state.root, action.paneId, updatedPane) };
    }

    case 'CLEAR_INSTANCE_TABS': {
      const clearTab = (t: PaneTab) =>
        t.instanceId === action.instanceId
          ? { ...t, viewType: 'empty' as ViewType, title: 'New', instanceId: undefined }
          : t;
      const clearPane = (p: PaneState) =>
        p ? { ...p, tabs: p.tabs.map(clearTab) } : p;
      const clearTree = (node: LayoutNode): LayoutNode => {
        if (node.kind === 'pane') return clearPane(node);
        return { ...node, children: node.children.map(clearTree) };
      };
      const root = clearTree(state.root);
      const bottom = state.bottom ? clearPane(state.bottom) : null;
      return { ...state, root, bottom };
    }

    default:
      return state;
  }
}

// ─── Utilities ─────────────────────────────────────────────────

function findFirstPane(node: LayoutNode): PaneState | null {
  if (node.kind === 'pane') return node;
  return findFirstPane(node.children[0]);
}

/** Find which pane contains a given instanceId. */
export function findPaneByInstance(state: WorkbenchState, instanceId: string): PaneState | null {
  let found: PaneState | null = null;
  visitPanes(state.root, p => {
    if (p.tabs.some(t => t.instanceId === instanceId)) found = p;
  });
  if (!found && state.bottom) {
    if (state.bottom.tabs.some(t => t.instanceId === instanceId)) found = state.bottom;
  }
  return found;
}

/** Ensure an instance has a tab, adding to the active pane if not found. */
export function ensureInstanceTab(state: WorkbenchState, instanceId: string, title?: string, defaultViewType?: string): WorkbenchState {
  const existing = findPaneByInstance(state, instanceId);
  if (existing) return state;
  const activePane = findPane(state.root, state.activePaneId);
  if (activePane) {
    const vType = defaultViewType || getDefaultViewType();
    const tab: PaneTab = {
      id: genTabId(),
      title: title || instanceId.slice(0, 12),
      viewType: vType as ViewType,
      instanceId,
    };
    return workbenchReducer(state, { type: 'ADD_TAB', paneId: activePane.id, tab });
  }
  return state;
}

// ═══════════════════════════════════════════════════════════════
// AppWorkbenchState — multi-instance wrapper
// ═══════════════════════════════════════════════════════════════

export function appReducer(state: AppWorkbenchState, action: AppWorkbenchAction): AppWorkbenchState {
  switch (action.type) {
    case 'INSTANCE_ACTION': {
      const prev = state.instanceStates[action.instanceId];
      if (!prev) return state;
      return {
        ...state,
        instanceStates: {
          ...state.instanceStates,
          [action.instanceId]: workbenchReducer(prev, action.action),
        },
      };
    }
    case 'GLOBAL_ACTION':
      return { ...state, globalState: workbenchReducer(state.globalState, action.action) };
    case 'SET_ACTIVE_INSTANCE':
      return { ...state, activeInstanceId: action.instanceId };
    case 'RESTORE_INSTANCE_STATE':
      if (state.instanceStates[action.instanceId]) return state;
      return {
        ...state,
        instanceStates: { ...state.instanceStates, [action.instanceId]: action.state },
      };
    case 'REMOVE_INSTANCE_LAYOUT': {
      const { [action.instanceId]: _, ...rest } = state.instanceStates;
      return {
        ...state,
        instanceStates: rest,
        workbenchInstanceIds: state.workbenchInstanceIds.filter(id => id !== action.instanceId),
      };
    }
    case 'KEEP_TAB':
      if (state.persistentTabs.some(t => t.id === action.tab.id)) return state;
      return { ...state, persistentTabs: [...state.persistentTabs, action.tab] };
    case 'UNKEEP_TAB':
      return { ...state, persistentTabs: state.persistentTabs.filter(t => t.id !== action.tabId) };
    case 'ADD_WORKBENCH_INSTANCE':
      if (state.workbenchInstanceIds.includes(action.instanceId)) return state;
      return { ...state, workbenchInstanceIds: [...state.workbenchInstanceIds, action.instanceId] };
    case 'REMOVE_WORKBENCH_INSTANCE':
      return { ...state, workbenchInstanceIds: state.workbenchInstanceIds.filter(id => id !== action.instanceId) };
    case 'SET_WORKBENCH_INSTANCES':
      return { ...state, workbenchInstanceIds: action.instanceIds };
    default:
      return state;
  }
}

/** Get the active WorkbenchState for rendering. */
export function getActiveWorkbenchState(app: AppWorkbenchState): WorkbenchState {
  if (app.activeInstanceId && app.instanceStates[app.activeInstanceId]) {
    return app.instanceStates[app.activeInstanceId];
  }
  return app.globalState;
}

/** Create initial AppWorkbenchState — global layout starts empty, no instance selected. */
export function createAppInitialState(): AppWorkbenchState {
  const emptyPane = createEmptyPane('main');
  return {
    instanceStates: {},
    globalState: { root: emptyPane, activePaneId: emptyPane.id, bottom: null },
    activeInstanceId: null,
    persistentTabs: [],
    workbenchInstanceIds: [],
  };
}
