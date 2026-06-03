'use client';

/**
 * Terminal panel component registrations.
 * Registers React components for panel IDs declared in
 * plugins/terminal/plugin.yaml → adapters.system-ui.panels.
 *
 * This file is imported by plugins/terminal/index.tsx so the
 * registrations fire when the plugin module is loaded.
 */

import { registerPanelComponent } from '../../../sdk';
import { LogsPanel, TerminalPanel, ProcessesPanel } from './extension-panels';
import { FilesPanel } from './files-panel';
import { SessionListPanel } from './sessions-panel';

registerPanelComponent('terminal.files', FilesPanel);
registerPanelComponent('terminal.raw', TerminalPanel);
registerPanelComponent('terminal.logs', LogsPanel);
registerPanelComponent('terminal.processes', ProcessesPanel);
registerPanelComponent('terminal.sessions', SessionListPanel);

export const __terminalPanelComponentsRegistered = true;
