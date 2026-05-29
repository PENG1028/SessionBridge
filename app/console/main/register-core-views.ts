'use client';

import { Activity, List, Orbit, LayoutDashboard, Server, Monitor, Puzzle, Wrench, ScrollText, CheckCircle, Shield, Terminal } from 'lucide-react';
import { registerView } from './view-registry';
import { DashboardView } from './dashboard-view';
import { LogsView } from './logs-view';
import { AgentMonitorView } from './agent-monitor-view';
import { SystemViewWrapper } from './system-view-wrapper';
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

// ── System management views ─────────────────────────────

// Primary dotted-format view IDs (Go Core convention)
registerView('system.dashboard', {
  component: SystemViewWrapper,
  meta: { title: 'Dashboard', icon: LayoutDashboard, showInSelector: true, launchable: true, launchMode: 'direct', category: 'system', viewType: 'main.editor' },
});

registerView('system.nodes', {
  component: SystemViewWrapper,
  meta: { title: 'Nodes', icon: Server, showInSelector: true, launchable: true, launchMode: 'direct', category: 'system', viewType: 'main.editor' },
});

registerView('system.sessions', {
  component: SystemViewWrapper,
  meta: { title: 'Sessions', icon: Monitor, showInSelector: true, launchable: true, launchMode: 'direct', category: 'system', viewType: 'main.editor' },
});

registerView('system.plugins', {
  component: SystemViewWrapper,
  meta: { title: 'Plugins', icon: Puzzle, showInSelector: true, launchable: true, launchMode: 'direct', category: 'system', viewType: 'main.editor' },
});

registerView('system.settings', {
  component: SystemViewWrapper,
  meta: { title: 'Settings', icon: Wrench, showInSelector: true, launchable: true, launchMode: 'direct', category: 'system', viewType: 'main.editor' },
});

registerView('system.logs', {
  component: SystemViewWrapper,
  meta: { title: 'Logs & Audit', icon: ScrollText, showInSelector: true, launchable: true, launchMode: 'direct', category: 'system', viewType: 'main.editor' },
});

registerView('system.approvals', {
  component: SystemViewWrapper,
  meta: { title: 'Approvals', icon: CheckCircle, showInSelector: true, launchable: true, launchMode: 'direct', category: 'system', viewType: 'main.editor' },
});

registerView('system.accessControl', {
  component: SystemViewWrapper,
  meta: { title: 'Access Control', icon: Shield, showInSelector: true, launchable: true, launchMode: 'direct', category: 'system', viewType: 'main.editor' },
});
