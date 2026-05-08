'use client';

import { Sparkles, Terminal as TerminalIcon, Activity, List, Orbit, Globe } from 'lucide-react';
import { registerView } from './view-registry';
import { ClaudeChatView } from './claude-chat-view';
import { TerminalView } from './terminal-view';
import { DashboardView } from './dashboard-view';
import { LogsView } from './logs-view';
import { AgentMonitorView } from './agent-monitor-view';

/** Prevent tree-shaking of module-level side effects. */
export const __coreViewsRegistered = true;

registerView('claude-chat', {
  component: ClaudeChatView,
  meta: { title: 'Claude Chat', icon: Sparkles, sidebarRequirements: { left: 'auto', right: 'shown' } },
});

registerView('terminal', {
  component: TerminalView,
  meta: { title: 'Terminal', icon: TerminalIcon, sidebarRequirements: { left: 'auto', right: 'auto' } },
});

registerView('dashboard', {
  component: DashboardView,
  meta: { title: 'Dashboard', icon: Activity, sidebarRequirements: { left: 'hidden', right: 'hidden' } },
});

registerView('logs', {
  component: LogsView,
  meta: { title: 'Logs', icon: List, sidebarRequirements: { left: 'auto', right: 'auto' } },
});

registerView('agent-monitor', {
  component: AgentMonitorView,
  meta: { title: 'Agent Monitor', icon: Orbit, sidebarRequirements: { left: 'auto', right: 'shown' } },
});
