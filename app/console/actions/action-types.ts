'use client';

// ── Action Surface Registry Types ──────────────────────────────
// Phase 4E: Lightweight action surface registry. Actions are
// registered once at startup and queried by surface at render time.

import type { WorkbenchAction as WbAction } from '../stage/workbench-state.types';
import type { Message } from '../hooks/block-types';

/** UI surfaces that can host actions. */
export type ActionSurface =
  | 'commandPalette'
  | 'contextMenu'
  | 'quickActions'
  | 'header.right'
  | 'header.left'
  | 'statusBar.left'
  | 'statusBar.right'
  | 'keybinding';

/** Runtime context passed to action handlers. */
export interface ActionRunContext {
  view: string;
  activeAdapterId: string;
  isRunning: boolean;
  instanceId: string | null;
  projectCwd: string;
  messages: readonly Message[];
  workbenchState: unknown;
  workbenchDispatch: (action: WbAction) => void;
  sendCommand: (cmd: string, args?: Record<string, unknown>, sessionId?: string) => void;
  sendInput: (text: string, sessionId?: string) => void;
  createInstance: (dir: string, label?: string, adapterId?: string) => unknown;
  killInstance: (id: string) => void;
  openSettings: () => void;
  openSearch: () => void;
  openCommandPalette: () => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  notify: (n: { type: string; title: string; message?: string }) => void;
}

/** A registered workbench action. */
export interface WorkbenchAction {
  id: string;
  title: string;
  category?: string;
  /** Lucide icon name (kebab-case, e.g. 'search', 'settings'). */
  icon?: string;
  /** When-condition expression evaluated against WhenContext. */
  when?: string;
  /** Surfaces this action appears on. */
  surfaces: ActionSurface[];
  /** Group for menu/dropdown ordering ('navigation', 'edit', etc.). */
  group?: string;
  /** Sort order within its surface/group (lower = first). */
  order?: number;
  /** Keyboard shortcut label shown in UI (e.g. '⌘K'). */
  shortcut?: string;
  /** Machine-readable keybinding (e.g. 'Ctrl+K'). */
  keybinding?: string;
  /** Whether the action is destructive. */
  danger?: boolean;
  /** Execute the action. */
  run: (ctx: ActionRunContext) => void;
}
