'use client';

import { Folder, Cpu, Zap, Play, Camera, FileText, Terminal, Upload, Plus } from 'lucide-react';
import { registerPanel } from './panel-registry';
import { emitPanelAction } from '../sidebar/panel-action-events';
import { FilesPanel } from './files-panel';
import { InstancesPanel } from './instances-panel';
import { QuickActionsPanel } from './quick-actions-panel';
import { SessionActionsPanel } from './session-actions-panel';
import { SnapshotsPanel } from './snapshots-panel';
import { FilesContextPanel } from './files-context-panel';
import { TerminalLogPanel } from './terminal-log-panel';

// Extension panels (logs, terminal, system, processes) are declared in
// adapter manifests (sb-extension.json contributes.views) and synced
// into the registry at runtime via syncExtensionPanels().  Core provides
// the React components via register-panel-components.ts.

/** Dummy symbol to prevent tree-shaking of module-level side effects. */
export const __corePanelsRegistered = true;

/** Register all core sidebar panels at module init time. */
registerPanel({
  id: 'files', side: 'left', title: 'Files', order: 10,
  icon: Folder,
  component: FilesPanel,
  getActions: () => (
    <button onClick={() => emitPanelAction('files-upload')} title="Upload file to workspace">
      <Upload className="w-3 h-3" />
    </button>
  ),
});

registerPanel({
  id: 'instances', side: 'left', title: 'Instances', order: 20,
  icon: Cpu,
  component: InstancesPanel,
  getActions: () => (
    <button onClick={() => emitPanelAction('instances-new')} title="New instance">
      <Plus className="w-3 h-3" />
    </button>
  ),
});

registerPanel({
  id: 'quick-actions', side: 'left', title: 'Quick Actions', order: 30,
  icon: Zap,
  component: QuickActionsPanel,
});

registerPanel({
  id: 'session-actions', side: 'right', title: 'Actions', order: 20,
  icon: Play,
  component: SessionActionsPanel,
});

registerPanel({
  id: 'snapshots', side: 'right', title: 'Snapshots', order: 30,
  icon: Camera,
  component: SnapshotsPanel,
});

registerPanel({
  id: 'files-context', side: 'right', title: 'Files in Context', order: 40,
  icon: FileText,
  component: FilesContextPanel,
});

registerPanel({
  id: 'terminal-log', side: 'right', title: 'Terminal Log', order: 50,
  icon: Terminal,
  component: TerminalLogPanel,
});
