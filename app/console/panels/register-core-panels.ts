'use client';

import { registerPanel } from './panel-registry';
import { FilesPanel } from './files-panel';
import { InstancesPanel } from './instances-panel';
import { QuickActionsPanel } from './quick-actions-panel';
import { SessionActionsPanel } from './session-actions-panel';
import { SnapshotsPanel } from './snapshots-panel';
import { FilesContextPanel } from './files-context-panel';
import { TerminalLogPanel } from './terminal-log-panel';
import { TaskPanel } from './task-panel';
import { LogsPanel, TerminalPanel, SystemPanel, ProcessesPanel } from './extension-panels';

/** Dummy symbol to prevent tree-shaking of module-level side effects. */
export const __corePanelsRegistered = true;

/** Register all core sidebar panels at module init time. */
registerPanel({ id: 'files', side: 'left', title: 'Files', order: 10, component: FilesPanel });
registerPanel({ id: 'instances', side: 'left', title: 'Instances', order: 20, component: InstancesPanel });
registerPanel({ id: 'quick-actions', side: 'left', title: 'Quick Actions', order: 30, component: QuickActionsPanel });

registerPanel({ id: 'tasks', side: 'right', title: 'Tasks', order: 10, when: 'activeAdapterId == claude-code', component: TaskPanel });
registerPanel({ id: 'session-actions', side: 'right', title: 'Actions', order: 20, component: SessionActionsPanel });
registerPanel({ id: 'snapshots', side: 'right', title: 'Snapshots', order: 30, component: SnapshotsPanel });
registerPanel({ id: 'files-context', side: 'right', title: 'Files in Context', order: 40, component: FilesContextPanel });
registerPanel({ id: 'terminal-log', side: 'right', title: 'Terminal Log', order: 50, component: TerminalLogPanel });

// Extension panels (from adapter manifests)
registerPanel({ id: 'logs', side: 'right', title: 'Logs', order: 61, component: LogsPanel });
registerPanel({ id: 'terminal', side: 'right', title: 'Terminal', order: 62, component: TerminalPanel });
registerPanel({ id: 'system', side: 'right', title: 'System', order: 63, component: SystemPanel });
registerPanel({ id: 'processes', side: 'right', title: 'Processes', order: 64, component: ProcessesPanel });
