// ─── Workbench State — unified Pane/Tab/View model ────────────
// Replaces the ad-hoc splitLayout + showTerminal pattern with a
// proper recursive layout tree where all views are first-class panes.

export type ViewType =
  | 'empty'
  | (string & {});

export interface PaneTab {
  id: string;
  title: string;
  viewType: ViewType;
  instanceId?: string;
  pluginId?: string;
  /** SharedSurface id — set when this tab is backed by a shared surface (surface protocol) */
  _surfaceId?: string;
  /** RemoteOperation id — for sending input/cancel to the surface's runtime */
  _operationId?: string;
}

export interface PaneState {
  kind: 'pane';
  id: string;
  tabs: PaneTab[];
  activeTabId: string;
  zone: 'main' | 'bottom';
  minSize?: number;
}

export interface SplitNode {
  kind: 'split';
  id: string;
  direction: 'horizontal' | 'vertical';
  children: LayoutNode[];
  /** Relative sizes (flex-grow) for each child, 1 each if omitted. */
  sizes?: number[];
}

export type LayoutNode = SplitNode | PaneState;

export interface WorkbenchState {
  root: LayoutNode;
  activePaneId: string;
  bottom: PaneState | null;
}

import { getAllViewEntries, getAdapterViewId, getAllAdapterTypes } from '../main/view-registry';

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

