'use client';

import { Activity, List, Orbit } from 'lucide-react';
import { registerView } from './view-registry';
import { DashboardView } from './dashboard-view';
import { LogsView } from './logs-view';
import { AgentMonitorView } from './agent-monitor-view';

// ── Adapter view registrations ─────────────────────────────
// The adapters directory owns its registrations. Core imports a single
// aggregation point — not individual adapter modules.
import { ensureAdapterViewsLoaded } from '../../../extensions/client-index';
ensureAdapterViewsLoaded();

/** Prevent tree-shaking of module-level side effects. */
export const __coreViewsRegistered = true;

// ── Workspace (non-adapter) views ─────────────────────────

registerView('dashboard', {
  component: DashboardView,
  meta: { title: 'Dashboard', icon: Activity, showInSelector: true, category: 'workspace', sidebarRequirements: { left: 'auto', right: 'auto' } },
});

registerView('logs', {
  component: LogsView,
  meta: { title: 'Logs', icon: List, showInSelector: true, category: 'workspace', sidebarRequirements: { left: 'auto', right: 'auto' } },
});

registerView('agent-monitor', {
  component: AgentMonitorView,
  meta: { title: 'Agent Monitor', icon: Orbit, showInSelector: true, category: 'workspace', sidebarRequirements: { left: 'auto', right: 'shown' } },
});
