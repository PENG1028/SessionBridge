'use client';

import { List, Orbit } from 'lucide-react';
import { registerView } from './view-registry';
import { LogsView } from './logs-view';
import { AgentMonitorView } from './agent-monitor-view';

/** Prevent tree-shaking of module-level side effects. */
export const __coreViewsRegistered = true;

// ── Workspace (non-adapter) views ─────────────────────────
// Dashboard is now a plugin — registered via plugins/dashboard/plugin.yaml

registerView('logs', {
  component: LogsView,
  meta: { title: 'Logs', icon: List, showInSelector: true, launchable: true, launchMode: 'direct', category: 'workspace', viewType: 'main.editor', sidebarRequirements: { left: 'auto', right: 'auto' } },
});

registerView('agent-monitor', {
  component: AgentMonitorView,
  meta: { title: 'Agent Monitor', icon: Orbit, showInSelector: true, launchable: true, launchMode: 'direct', category: 'workspace', viewType: 'main.editor', sidebarRequirements: { left: 'auto', right: 'shown' } },
});

// Terminal is now a plugin — registered via plugins/terminal/plugin.yaml

