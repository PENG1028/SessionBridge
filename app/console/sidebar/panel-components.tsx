// ─── Panel Component Mapping ─────────────────────────────────
// Maps extension-declared panel IDs to their React components.
// Sidebars use this to render panels dynamically from manifests.
//
// To add a new panel type, register its component here:
//   panelComponentMap['my-panel'] = MyPanelComponent;

'use client';

import type { ComponentType } from 'react';
import type { SidePanelProps } from '../../../adapters/types';

/** Placeholder for unregistered panel types. */
function PlaceholderPanel(_props: SidePanelProps) {
  return (
    <div className="p-3 text-[10px] text-gray-600 italic">
      Panel not yet implemented
    </div>
  );
}

/** Processes panel for shell adapter. */
function ProcessesPanel(_props: SidePanelProps) {
  return (
    <div className="p-3 space-y-2">
      <div className="text-[10px] font-bold text-gray-500 tracking-wider">PROCESSES</div>
      <div className="text-[10px] text-gray-600 italic">No running processes</div>
    </div>
  );
}

/** Files panel for claude-code. */
function FilesPanel(_props: SidePanelProps) {
  return (
    <div className="p-3 space-y-2">
      <div className="text-[10px] font-bold text-gray-500 tracking-wider">FILES</div>
      <div className="text-[10px] text-gray-600 italic">Files in context</div>
    </div>
  );
}

/** Logs panel for claude-code. */
function LogsPanel(_props: SidePanelProps) {
  return (
    <div className="p-3 space-y-2">
      <div className="text-[10px] font-bold text-gray-500 tracking-wider">LOGS</div>
      <div className="text-[10px] text-gray-600 italic">Session logs</div>
    </div>
  );
}

/** Terminal panel for claude-code. */
function TerminalPanel(_props: SidePanelProps) {
  return (
    <div className="p-3 space-y-2">
      <div className="text-[10px] font-bold text-gray-500 tracking-wider">TERMINAL</div>
      <div className="text-[10px] text-gray-600 italic">Quick terminal</div>
    </div>
  );
}

/**
 * Map of panel ID → React component.
 * Key matches the `id` field in sb-extension.json `contributes.views.*`.
 * Note: 'tasks' is rendered as a built-in section, not through this map.
 */
export const panelComponentMap: Record<string, ComponentType<SidePanelProps>> = {
  'processes': ProcessesPanel,
  'files': FilesPanel,
  'logs': LogsPanel,
  'terminal': TerminalPanel,
};

/**
 * Get the component for a panel ID, falling back to PlaceholderPanel.
 */
export function getPanelComponent(panelId: string): ComponentType<SidePanelProps> {
  return panelComponentMap[panelId] || PlaceholderPanel;
}
