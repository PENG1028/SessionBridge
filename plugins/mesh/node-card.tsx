'use client';

import { Cpu, Monitor, Server } from 'lucide-react';
import { useCore } from '../../sdk';
import { useState, useEffect, useCallback, useRef } from 'react';
import { nodeTheme, iconColor, networkClass, kindBadgeStyle, extractHost, extractPort, type NodeKind } from './theme';

export function NodeCard({ peer, kind, nodeId, onEnter, reachable }: {
  peer: { name: string; address?: string; networkType?: string };
  kind: NodeKind;
  nodeId?: string;
  onEnter?: () => void;
  reachable?: boolean;
}) {
  const Icon = kind === 'VIEW' ? Monitor : kind === 'RELAY' ? Server : Cpu;
  const core = useCore();
  const [reconnecting, setReconnecting] = useState(false);
  const [failed, setFailed] = useState(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isRemote = kind !== 'LOCAL';
  const isView = kind === 'VIEW';
  const isLocal = kind === 'LOCAL';
  const host = extractHost(peer.address);
  const port = extractPort(peer.address);
  const addressLine = peer.address || `${host}:${port}`;

  // Status dot — VIEW and LOCAL are always "connected"
  const showDot = true;
  const dotColor = isView || isLocal
    ? 'bg-emerald-500'
    : reachable
      ? 'bg-emerald-500 animate-pulse'
      : 'bg-gray-600';

  useEffect(() => {
    if (reachable && reconnecting) {
      setReconnecting(false);
      setFailed(false);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    }
  }, [reachable, reconnecting]);

  useEffect(() => () => { if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current); }, []);

  const handleReconnect = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!nodeId) return;
    setReconnecting(true);
    setFailed(false);
    try {
      await core.call('node.peer.reconnect', { nodeId });
    } catch (_e) { /* ignore — SSE event will confirm or timeout */ }
    reconnectTimerRef.current = setTimeout(() => {
      setReconnecting(false);
      setFailed(true);
    }, 10000);
  }, [core, nodeId]);

  const showEnter = isRemote && reachable && !isView;
  const showReconnect = isRemote && !reachable && onEnter && !reconnecting;
  const showReconnecting = isRemote && !reachable && reconnecting;
  const showRetry = isRemote && !reachable && failed;

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-colors ${isRemote && !isView ? 'cursor-pointer hover:border-purple-600/50' : 'cursor-default'} ${nodeTheme(kind)}`}
      onClick={showEnter ? onEnter : undefined}
    >
      <div className="px-3.5 py-2.5 flex items-start gap-2.5 bg-gray-800/30">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor(kind)}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-100 truncate">{peer.name}</div>
          {!isView && (
            <div className="text-[11px] text-gray-300 font-mono truncate">{addressLine}</div>
          )}
          {nodeId && (
            <div className="text-[9px] text-gray-600 font-mono truncate">{nodeId}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          {/* Status dot */}
          {showDot && (
            <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
          )}
          {/* Network badge — only for Core nodes with a real address */}
          {peer.networkType && !isView && (
            <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono border shrink-0 ${networkClass(peer.networkType)}`}>
              {peer.networkType.toUpperCase()}
            </span>
          )}
          {/* Kind badge — all except LOCAL */}
          {!isLocal && (
            <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono border shrink-0 ${kindBadgeStyle(kind)}`}>
              {kind}
            </span>
          )}
          {showEnter && (
            <span className="text-[9px] px-2 py-0.5 rounded bg-purple-700/30 text-purple-300 border border-purple-700/40 shrink-0">Enter</span>
          )}
          {showReconnecting && (
            <span className="text-[9px] px-2 py-0.5 rounded bg-yellow-900/20 text-yellow-500 border border-yellow-700/30 shrink-0 animate-pulse">
              Reconnecting...
            </span>
          )}
          {showReconnect && (
            <button onClick={handleReconnect}
              className="text-[9px] px-2 py-0.5 rounded bg-gray-700/30 text-gray-400 border border-gray-700 shrink-0 hover:bg-gray-700/50 hover:text-gray-300 transition-colors">
              Reconnect
            </button>
          )}
          {showRetry && (
            <button onClick={handleReconnect}
              className="text-[9px] px-2 py-0.5 rounded bg-red-900/20 text-red-400 border border-red-800/30 shrink-0 hover:bg-red-900/30 transition-colors">
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
