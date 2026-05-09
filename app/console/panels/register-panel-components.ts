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

// Panels matching manifest contributes.views for claude-code, shell, system-info
registerPanelComponent('logs', LogsPanel);
registerPanelComponent('terminal', TerminalPanel);
registerPanelComponent('system', SystemPanel);
registerPanelComponent('processes', ProcessesPanel);

/** Prevent tree-shaking — ensures module-level side effects fire. */
export const __extensionPanelComponentsRegistered = true;
