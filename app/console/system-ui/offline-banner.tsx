'use client';

import type { CoreConnectionStatus } from '../core/core-types';

// ─── OfflineBanner Props ───────────────────────────────────────
interface OfflineBannerProps {
  status: CoreConnectionStatus;
  onDismiss?: () => void;
}

/**
 * OfflineBanner — shown at the top of the screen when Core WebSocket
 * connection is lost. Displays [OFFLINE] with connection status.
 * Auto-dismisses when connection is re-established (parent controls visibility).
 * Connection state is React state — no localStorage for offline truth.
 */
export function OfflineBanner({ status, onDismiss }: OfflineBannerProps) {
  const messages = {
    disconnected: 'Connection to Core lost. Retrying...',
    error: 'Cannot connect to Core. Check if Go Core is running.',
    connecting: 'Reconnecting to Core...',
    connected: '', // Not shown when connected
  };

  const bgColors = {
    disconnected: 'bg-yellow-600',
    error: 'bg-red-600',
    connecting: 'bg-yellow-600',
    connected: '',
  };

  return (
    <div className={`${bgColors[status]} text-white text-xs text-center py-1 flex items-center justify-center gap-2 flex-shrink-0`}>
      <span>[OFFLINE]</span>
      <span>{messages[status]}</span>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="underline hover:text-gray-200"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
