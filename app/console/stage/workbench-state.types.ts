// ─── Workbench State Types ──────────────────────────────────
// Core type definitions for the workbench layout tree model.

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
  /** Set when a terminal tab's instanceId points to the node itself but has no
   *  valid surface backing. The tab should not render as a usable terminal. */
  _stale?: boolean;
  /** Server-side keep flag — surface persists even when no browser subscribes. */
  _keep?: boolean;
  /** Runtime process lost (relay restart) but surface preserved via keep/persistence. */
  _orphaned?: boolean;
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

export type WorkbenchAction =
  | { type: 'FOCUS_PANE'; paneId: string }
  | { type: 'CLOSE_TAB'; paneId: string; tabId: string }
  | { type: 'SPLIT_PANE'; paneId: string; direction: 'horizontal' | 'vertical'; newInstanceId?: string; viewType?: string }
  | { type: 'UNSPLIT_PANE'; paneId: string }
  | { type: 'ADD_TAB'; paneId: string; tab: PaneTab; activate?: boolean }
  | { type: 'SET_ACTIVE_TAB'; paneId: string; tabId: string }
  | { type: 'SET_TAB_VIEW'; paneId: string; tabId: string; viewType: ViewType; title: string; instanceId?: string; _surfaceId?: string }
  | { type: 'ADD_EMPTY_PANE' }
  | { type: 'ADD_BOTTOM_PANE'; tab?: PaneTab }
  | { type: 'SET_BOTTOM_HEIGHT'; height: number }
  | { type: 'REMOVE_PANE'; paneId: string }
  | { type: 'CLOSE_BOTTOM_PANE' }
  | { type: 'SPLIT_PANE_VERTICAL'; paneId: string; newInstanceId?: string }
  | { type: 'SPLIT_PANE_HORIZONTAL'; paneId: string; newInstanceId?: string }
  | { type: 'REORDER_TABS'; paneId: string; tabId: string; targetId: string }
  | { type: 'CLEAR_INSTANCE_TABS'; instanceId: string };

// ─── App-level wrapper types ───────────────────────────────

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
