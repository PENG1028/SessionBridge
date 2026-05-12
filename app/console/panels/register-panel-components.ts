'use client';

// ─── Extension Panel Component Registrations ──────────────────
// Registers known React components for panel IDs declared in
// adapter manifests (sb-extension.json contributes.views).
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

// Extension-manifest-declared panels (registered as component overrides)
registerPanelComponent('logs', LogsPanel);
registerPanelComponent('terminal', TerminalPanel);
registerPanelComponent('system', SystemPanel);
registerPanelComponent('processes', ProcessesPanel);
registerPanelComponent('tasks', TaskPanel);

// Core panels — components provided by the platform, registration via extension manifests
registerPanelComponent('quick-actions', QuickActionsPanel);
registerPanelComponent('session-actions', SessionActionsPanel);
registerPanelComponent('snapshots', SnapshotsPanel);
registerPanelComponent('files-context', FilesContextPanel);
registerPanelComponent('terminal-log', TerminalLogPanel);
registerPanelComponent('files', FilesPanel);

/** Prevent tree-shaking — ensures module-level side effects fire. */
export const __extensionPanelComponentsRegistered = true;
