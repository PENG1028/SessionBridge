'use client';

// ── Context Menu Provider Model ──────────────────────────────
// Phase 4K: Host-owned context menu system with three sources:
//   1. Manifest contributions (stable surfaces only)
//   2. Action registry items with 'contextMenu' surface
//   3. Component localItems (runtime, dynamic)
//
// Host owns rendering, positioning, clamping, keyboard nav,
// mobile fallback, and command dispatch.
//
// Plugins own local intent — components call openContextMenu()
// with a ContextMenuRequest to specify target + chain + localItems.

/**
 * What was clicked — carries enough context for menu items to
 * make decisions and for when-condition evaluation.
 */
export interface ContextMenuTarget {
  /** Target kind: "workbench", "view", "terminal", "chat", "tab", "instance", "file", "panel", "message", "selection" */
  kind: string;
  /** Unique ID of the target item (tabId, instanceId, nodeId, etc.) */
  id?: string;
  /** View type if target lives inside a view */
  view?: string;
  /** Adapter ID if target is bound to an adapter */
  adapterId?: string;
  /** Instance ID if target is bound to a runtime instance */
  instanceId?: string;
  /** Whether the bound instance is running */
  isRunning?: boolean;
  /** Tab ID if target is a pane tab */
  tabId?: string;
  /** Panel ID if target is a side panel */
  panelId?: string;
  /** File path if target is a file node */
  path?: string;
  /** Whether the target is a directory */
  isDirectory?: boolean;
  /** Message ID if target is a chat message */
  messageId?: string;
  /** Block ID if target is a tool block */
  blockId?: string;
  /** Row ID if target is a list/table row */
  rowId?: string;
  /** Tree node ID if target is a tree node */
  nodeId?: string;
  /** Extra payload carried by the caller */
  data?: Record<string, unknown>;
}

/**
 * Full request to open a context menu.
 */
export interface ContextMenuRequest {
  /** The mouse event that triggered the menu */
  event: React.MouseEvent | MouseEvent;
  /**
   * Menu target identifier (for manifest menu lookup).
   * Falls back to the first matching chain entry.
   */
  menu?: string;
  /**
   * Lookup chain from most specific to most generic.
   * Example: ["message/context", "chat/context", "view/context", "workbench/context"]
   * Each entry is tried as a menu target for manifest contributions.
   */
  chain?: string[];
  /** The clicked target */
  target: ContextMenuTarget;
  /** Extra when-condition context merged with the focus context */
  whenContext?: Record<string, unknown>;
  /**
   * Local items provided by the calling component.
   * These take highest priority during merge.
   */
  localItems?: ContextMenuItemSpec[];
  /**
   * If true, skip manifest and action registry lookups.
   * Useful for components that want full control.
   */
  localOnly?: boolean;
}

/**
 * Specification for a single context menu item.
 * Supports nesting, checked state, icons, and command dispatch.
 */
export interface ContextMenuItemSpec {
  /** Unique ID for dedup */
  id: string;
  /** Display label */
  title: string;
  /** Optional icon name (host-mapped) */
  icon?: string;
  /** Keyboard shortcut display */
  shortcut?: string;
  /** Command ID to execute on click */
  command?: string;
  /** Arguments merged with target payload at dispatch time */
  args?: Record<string, unknown>;
  /** When-condition expression evaluated against merged context */
  when?: string;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Reason shown when disabled (tooltip or secondary text) */
  disabledReason?: string;
  /** Render in danger/red style */
  danger?: boolean;
  /** Show a checkmark */
  checked?: boolean;
  /** Render as a visual separator */
  separator?: boolean;
  /** Group key for sorting ("navigation", "edit", "debug", "view") */
  group?: string;
  /** Sort order within group (lower = first) */
  order?: number;
  /** Nested submenu items */
  children?: ContextMenuItemSpec[];
}

/**
 * Resolved menu item ready for rendering.
 * Converted from ContextMenuItemSpec by merging manifest metadata.
 */
export interface ResolvedContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  shortcut?: string;
  action: () => void;
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
  checked?: boolean;
  divider?: boolean;
  group?: string;
  order?: number;
  children?: ResolvedContextMenuItem[];
}

/**
 * Function signature for opening a context menu.
 * Components receive this from the host hook.
 */
export type ContextMenuOpenHandler = (request: ContextMenuRequest) => void;

/**
 * Recommended menu targets for manifest contributions.
 */
export const MENU_TARGETS = {
  WORKBENCH: 'workbench/context',
  VIEW: 'view/context',
  TERMINAL: 'terminal/context',
  CHAT: 'chat/context',
  MESSAGE: 'message/context',
  FILE: 'file/context',
  TAB: 'tab/context',
  INSTANCE: 'instance/context',
  PANEL: 'panel/context',
  SELECTION: 'selection/context',
} as const;

/**
 * Default lookup chain for common target kinds.
 */
export const DEFAULT_CHAINS: Record<string, string[]> = {
  workbench: ['workbench/context'],
  view: ['view/context', 'workbench/context'],
  terminal: ['terminal/context', 'view/context', 'workbench/context'],
  chat: ['chat/context', 'view/context', 'workbench/context'],
  tab: ['tab/context', 'view/context', 'workbench/context'],
  instance: ['instance/context', 'workbench/context'],
  file: ['file/context', 'view/context', 'workbench/context'],
  panel: ['panel/context', 'workbench/context'],
  message: ['message/context', 'chat/context', 'view/context', 'workbench/context'],
  selection: ['selection/context', 'view/context', 'workbench/context'],
};