/** Pick the best default view type from what's registered. */
export function getDefaultViewType(): string {
  // Prefer the first adapter's mapped view
  const adapters = getAllAdapterTypes();
  if (adapters.length > 0) {
    const vid = getAdapterViewId(adapters[0].id);
    if (vid) return vid;
  }
  // Fall back to the first non-empty registered view
  const entries = getAllViewEntries();
  const first = entries.find(([id]) => id !== 'empty');
  return first?.[0] || 'empty';
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

export function createInitialState(instanceId?: string, defaultVType?: string): WorkbenchState {
  const tabId = genTabId();
  const paneId = genPaneId();
  const tab: PaneTab = {
    id: tabId,
    title: 'New',
    viewType: 'empty',
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

export type WorkbenchAction =
  | { type: 'FOCUS_PANE'; paneId: string }
  | { type: 'CLOSE_TAB'; paneId: string; tabId: string }
  | { type: 'SPLIT_PANE'; paneId: string; direction: 'horizontal' | 'vertical'; newInstanceId?: string; viewType?: string }
  | { type: 'UNSPLIT_PANE'; paneId: string }
  | { type: 'ADD_TAB'; paneId: string; tab: PaneTab; activate?: boolean }
  | { type: 'SET_ACTIVE_TAB'; paneId: string; tabId: string }
  | { type: 'SET_TAB_VIEW'; paneId: string; tabId: string; viewType: ViewType; title: string; instanceId?: string; _surfaceId?: string; _operationId?: string }
  | { type: 'ADD_EMPTY_PANE' }
  | { type: 'ADD_BOTTOM_PANE'; tab?: PaneTab }
  | { type: 'SET_BOTTOM_HEIGHT'; height: number }
  | { type: 'REMOVE_PANE'; paneId: string }
  | { type: 'CLOSE_BOTTOM_PANE' }
  | { type: 'SPLIT_PANE_VERTICAL'; paneId: string; newInstanceId?: string }
  | { type: 'SPLIT_PANE_HORIZONTAL'; paneId: string; newInstanceId?: string }
  | { type: 'REORDER_TABS'; paneId: string; tabId: string; targetId: string }
  | { type: 'CLEAR_INSTANCE_TABS'; instanceId: string };

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
      const split: SplitNode = {
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
      // Walk tree: if action.paneId is inside a SplitNode, collapse it
      // For simplicity, just remove the split and keep the first pane
      const found = findPane(state.root, action.paneId);
      if (!found) return state;
      // Replace the entire root with just this pane
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
      // Update an existing tab's viewType (empty → real view after user picks one)
      const pane = findPane(state.root, action.paneId) || state.bottom;
      if (!pane || pane.kind !== 'pane') return state;
      const newTabs = pane.tabs.map(t => {
        if (t.id !== action.tabId) return t;
        const updated = { ...t, viewType: action.viewType, title: action.title, instanceId: action.instanceId };
        if (action._surfaceId !== undefined) (updated as any)._surfaceId = action._surfaceId;
        if (action._operationId !== undefined) (updated as any)._operationId = action._operationId;
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
      // Add as extra child to root split
      return {
        ...state,
        root: { ...state.root, children: [...state.root.children, empty] },
        activePaneId: empty.id,
      };
    }

    case 'ADD_BOTTOM_PANE': {
      if (state.bottom) return state; // already open
      const tabId = genTabId();
      const defaultVType = getDefaultViewType();
      const bottom: PaneState = {
        kind: 'pane',
        id: genPaneId(),
        tabs: [action.tab || { id: tabId, title: defaultVType.charAt(0).toUpperCase() + defaultVType.slice(1), viewType: defaultVType as ViewType }],
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
      let root = state.root;
      if (root.kind === 'pane') {
        root = clearPane(root);
      } else {
        root = { ...root, children: root.children.map(c => c.kind === 'pane' ? clearPane(c) : c) };
      }
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

export interface AppWorkbenchState {
  /** Per-instance layout trees — keyed by instanceId */
  instanceStates: Record<string, WorkbenchState>;
  /** Fallback layout when no instance is selected */
  globalState: WorkbenchState;
  /** Which instance's layout is currently shown. null → global layout */
  activeInstanceId: string | null;
  /** Tabs that have been marked "Keep" (survive refresh, shown in ≡ menu when closed) */
  persistentTabs: PaneTab[];
  /** Node IDs that appear in the NodeBar (not tab-level processes like shell terminals). */
  workbenchInstanceIds: string[];
  /** Cached runtime replay outputs keyed by surfaceId (for tab previews) */
  tabOutputs?: Record<string, any[]>;
  /** Cached runtime statuses keyed by surfaceId */
  runtimeStatuses?: Record<string, string>;
  /** Cached runtime results keyed by surfaceId */
  runtimeResults?: Record<string, any>;
}

export type AppWorkbenchAction =
  | { type: 'INSTANCE_ACTION'; instanceId: string; action: WorkbenchAction }
  | { type: 'GLOBAL_ACTION'; action: WorkbenchAction }
  | { type: 'SET_ACTIVE_INSTANCE'; instanceId: string | null }
  | { type: 'RESTORE_INSTANCE_STATE'; instanceId: string; state: WorkbenchState }
  | { type: 'REMOVE_INSTANCE_LAYOUT'; instanceId: string }
  | { type: 'KEEP_TAB'; tab: PaneTab }
  | { type: 'UNKEEP_TAB'; tabId: string }
  | { type: 'ADD_WORKBENCH_INSTANCE'; instanceId: string }
  | { type: 'REMOVE_WORKBENCH_INSTANCE'; instanceId: string }
  | { type: 'SET_WORKBENCH_INSTANCES'; instanceIds: string[] };

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
      if (state.instanceStates[action.instanceId]) return state; // already exists
      return {
        ...state,
        instanceStates: { ...state.instanceStates, [action.instanceId]: action.state },
      };
    case 'REMOVE_INSTANCE_LAYOUT': {
      const { [action.instanceId]: _, ...rest } = state.instanceStates;
      return {
        ...state,
        instanceStates: rest,
        // Keep activeInstanceId — don't kick user back to root. If the layout
        // that was removed happens to be the active one, getActiveWorkbenchState
        // falls back to globalState.
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

// ─── localStorage persistence ────────────────────────────────

const STORAGE_LAYOUTS_KEY = 'sb-instance-layouts';
const STORAGE_PERSISTENT_KEY = 'sb-persistent-tabs';
const STORAGE_WORKBENCH_IDS_KEY = 'sb-workbench-ids';

function serializeLayout(state: WorkbenchState): string {
  return JSON.stringify(state);
}

function deserializeLayout(json: string): WorkbenchState | null {
  try { return JSON.parse(json); } catch { return null; }
}

export function saveLayoutsToStorage(
  instanceStates: Record<string, WorkbenchState>,
  persistentTabs: PaneTab[],
  workbenchInstanceIds?: string[],
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
  } catch { /* best effort */ }
}

export function loadLayoutsFromStorage(): {
  instanceStates: Record<string, string>;
  persistentTabs: PaneTab[];
  workbenchInstanceIds: string[];
} | null {
  try {
    const layoutsRaw = localStorage.getItem(STORAGE_LAYOUTS_KEY);
    const persistentRaw = localStorage.getItem(STORAGE_PERSISTENT_KEY);
    const workbenchRaw = localStorage.getItem(STORAGE_WORKBENCH_IDS_KEY);
    if (!layoutsRaw && !persistentRaw && !workbenchRaw) return null;
    return {
      instanceStates: layoutsRaw ? JSON.parse(layoutsRaw) : {},
      persistentTabs: persistentRaw ? JSON.parse(persistentRaw) : [],
      workbenchInstanceIds: workbenchRaw ? JSON.parse(workbenchRaw) : [],
    };
  } catch { return null; }
}

/** Given saved serialized layouts + current server instances, return deserialized states. */
/** Clear stale instanceIds on restored tab data that no longer exist
 *  on the current relay (instance IDs rotate on every relay restart). */
function cleanStaleInstanceIds(state: WorkbenchState, validIds: Set<string>): void {
  const clean = (pane: PaneState) => {
    for (const tab of pane.tabs) {
      if (tab.instanceId && !validIds.has(tab.instanceId)) {
        (tab as any).instanceId = undefined;
      }
    }
  };
  visitPanes(state.root, clean);
  if (state.bottom) clean(state.bottom);
}

export function restoreInstanceStatesFromStorage(
  savedStr: Record<string, string>,
  persistentTabs: PaneTab[],
  serverInstanceIds: string[],
): { states: Record<string, WorkbenchState>; persistentTabs: PaneTab[] } {
  const states: Record<string, WorkbenchState> = {};
  const validIdSet = new Set(serverInstanceIds);
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
  return { states, persistentTabs: persistentTabs.filter(t => t && t.id) };
}
