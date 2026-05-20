'use client';

import type { CoreConnectionStatus } from '../core/core-types';

// ─── StatusBar Props ───────────────────────────────────────────
interface StatusBarProps {
  connectionStatus: CoreConnectionStatus;
  leftItems?: string[];
  rightItems?: string[];
}

/**
 * StatusBar — bottom status bar.
 * Shows connection status, node counts, time, and plugin status items.
 * Height is fixed at 24px.
 * Plugin status items added via manifest `contributes.status`.
 */
export function StatusBar({ connectionStatus, leftItems, rightItems }: StatusBarProps) {
  const statusLabel = {
    connected: 'Core Connected',
    connecting: 'Connecting...',
    disconnected: 'Disconnected',
    error: 'Connection Error',
  }[connectionStatus];

  const statusColor = {
    connected: 'text-green-400',
    connecting: 'text-yellow-400',
    disconnected: 'text-gray-500',
    error: 'text-red-400',
  }[connectionStatus];

  return (
    <footer className="h-6 flex items-center justify-between px-3 border-t border-gray-800 bg-gray-900 text-xs text-gray-500 flex-shrink-0">
      {/* Left items */}
      <div className="flex items-center gap-3">
        <span className={statusColor}>
          ● {statusLabel}
        </span>
        {leftItems?.map((item, i) => (
          <span key={i} className="text-gray-500">{item}</span>
        ))}
      </div>

      {/* Right items */}
      <div className="flex items-center gap-3">
        {rightItems?.map((item, i) => (
          <span key={i} className="text-gray-500">{item}</span>
        ))}
        <span className="text-gray-600">{new Date().toLocaleTimeString()}</span>
      </div>
    </footer>
  );
}
