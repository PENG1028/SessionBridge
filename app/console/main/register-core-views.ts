'use client';

import { List } from 'lucide-react';
import { registerView } from './view-registry';
import { LogsView } from './logs-view';

/** Prevent tree-shaking of module-level side effects. */
export const __coreViewsRegistered = true;

// ── Workspace (non-adapter) views ─────────────────────────
// Dashboard is now a plugin — registered via plugins/dashboard/plugin.yaml
// Terminal is now a plugin — registered via plugins/terminal/plugin.yaml

// TODO: migrate to plugin — remains registered as core view until plugins/logs/ is created
registerView('logs', {
  component: LogsView,
  meta: { title: 'Logs', icon: List, showInSelector: true, launchable: true, launchMode: 'direct', category: 'workspace', viewType: 'main.editor', sidebarRequirements: { left: 'auto', right: 'auto' } },
});

