'use client';

import { useState, useEffect } from 'react';
import { Plus, Cpu, Server, X, RefreshCw } from 'lucide-react';

interface PeerInfo {
  id: string;
  name: string;
  ip?: string;
  type: 'agent';
  role?: 'relay' | 'leaf';
  networkType?: 'loopback' | 'lan' | 'wan' | 'unknown';
  hasPublicAccess?: boolean;
  connectedAt?: number;
  isLocal?: boolean;
}

interface NodeBarProps {
  peers: PeerInfo[];
  wsUrl: string;
  activeNodeId: string | null;
  onEnterNode: (nodeId: string) => void;
  onOpenConnection: () => void;
  onRefreshNode?: () => void;
}

function nodeIcon(peer: PeerInfo) {
  if (peer.role === 'relay' || peer.hasPublicAccess) return Server;
  return Cpu;
}

function statusColor(peer: PeerInfo): string {
  if (peer.networkType === 'loopback') return 'bg-emerald-500';
  if (peer.connectedAt) return 'bg-emerald-500';
  return 'bg-gray-600';
}

export function NodeBar({ peers, wsUrl, activeNodeId, onEnterNode, onOpenConnection, onRefreshNode }: NodeBarProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  // Auto-undismiss when a dismissed node becomes active (user entered via NodeNetworkView)
  useEffect(() => {
    if (activeNodeId) {
      setDismissed(prev => {
        if (!prev.has(activeNodeId)) return prev;
        const n = new Set(prev);
        n.delete(activeNodeId);
        return n;
      });
    }
  }, [activeNodeId]);

  let localIp = '127.0.0.1';
  try { localIp = new URL(wsUrl).hostname; } catch {}

  const localPeer: PeerInfo = {
    id: '__local__',
    name: '本机',
    ip: localIp,
    type: 'agent',
    role: 'leaf',
    networkType: 'loopback',
    connectedAt: Date.now(),
  };

  // Show only agent nodes (not browser connections — they appear in VIEW section).
  // Invariant: terminal/plugin runtime sub-instances are excluded by collectPeers()
  // via the instanceKind discriminator — they never reach this filter.
  const reportedLocalPeer = peers.find(p => p.id === '__local__' || p.isLocal);
  const remotePeers = peers.filter(p => p.id !== '__local__' && !p.isLocal && p.type === 'agent' && p.networkType !== 'loopback');
  const allEntries: PeerInfo[] = reportedLocalPeer ? [reportedLocalPeer, ...remotePeers] : remotePeers;

  // Filter dismissed + if active node was dismissed, auto exit
  const visible = allEntries.filter(p => !dismissed.has(p.id));

  return (
    <div className="flex items-center h-8 px-2 bg-[#0d0d0d] border-b border-gray-800 gap-1 shrink-0 overflow-x-auto">
      {visible.map(peer => {
        const isActive = peer.id === activeNodeId;
        const Icon = nodeIcon(peer);
        return (
          <div
            key={peer.id}
            className={`group flex items-center gap-1 px-2 py-0.5 rounded cursor-pointer transition-all shrink-0 text-[11px] ${
              isActive
                ? 'bg-purple-900/30 text-purple-100 ring-1 ring-purple-700/40'
                : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-300'
            }`}
          >
            <button onClick={() => onEnterNode(peer.id)} className="flex items-center gap-1.5 flex-1 min-w-0">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor(peer)} ${isActive ? 'ring-1 ring-purple-400/40' : ''}`} />
              <Icon className="w-3 h-3 shrink-0" />
              <span className="truncate max-w-[80px]">{peer.name || peer.id.slice(0, 12)}</span>
              {peer.networkType && peer.networkType !== 'loopback' && (
                <span className="text-[8px] text-gray-600 font-mono ml-0.5">{peer.networkType.toUpperCase()}</span>
              )}
              {peer.role && peer.role !== 'leaf' && (
                <span className="text-[8px] px-1 rounded font-mono text-amber-400 bg-amber-900/25 ml-0.5">{peer.role.toUpperCase()}</span>
              )}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (peer.id === activeNodeId) return; // don't dismiss active node
                setDismissed(prev => { const n = new Set(prev); n.add(peer.id); return n; });
              }}
              className={`shrink-0 ml-0.5 p-0.5 ${peer.id === activeNodeId ? 'invisible' : 'text-gray-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all'}`}
              title={peer.id === activeNodeId ? "Can't hide active node" : 'Hide this node'}
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        );
      })}

      {onRefreshNode && activeNodeId && (
        <button
          onClick={onRefreshNode}
          className="flex items-center gap-1 px-1.5 py-0.5 text-gray-500 hover:text-gray-200 hover:bg-gray-800/60 rounded transition-colors shrink-0"
          title="Refresh tabs"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      )}
      <button
        onClick={onOpenConnection}
        className="flex items-center gap-1 px-1.5 py-0.5 text-gray-500 hover:text-gray-200 hover:bg-gray-800/60 rounded transition-colors shrink-0"
        title="Connection manager"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
}
