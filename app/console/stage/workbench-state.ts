// ─── Workbench State — unified Pane/Tab/View model ────────────
// Replaces the ad-hoc splitLayout + showTerminal pattern with a
// proper recursive layout tree where all views are first-class panes.

export type ViewType =
  | 'terminal'
  | 'claude-chat'
  | 'claude-code'
  | 'dashboard'
  | 'agent-monitor'
  | 'logs'
  | 'ai'
  | 'file-explorer'
  | 'browser'
  | 'empty';

export interface PaneTab {
  id: string;
  title: string;
  viewType: ViewType;
  instanceId?: string;
  pluginId?: string;
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

// ─── ID generation ─────────────────────────────────────────────

let _counter = 0;
export function genPaneId(): string {
  return `pane_${++_counter}_${Date.now().toString(36)}`;
}
export function genTabId(): string {
  return `tab_${++_counter}_${Date.now().toString(36)}`;
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

export function createInitialState(instanceId?: string): WorkbenchState {
  const tabId = genTabId();
  const paneId = genPaneId();
  const tab: PaneTab = {
    id: tabId,
    title: instanceId ? instanceId.slice(0, 12) : 'Terminal',
    viewType: 'terminal',
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
    tabs: [{ id: tabId, title: 'Empty', viewType: 'empty' }],
    activeTabId: tabId,
    zone,
  };
}

function clonePane(pane: PaneState): PaneState {
  return {
    ...pane,
    id: genPaneId(),
    tabs: pane.tabs.map(t => ({ ...t, id: genTabId() })),
    activeTabId: pane.activeTabId, // will be fixed below
  };
}

// ─── Reducer ───────────────────────────────────────────────────

export type WorkbenchAction =
  | { type: 'FOCUS_PANE'; paneId: string }
  | { type: 'CLOSE_TAB'; paneId: string; tabId: string }
  | { type: 'SPLIT_PANE'; paneId: string; direction: 'horizontal' | 'vertical'; newInstanceId?: string }
  | { type: 'UNSPLIT_PANE'; paneId: string }
  | { type: 'ADD_TAB'; paneId: string; tab: PaneTab }
  | { type: 'SET_ACTIVE_TAB'; paneId: string; tabId: string }
  | { type: 'SET_TAB_VIEW'; paneId: string; tabId: string; viewType: ViewType; title: string; instanceId?: string }
  | { type: 'ADD_EMPTY_PANE' }
  | { type: 'ADD_BOTTOM_PANE'; tab?: PaneTab }
  | { type: 'SET_BOTTOM_HEIGHT'; height: number }
  | { type: 'REMOVE_PANE'; paneId: string }
  | { type: 'CLOSE_BOTTOM_PANE' }
  | { type: 'SPLIT_PANE_VERTICAL'; paneId: string; newInstanceId?: string }
  | { type: 'SPLIT_PANE_HORIZONTAL'; paneId: string; newInstanceId?: string };

export function workbenchReducer(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case 'FOCUS_PANE':
      return { ...state, activePaneId: action.paneId };

    case 'CLOSE_TAB': {
      const pane = findPane(state.root, action.paneId) || state.bottom;
      if (!pane || pane.kind !== 'pane') return state;
      if (pane.tabs.length <= 1) {
        // Last tab — remove the whole pane
        if (pane.zone === 'bottom') {
          return { ...state, bottom: null };
        }
        const newRoot = removeNode(state.root, action.paneId);
        if (!newRoot) return state;
        // Find first remaining pane to focus
        let newFocus = state.activePaneId;
        if (action.paneId === state.activePaneId) {
          const first = findFirstPane(newRoot);
          newFocus = first?.id || state.activePaneId;
        }
        return { ...state, root: newRoot, activePaneId: newFocus };
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
          viewType: 'terminal',
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
      const updatedPane: PaneState = {
        ...pane,
        tabs: [...pane.tabs, action.tab],
        activeTabId: action.tab.id,
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
      const newTabs = pane.tabs.map(t =>
        t.id === action.tabId ? { ...t, viewType: action.viewType, title: action.title, instanceId: action.instanceId } : t
      );
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
      const bottom: PaneState = {
        kind: 'pane',
        id: genPaneId(),
        tabs: [action.tab || { id: tabId, title: 'Terminal', viewType: 'terminal' }],
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
export function ensureInstanceTab(state: WorkbenchState, instanceId: string, title?: string): WorkbenchState {
  const existing = findPaneByInstance(state, instanceId);
  if (existing) return state;
  const activePane = findPane(state.root, state.activePaneId);
  if (activePane) {
    const tab: PaneTab = {
      id: genTabId(),
      title: title || instanceId.slice(0, 12),
      viewType: 'terminal',
      instanceId,
    };
    return workbenchReducer(state, { type: 'ADD_TAB', paneId: activePane.id, tab });
  }
  return state;
}
