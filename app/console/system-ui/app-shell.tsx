'use client';

import type { ReactNode } from 'react';
import { Sidebar } from './sidebar';
import { AppHeader } from './app-header';
import { StatusBar } from './status-bar';
import { OfflineBanner } from './offline-banner';
import { ApprovalCenter } from './approval-center';
import type { CoreConnectionStatus, CoreClient } from '../core/core-types';

// ─── AppShell Props ────────────────────────────────────────────
interface AppShellProps {
  children: ReactNode;
  connectionStatus: CoreConnectionStatus;
  activeRoute: string;
  onNavigate: (route: string) => void;
  /** Sidebar content (plugin panels, etc). */
  sidebarExtra?: ReactNode;
  /** Bottom panel content. */
  bottomPanel?: ReactNode;
  /** CoreClient for global features (approval center, etc). */
  core?: CoreClient;
}

/**
 * AppShell — main application layout container.
 * Arranges Sidebar + Header + Main Content + StatusBar.
 * UI layout preferences (sidebar width, panel states) may be saved
 * to localStorage, but NO session/plugin/node truth is stored there.
 */
export function AppShell({
  children,
  connectionStatus,
  activeRoute,
  onNavigate,
  sidebarExtra,
  bottomPanel,
  core,
}: AppShellProps) {
  return (
    <div className="h-screen w-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      {/* Offline banner — shown when WS disconnects */}
      {connectionStatus === 'disconnected' || connectionStatus === 'error' ? (
        <OfflineBanner
          status={connectionStatus}
          wsUrl={core?.wsUrl}
          errorDetail={core?.lastError ?? undefined}
        />
      ) : null}

      {/* Header */}
      <AppHeader connectionStatus={connectionStatus} />

      {/* Body: Sidebar + Main + Right */}
      <div className="flex-1 flex min-h-0">
        {/* Left sidebar */}
        <Sidebar activeRoute={activeRoute} onNavigate={onNavigate}>
          {sidebarExtra}
        </Sidebar>

        {/* Main content area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {children}
        </main>
      </div>

      {/* Bottom panel (if any) */}
      {bottomPanel ? (
        <div className="border-t border-gray-800 flex-shrink-0" style={{ height: '200px' }}>
          {bottomPanel}
        </div>
      ) : null}

      {/* Global approval overlay */}
      {core ? <ApprovalCenter core={core} /> : null}

      {/* Status bar */}
      <StatusBar connectionStatus={connectionStatus} />
    </div>
  );
}
