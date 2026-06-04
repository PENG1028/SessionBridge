'use client';

import { useState, useEffect } from 'react';
import { Plus, Cpu, Server, X } from 'lucide-react';
import { useCore, useReachableNodeIds } from '../core/core-client-provider';

interface NodeBarPeer {
  id: string;
  name: string;
  ip?: string;
  type: 'agent';
  role?: 'relay' | 'leaf';
  networkType?: 'loopback' | 'lan' | 'wan' | 'unknown';
  hasPublicAccess?: boolean;
  status?: string;
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

function statusColor(isConnected: boolean, status?: string): string {
  if (status === 'rejected') return 'bg-red-500';
  return isConnected ? 'bg-emerald-500' : 'bg-gray-600';
}

export function NodeBar({ activeNodeId, onEnterNode, onOpenConnection }: NodeBarProps) {
  const core = useCore();
  const reachableNodeIds = useReachableNodeIds();
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

        const nodeList = await core.call<{ nodes: Array<{ nodeId: string; name?: string; displayName?: string; hostname?: string; addresses?: string[]; address?: string; role?: string; networkType?: string; hasPublicAccess?: boolean; status?: string }> }>('node.list');
        if (cancelled || !nodeList?.nodes) return;

        const peers = nodeList.nodes
          .filter(n => n.nodeId && n.nodeId !== lid)
          .map(n => ({
            id: n.nodeId,
            name: n.name || n.displayName || n.hostname || n.nodeId.slice(0, 12),
            ip: n.addresses?.[0] || n.address,
            type: 'agent' as const,
            role: (n.role || 'leaf') as 'relay' | 'leaf',
            networkType: (n.networkType || 'unknown') as 'loopback' | 'lan' | 'wan' | 'unknown',
            hasPublicAccess: n.hasPublicAccess,
            status: n.status,
          }));
        // Update status cache on ProxyCoreClient so the overlay can distinguish
        // "rejected" from "disconnected".
        if (peers.length > 0 && typeof (core as any).updateNodeStatus === 'function') {
          const pcc = core as any;
          for (const p of peers) {
            pcc.updateNodeStatus(p.id, p.status || 'disconnected');
          }
        }
        setRemotePeers(peers);
      } catch (_e) {
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
    name: '本机',
    ip: '127.0.0.1',
    type: 'agent',
    role: 'leaf',
    networkType: 'loopback',
  };

  // Only show local node when Core is actually connected.
  // Showing an offline entry lets users click into a broken session.
  const allEntries: NodeBarPeer[] = core?.isConnected
    ? [localPeer, ...remotePeers]
    : [...remotePeers];
  // Deduplicate by id — the local peer may briefly appear in remotePeers
  // if node.list returns before node.identity.get resolves.
  const seenIds = new Set<string>();
  const deduped = allEntries.filter(p => {
    if (seenIds.has(p.id)) return false;
    seenIds.add(p.id);
    return true;
  });
  const visible = deduped.filter(p => !dismissed.has(p.id));

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
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor(peer.id === localPeerId || reachableNodeIds.has(peer.id), peer.status)} ${isActive ? 'ring-1 ring-purple-400/40' : ''}`} />
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
              title={peer.id === activeNodeId ? "Can't hide active node" : peer.status === 'rejected' ? '配对已失效，需重新连接' : 'Hide this node'}
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
