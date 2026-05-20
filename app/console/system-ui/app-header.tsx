'use client';

import { Bell } from 'lucide-react';
import type { CoreConnectionStatus } from '../core/core-types';

// ─── AppHeader Props ───────────────────────────────────────────
interface AppHeaderProps {
  connectionStatus: CoreConnectionStatus;
  title?: string;
}

/**
 * AppHeader — top navigation bar.
 * Contains: Logo/Brand, page title, notification bell, connection indicator.
 * Height is fixed at 48px.
 */
export function AppHeader({ connectionStatus, title }: AppHeaderProps) {
  const statusColor = {
    connected: 'bg-green-500',
    connecting: 'bg-yellow-500 animate-pulse',
    disconnected: 'bg-gray-500',
    error: 'bg-red-500',
  }[connectionStatus];

  return (
    <header className="h-12 flex items-center justify-between px-4 border-b border-gray-800 bg-gray-900 flex-shrink-0">
      {/* Left: Brand + Title */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${statusColor}`} title={connectionStatus} />
          <span className="font-semibold text-sm text-gray-200">SessionNode</span>
        </div>
        {title ? (
          <>
            <span className="text-gray-600">/</span>
            <span className="text-sm text-gray-400">{title}</span>
          </>
        ) : null}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        <button
          className="p-2 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
          title="Notifications"
        >
          <Bell size={16} />
        </button>
      </div>
    </header>
  );
}
