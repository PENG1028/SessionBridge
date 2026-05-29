'use client';

import { useState, useEffect } from 'react';
import { Plus, Cpu, Server, X } from 'lucide-react';
import { useCore } from '../core/core-client-provider';

interface NodeBarPeer {
  id: string;
  name: string;
  ip?: string;
  type: 'agent';
  role?: 'relay' | 'leaf';
  networkType?: 'loopback' | 'lan' | 'wan' | 'unknown';
  hasPublicAccess?: boolean;
  connectedAt?: number;
}

interface NodeBarProps {
  activeNodeId: string | null;
  onEnterNode: (nodeId: string) => void;
  onOpenConnection: () => void;
}

function nodeIcon(peer: NodeBarPeer) {
  if (peer.role === 'relay' || peer.hasPublicAccess) return Server;
  return Cpu;
}

function statusColor(peer: NodeBarPeer): string {
  if (peer.connectedAt) return 'bg-emerald-500';
  return 'bg-gray-600';
}

export function NodeBar({ activeNodeId, onEnterNode, onOpenConnection }: NodeBarProps) {
  const core = useCore();
  const [remotePeers, setRemotePeers] = useState<NodeBarPeer[]>([]);
  const [localNodeId, setLocalNodeId] = useState<string | null>(null);
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

  // Fetch mesh peers from CoreClient
  useEffect(() => {
    if (!core?.isConnected) { setRemotePeers([]); return; }
    let cancelled = false;

    const fetchPeers = async () => {
      try {
        const identity = await core.call<{ nodeId: string }>('node.identity.get').catch(() => null);
        if (cancelled) return;
        const lid = identity?.nodeId || '__local__';
        if (!cancelled) setLocalNodeId(lid);

        const nodeList = await core.call<{ nodes: any[] }>('node.list');
        if (cancelled || !nodeList?.nodes) return;

        setRemotePeers(
          nodeList.nodes
            .filter((n: any) => n.nodeId && n.nodeId !== lid)
            .map((n: any) => ({
              id: n.nodeId,
              name: n.name || n.displayName || n.hostname || n.nodeId.slice(0, 12),
              ip: n.addresses?.[0] || n.address,
              type: 'agent' as const,
              role: n.role || 'leaf',
              networkType: n.networkType || 'unknown',
              hasPublicAccess: n.hasPublicAccess,
              connectedAt: Date.now(),
            }))
        );
      } catch {
        // node.list unavailable — no remote peers to show
      }
    };

    fetchPeers();
    const interval = setInterval(fetchPeers, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [core?.isConnected]);

  const localPeerId = localNodeId || '__local__';
  const localPeer: NodeBarPeer = {
    id: localPeerId,
    name: core?.isConnected ? '本机' : '本机 (offline)',
    ip: '127.0.0.1',
    type: 'agent',
    role: 'leaf',
    networkType: 'loopback',
    connectedAt: core?.isConnected ? Date.now() : undefined,
  };

  const allEntries: NodeBarPeer[] = [localPeer, ...remotePeers];
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
