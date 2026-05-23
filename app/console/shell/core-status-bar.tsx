'use client';

import type { CoreConnectionStatus } from '../core/core-types';
import { getStatusBarChromeItems, getContextControls } from '../chrome/chrome-registry';

// ─── StatusBar Props ───────────────────────────────────────────
interface StatusBarProps {
  connectionStatus: CoreConnectionStatus;
  /** Legacy string items — rendered alongside chrome registry items. */
  leftItems?: string[];
  /** Legacy string items — rendered alongside chrome registry items. */
  rightItems?: string[];
}

/**
 * StatusBar — bottom status bar (height: 24px).
 * Renders connection status on the left and the current time on the right.
 * Plugin-contributed status items are rendered via the chrome registry
 * (getStatusBarChromeItems and contextControls with placement status-left/status-right)
 * injected between the host chrome and the fixed items.
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

  // Fetch plugin-contributed status items via chrome registry
  const chromeStatusItems = getStatusBarChromeItems();
  const ctxControlsLeft = getContextControls().filter(c => c.placement === 'status-left');
  const ctxControlsRight = getContextControls().filter(c => c.placement === 'status-right');

  return (
    <footer className="h-6 flex items-center justify-between px-3 border-t border-gray-800 bg-gray-900 text-xs text-gray-500 flex-shrink-0">
      {/* Left items */}
      <div className="flex items-center gap-3">
        <span className={statusColor}>
          ● {statusLabel}
        </span>
        {/* Chrome registry: legacy status bar items */}
        {chromeStatusItems.filter(i => (i.side || 'left') === 'left').map(item => (
          <span key={item.id} title={item.title} className="text-gray-500">
            {item.text}
          </span>
        ))}
        {/* Context controls: status-left */}
        {ctxControlsLeft.map(cc => (
          <span key={cc.id} className="text-gray-500">
            {cc.label}
          </span>
        ))}
        {/* Legacy string items */}
        {leftItems?.map((item, i) => (
          <span key={`left-${i}`} className="text-gray-500">{item}</span>
        ))}
      </div>

      {/* Right items */}
      <div className="flex items-center gap-3">
        {/* Legacy string items */}
        {rightItems?.map((item, i) => (
          <span key={`right-${i}`} className="text-gray-500">{item}</span>
        ))}
        {/* Context controls: status-right */}
        {ctxControlsRight.map(cc => (
          <span key={cc.id} className="text-gray-500">
            {cc.label}
          </span>
        ))}
        {/* Chrome registry: legacy status bar items */}
        {chromeStatusItems.filter(i => (i.side || 'left') === 'right').map(item => (
          <span key={item.id} title={item.title} className="text-gray-500">
            {item.text}
          </span>
        ))}
        <span className="text-gray-600">{new Date().toLocaleTimeString()}</span>
      </div>
    </footer>
  );
}
