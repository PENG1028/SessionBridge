'use client';

import type { ComponentType } from 'react';

// ─── SurfaceType — all known surface locations ──────────────────
export type SurfaceType =
  // Main work area
  | 'main.editor'
  | 'main.editor.split'

  // Sidebars
  | 'sidebar.left'
  | 'sidebar.right'

  // Bottom panels
  | 'panel.bottom'

  // Header
  | 'header.left'
  | 'header.center'
  | 'header.right'

  // Status bar
  | 'statusBar.left'
  | 'statusBar.right'

  // Commands / menus
  | 'commandPalette'
  | 'contextMenu'

  // Settings
  | 'settings.page'

  // Plugin detail
  | 'plugin.detail'
  | 'plugin.detail.permissions'
  | 'plugin.detail.files'
  | 'plugin.detail.cache'

  // Notifications
  | 'notification.center'
  | 'notification.toast'

  // Dialogs
  | 'dialog'
  | 'dialog.approval'

  // Mobile
  | 'mobile.sheet'
  | 'mobile.fullscreen'
  | 'mobile.keyboard';

// ─── SurfaceRenderContext — injected into every surface component ──
export interface SurfaceRenderContext {
  /** Surface instance unique ID. */
  id: string;
  /** Surface type. */
  type: SurfaceType;
  /** Plugin that contributed this surface (if any). */
  pluginId?: string;
  /** Plugin-declared view ID. */
  viewId?: string;
  /** Panel ID (if this is a panel). */
  panelId?: string;
  /** UI tab ID (pure frontend, not persisted as truth). */
  tabId?: string;
  /** Core session ID, if this surface is bound to a session. */
  sessionId?: string;
  /** Core node ID, if this surface is bound to a node. */
  nodeId?: string;
  /** Workspace path. */
  workspaceId?: string;
  /** Plugin custom params. */
  params?: Record<string, unknown>;
}

// ─── SurfaceContribution — registered by plugins or system-ui ──
export type ContributionComponentType = 'builtin' | 'custom' | 'iframe';

export interface SurfaceContribution {
  id: string;
  pluginId: string;
  surfaceType: SurfaceType | SurfaceType[];
  componentType: ContributionComponentType;
  /** Built-in component (host-rendered). */
  component?: ComponentType<unknown>;
  /** Custom component entry path (for custom-react). */
  entry?: string;
  title: string;
  description?: string;
  icon?: string;
  preferredSlot?: SurfaceType;
  allowedSlots?: SurfaceType[];
  order?: number;
  when?: string;
  singleton?: boolean;
  keepMounted?: boolean;
}

// ─── TabProjection — UI tab → Core session mapping ─────────────
export interface TabProjection {
  /** UI-side tab ID (generated on creation, not persisted as truth). */
  tabId: string;
  /** View type to render. */
  viewType: string;
  /** Display title. */
  title: string;
  /** Core session ID (null if not backed by a session). */
  sessionId?: string;
  /** Core node ID (null if not bound to a node). */
  nodeId?: string;
  /** Plugin ID that owns this view. */
  pluginId?: string;
  /** Surface type this tab belongs to. */
  surfaceType: SurfaceType;
  /** Whether the session is still active. */
  isAlive: boolean;
}

// ─── Session-to-View mapping ───────────────────────────────────
export interface SessionViewMapping {
  kind: string;
  viewType: string;
  defaultTitle: string;
}
