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
import { SystemInfoPanel } from './system-info-panel';

// Non-terminal plugin panels — registered here until those plugins
// are fully self-contained (see plugins/terminal/panels/ for terminal pattern)
registerPanelComponent('system-info.panel', SystemInfoPanel);

/** Prevent tree-shaking — ensures module-level side effects fire. */
export const __extensionPanelComponentsRegistered = true;
