'use client';

import type { CoreConnectionStatus } from '../core/core-types';

// ─── OfflineBanner Props ───────────────────────────────────────
interface OfflineBannerProps {
  status: CoreConnectionStatus;
  wsUrl?: string;
  errorDetail?: string;
  onDismiss?: () => void;
}

/**
 * OfflineBanner — shown at the top of the screen when Core WebSocket
 * connection is lost. Displays [OFFLINE] with connection status and
 * actionable error info (wsUrl, error reason).
 * Auto-dismisses when connection is re-established (parent controls visibility).
 */
export function OfflineBanner({ status, wsUrl, errorDetail, onDismiss }: OfflineBannerProps) {
  const messages: Record<CoreConnectionStatus, string> = {
    disconnected: 'Connection to Core lost. Retrying...',
    error: 'Cannot connect to Core. Check if Go Core is running.',
    connecting: 'Reconnecting to Core...',
    connected: '',
  };

  const bgColors: Record<CoreConnectionStatus, string> = {
    disconnected: 'bg-yellow-600',
    error: 'bg-red-600',
    connecting: 'bg-yellow-600',
    connected: '',
  };

  return (
    <div className={`${bgColors[status]} text-white text-xs text-center py-1.5 flex flex-col items-center justify-center gap-0.5 flex-shrink-0`}>
      <div className="flex items-center gap-2">
        <span className="font-semibold">[OFFLINE]</span>
        <span>{messages[status]}</span>
        {onDismiss && (
          <button onClick={onDismiss} className="underline hover:text-gray-200">Dismiss</button>
        )}
      </div>
      {status === 'error' && wsUrl && (
        <div className="text-white/70 font-mono text-[11px]">Target: {wsUrl}</div>
      )}
      {status === 'error' && errorDetail && (
        <div className="text-white/60 max-w-lg text-[11px]">{errorDetail}</div>
      )}
    </div>
  );
}
