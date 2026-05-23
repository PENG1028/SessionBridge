'use client';

import React from 'react';
import { useCore } from '../core/core-client-provider';
import { MainSlot } from '../workbench/slots/main-slot';
import { Dashboard } from '../system-pages/dashboard';
import { NodeManager } from '../system-pages/node-manager';
import { SessionManager } from '../system-pages/session-manager';
import { PluginManager } from '../system-pages/plugin-manager';
import { Settings } from '../system-pages/settings';
import { LogsViewer } from '../system-pages/logs-viewer';
import { Approvals } from '../system-pages/approvals';
import { AccessControl } from '../system-pages/access-control';

// ─── System view mapping ────────────────────────────────────────
const SYSTEM_VIEW_MAP: Record<string, React.ComponentType<{ core: ReturnType<typeof useCore> }>> = {
  'system.dashboard': Dashboard,
  'system.nodes': NodeManager,
  'system.sessions': SessionManager,
  'system.plugins': PluginManager,
  'system.settings': Settings,
  'system.logs': LogsViewer,
  'system.approvals': Approvals,
  'system.accessControl': AccessControl,
};

interface SystemViewWrapperProps {
  viewId: string;
  instanceId?: string;
  _surfaceId?: string;
}

/**
 * Bridges MainSlot props to system view props.
 * Gets CoreClient from context via useCore().
 * For system-* viewIds, renders the appropriate system view.
 * For all other viewIds, delegates to the original MainSlot.
 */
export function SystemViewWrapper({ viewId, instanceId, _surfaceId }: SystemViewWrapperProps) {
  const core = useCore();

  const SystemView = SYSTEM_VIEW_MAP[viewId];
  if (SystemView) {
    return (
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-y-auto bg-[#0a0a0a]">
        <SystemView core={core} />
      </div>
    );
  }

  // Fall through to original MainSlot for non-system views
  return <MainSlot viewId={viewId} instanceId={instanceId} _surfaceId={_surfaceId} />;
}
