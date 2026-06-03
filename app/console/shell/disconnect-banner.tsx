'use client';

// ─── DisconnectBanner ──────────────────────────────────────────
// Shows a connection status banner at the top of the shell when
// the core WebSocket is connecting, disconnected, or in a retry loop.

export interface DisconnectBannerProps {
  showBanner: boolean;
  connStatus: { status: string; retryCount?: number };
  statusColor: string;
}

export function DisconnectBanner({ showBanner, connStatus, statusColor }: DisconnectBannerProps) {
  if (!showBanner) return null;

  const isConnecting = connStatus.status === 'connecting';
  const bgColor = isConnecting ? '#1a3a1a' : '#3a1a1a';
  const textColor = isConnecting ? '#4ade80' : '#f87171';
  const retryText = connStatus.retryCount ? ` (retry #${connStatus.retryCount})` : '';

  return (
    <div
      className="flex items-center justify-center gap-2 px-3 py-1.5 text-[11px] font-bold tracking-wider uppercase"
      style={{ backgroundColor: bgColor, color: textColor }}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
      {isConnecting ? 'Connecting to server...' : `Disconnected from server${retryText}`}
    </div>
  );
}
