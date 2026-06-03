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
import { LogsPanel, TerminalPanel, ProcessesPanel } from './extension-panels';
import { SessionListPanel } from './session-list-panel';
import { SystemInfoPanel } from './system-info-panel';
import { FilesPanel } from './files-panel';

// ── Panel component registrations ─────────────────────────────
// Maps plugin manifest panel IDs (declared in plugin.yaml panels: section)
// to React components. Panels without a matching plugin.yaml declaration
// are never created by syncPluginPanels() — remove them here.
//
// Resolution order: componentOverrides → hostComponentRegistry fallback.

registerPanelComponent('terminal.files', FilesPanel);
registerPanelComponent('terminal.raw', TerminalPanel);
registerPanelComponent('terminal.logs', LogsPanel);
registerPanelComponent('terminal.processes', ProcessesPanel);
registerPanelComponent('system-info.panel', SystemInfoPanel);
registerPanelComponent('terminal.sessions', SessionListPanel);

/** Prevent tree-shaking — ensures module-level side effects fire. */
export const __extensionPanelComponentsRegistered = true;
