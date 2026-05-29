'use client';

// ─── Plugin Panel Component Registrations ──────────────────
// Registers known React components for panel IDs declared in
// plugin manifests (plugin.yaml contributes.panels).
//
// These are "host-provided fallback" components — the manifest
// declares the panel structure (id, title, side, when), and core
// provides the rendering implementation for known panel types.
// External plugins never import React components directly.
//
// This file runs at module init time via import from page.tsx.

import { registerPanelComponent } from './panel-registry';
import { LogsPanel, TerminalPanel, SystemPanel, ProcessesPanel } from './extension-panels';
import { TaskPanel } from './task-panel';
import { QuickActionsPanel } from './quick-actions-panel';
import { SessionActionsPanel } from './session-actions-panel';
import { SnapshotsPanel } from './snapshots-panel';
import { FilesContextPanel } from './files-context-panel';
import { TerminalLogPanel } from './terminal-log-panel';

import { FilesPanel } from './files-panel';
import { PathBookmarksPanel } from './path-bookmarks-panel';
import { SessionListPanel, SystemInfoPanel } from '../plugin-host/plugin-components';

// Plugin-manifest-declared sidebar panels (registered by manifest panel id)
registerPanelComponent('terminal.files', FilesPanel);
registerPanelComponent('terminal.raw', TerminalPanel);
registerPanelComponent('terminal.logs', LogsPanel);
registerPanelComponent('terminal.processes', ProcessesPanel);
registerPanelComponent('terminal.tasks', TaskPanel);
registerPanelComponent('terminal.system', SystemPanel);

// Host-rendered plugin panels (registered by componentId via hostComponentRegistry,
// also as panel component overrides here as belt-and-suspenders)
registerPanelComponent('system-info.panel', SystemInfoPanel);
registerPanelComponent('terminal.sessions', SessionListPanel);

// Core panels — components provided by the platform, registration via plugin manifests
registerPanelComponent('quick-actions', QuickActionsPanel);
registerPanelComponent('session-actions', SessionActionsPanel);
registerPanelComponent('snapshots', SnapshotsPanel);
registerPanelComponent('files-context', FilesContextPanel);
registerPanelComponent('terminal-log', TerminalLogPanel);
registerPanelComponent('files', FilesPanel);
registerPanelComponent('path-bookmarks', PathBookmarksPanel);

/** Prevent tree-shaking — ensures module-level side effects fire. */
export const __extensionPanelComponentsRegistered = true;
