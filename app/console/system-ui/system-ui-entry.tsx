'use client';

import { useState, useCallback } from 'react';
import type { CoreClient, CoreConnectionStatus } from '../core/core-types';
import { AppShell } from './app-shell';
import { Dashboard } from './views/dashboard';
import { NodeManager } from './views/node-manager';
import { SessionManager } from './views/session-manager';
import { PluginManager } from './views/plugin-manager';
import { PluginDetail } from './views/plugin-detail';
import { Settings } from './views/settings';
import { LogsViewer } from './views/logs-viewer';
import { Approvals } from './views/approvals';
import { AccessControl } from './views/access-control';

// ─── System UI entry point ─────────────────────────────────────
// This is the main entry for the System UI plugin.
// It manages page routing and provides CoreClient to all views.
//
// Principles:
// 1. All data from Core, not from localStorage.
// 2. Only UI preferences (tab, layout) may be persisted.
// 3. sessionId is Core truth, tabId is UI projection.
// 4. pluginId is optional; system views don't need it.
// 5. stream.write is the ONLY stdin method.

export type SystemRoute =
  | '/dashboard'
  | '/nodes'
  | '/sessions'
  | '/plugins'
  | '/plugin-detail'
  | '/settings'
  | '/logs'
  | '/approvals'
  | '/access-control';

interface SystemUIEntryProps {
  core: CoreClient;
  connectionStatus: CoreConnectionStatus;
  defaultRoute?: SystemRoute;
}

export function SystemUIEntry({ core, connectionStatus, defaultRoute = '/dashboard' }: SystemUIEntryProps) {
  const [activeRoute, setActiveRoute] = useState<SystemRoute>(defaultRoute);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);

  const handleNavigate = useCallback((route: string) => {
    // Parse route and extract pluginId if needed
    if (route.startsWith('/plugin-detail/')) {
      const pluginId = route.replace('/plugin-detail/', '');
      setSelectedPluginId(pluginId);
      setActiveRoute('/plugin-detail');
    } else {
      setActiveRoute(route as SystemRoute);
    }
  }, []);

  const handlePluginSelect = useCallback((pluginId: string) => {
    setSelectedPluginId(pluginId);
    setActiveRoute('/plugin-detail');
  }, []);

  const handleBackToPlugins = useCallback(() => {
    setSelectedPluginId(null);
    setActiveRoute('/plugins');
  }, []);

  function renderPage() {
    switch (activeRoute) {
      case '/dashboard':
        return <Dashboard core={core} onNavigate={handleNavigate} />;
      case '/nodes':
        return <NodeManager core={core} />;
      case '/sessions':
        return <SessionManager core={core} />;
      case '/plugins':
        return (
          <PluginManager
            core={core}
            onPluginSelect={handlePluginSelect}
          />
        );
      case '/plugin-detail':
        return selectedPluginId ? (
          <PluginDetail
            core={core}
            pluginId={selectedPluginId}
            onBack={handleBackToPlugins}
          />
        ) : (
          <PluginManager core={core} onPluginSelect={handlePluginSelect} />
        );
      case '/settings':
        return <Settings core={core} />;
      case '/logs':
        return <LogsViewer core={core} />;
      case '/approvals':
        return <Approvals core={core} />;
      case '/access-control':
        return <AccessControl core={core} />;
      default:
        return <Dashboard core={core} />;
    }
  }

  return (
    <AppShell
      connectionStatus={connectionStatus}
      activeRoute={activeRoute}
      onNavigate={handleNavigate}
    >
      {renderPage()}
    </AppShell>
  );
}
