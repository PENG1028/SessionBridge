'use client';

import { Activity, List, Orbit, Terminal } from 'lucide-react';
import { registerView } from './view-registry';
import { DashboardView } from './dashboard-view';
import { LogsView } from './logs-view';
import { AgentMonitorView } from './agent-monitor-view';
import { TerminalView } from './terminal-view';

/** Prevent tree-shaking of module-level side effects. */
export const __coreViewsRegistered = true;

// ── Workspace (non-adapter) views ─────────────────────────

registerView('dashboard', {
  component: DashboardView,
  meta: { title: 'Dashboard', icon: Activity, showInSelector: true, launchable: true, launchMode: 'direct', category: 'workspace', viewType: 'main.editor', sidebarRequirements: { left: 'auto', right: 'auto' } },
});

registerView('logs', {
  component: LogsView,
  meta: { title: 'Logs', icon: List, showInSelector: true, launchable: true, launchMode: 'direct', category: 'workspace', viewType: 'main.editor', sidebarRequirements: { left: 'auto', right: 'auto' } },
});

registerView('agent-monitor', {
  component: AgentMonitorView,
  meta: { title: 'Agent Monitor', icon: Orbit, showInSelector: true, launchable: true, launchMode: 'direct', category: 'workspace', viewType: 'main.editor', sidebarRequirements: { left: 'auto', right: 'shown' } },
});

registerView('terminal', {
  component: TerminalView,
  meta: { title: 'Terminal', icon: Terminal, showInSelector: true, launchable: true, launchMode: 'direct', category: 'workspace', viewType: 'main.editor' },
});

