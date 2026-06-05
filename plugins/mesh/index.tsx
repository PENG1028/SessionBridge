'use client';

import { Plus, RefreshCw } from 'lucide-react';
import { useCore, useReachableNodeIds } from '../../sdk';
import { useState, useEffect, useCallback } from 'react';
import type { PeerEntry, NodeInvite, NodeInfo } from '../../sdk';
import { normalizeNodeInfo } from '../../sdk';
import { NodeCard } from './node-card';
import { AddPeerDialog } from './add-peer-dialog';
import { LinkLine, extractHost, categorizeNetwork, type NodeKind } from './theme';

// ─── Types ───
interface NodeNetworkViewProps {
  onEnterNode?: (nodeId: string) => void;
  isLocalPage?: boolean;
}

// ─── Main Export ───
export function NodeNetworkView({
  onEnterNode, isLocalPage,
}: NodeNetworkViewProps) {
  const core = useCore();

  const [localNodeId, setLocalNodeId] = useState<string | null>(null);
  const [topoNodes, setTopoNodes] = useState<NodeInfo[]>([]);
  const [topoLoading, setTopoLoading] = useState(true);
  const [topoError, setTopoError] = useState<string | null>(null);

  const [meshPeers, setMeshPeers] = useState<PeerEntry[]>([]);
  const [meshPeersLoading, setMeshPeersLoading] = useState(false);
  const [meshInvites, setMeshInvites] = useState<NodeInvite[]>([]);
  const [showAddPeer, setShowAddPeer] = useState(false);

  const reachableNodeIds = useReachableNodeIds();

  const fetchTopology = useCallback(async () => {
    if (!core.isConnected) { setTopoLoading(false); return; }
    setTopoLoading(true);
    setTopoError(null);
    try {
      const [identityResult, nodeListResult] = await Promise.all([
        core.call<{ nodeId: string }>('node.identity.get'),
        core.call<{ nodes: unknown[] }>('node.list'),
      ]);
      setLocalNodeId(identityResult.nodeId);
      const nodes = (nodeListResult.nodes || []).map(n => normalizeNodeInfo(n as Record<string, unknown>));
      setTopoNodes(nodes);
    } catch (err) {
      setTopoError(err instanceof Error ? err.message : 'Failed to load topology');
    } finally {
      setTopoLoading(false);
    }
  }, [core]);

  const fetchMeshPeers = useCallback(async () => {
    if (!core.isConnected) { setMeshPeers([]); return; }
    setMeshPeersLoading(true);
    try {
      const result = await core.call<{ peers: PeerEntry[] }>('node.peer.list');
      setMeshPeers(result.peers || []);
    } catch (_e) {
      setMeshPeers([]);
    } finally {
      setMeshPeersLoading(false);
    }
  }, [core]);

  const fetchInvites = useCallback(async () => {
    if (!core.isConnected) { setMeshInvites([]); return; }
    try {
      const result = await core.call<{ invites: NodeInvite[]; total: number }>('node.invite.list');
      setMeshInvites(result.invites || []);
    } catch (_e) {
      setMeshInvites([]);
    }
  }, [core]);

  useEffect(() => {
    fetchTopology();
    fetchMeshPeers();
    fetchInvites();
  }, [core.isConnected, fetchTopology, fetchMeshPeers, fetchInvites]);

  // ── Build unified node list (topology + trust store merged by nodeId) ──
  const localNode = topoNodes.find(n => n.nodeId === localNodeId);
  const localName = localNode?.name || (isLocalPage ? '本机' : 'Local Core');
  const localAddress = localNode?.address;
  const localHost = extractHost(localAddress);
  const localNetworkType = localAddress ? categorizeNetwork(localHost) : 'loopback';

  // Build peer map for fast lookup
  const peerMap = new Map(meshPeers.map(p => [p.nodeId, p]));

  // Unified node type: merge topology runtime data with trust store persistence
  type UnifiedNode = {
    nodeId: string;
    name: string;
    kind: 'LOCAL' | 'RELAY' | 'LEAF' | 'VIEW';
    address?: string;
    networkType: ReturnType<typeof categorizeNetwork>;
    status: string;
    fromTopology: boolean;
    fromTrust: boolean;
    topo?: typeof topoNodes[number];
    peer?: typeof meshPeers[number];
    onEnter?: () => void;
  };

  const unifiedNodes: UnifiedNode[] = [];

  // Phase 1: local node
  if (core.isConnected) {
    unifiedNodes.push({
      nodeId: localNodeId || '__local__',
      name: localName,
      kind: 'LOCAL',
      address: localAddress,
      networkType: localNetworkType,
      status: 'connected',
      fromTopology: true,
      fromTrust: false,
      topo: localNode,
      onEnter: () => onEnterNode?.(localNodeId || '__local__'),
    });
  }

  // Phase 2: topology nodes (runtime connections)
  const seenIds = new Set([localNodeId, '__local__']);
  for (const n of topoNodes) {
    if (seenIds.has(n.nodeId)) continue;
    seenIds.add(n.nodeId);
    const netType = n.address ? categorizeNetwork(extractHost(n.address)) : 'wan';
    unifiedNodes.push({
      nodeId: n.nodeId,
      name: peerMap.get(n.nodeId)?.name || n.displayName || n.name,
      kind: n.role === 'relay' ? 'RELAY' : 'LEAF',
      address: n.address,
      networkType: netType,
      status: n.status,
      fromTopology: true,
      fromTrust: peerMap.has(n.nodeId),
      topo: n,
      peer: peerMap.get(n.nodeId),
      onEnter: () => onEnterNode?.(n.nodeId),
    });
  }

  // Phase 3: trust-only nodes (paired but not in topology)
  for (const mp of meshPeers) {
    if (seenIds.has(mp.nodeId)) continue;
    seenIds.add(mp.nodeId);
    const addr = mp.addresses?.[0];
    const netType = addr ? categorizeNetwork(extractHost(addr)) : 'wan';
    unifiedNodes.push({
      nodeId: mp.nodeId,
      name: mp.name || mp.nodeId,
      kind: 'LEAF',
      address: addr,
      networkType: netType,
      status: mp.status === 'revoked' ? 'revoked' : mp.status === 'expired' ? 'expired' : 'offline',
      fromTopology: false,
      fromTrust: true,
      peer: mp,
      onEnter: () => onEnterNode?.(mp.nodeId),
    });
  }

  // Phase 4: View — the browser session (not a Core node)
  unifiedNodes.push({
    nodeId: '__view__',
    name: `View on ${localName}`,
    kind: 'VIEW' as const,
    status: 'connected',
    networkType: localNetworkType,
    fromTopology: false,
    fromTrust: false,
  });

  // Sort: LOCAL first, then RELAY, then LEAF, then VIEW last
  const kindOrder: Record<string, number> = { LOCAL: 0, RELAY: 1, LEAF: 2, VIEW: 3 };
  unifiedNodes.sort((a, b) => {
    if (a.kind !== b.kind) return (kindOrder[a.kind] || 99) - (kindOrder[b.kind] || 99);
    return a.nodeId.localeCompare(b.nodeId);
  });

  const relayNodes = unifiedNodes.filter(n => n.kind === 'RELAY');
  const leafNodes = unifiedNodes.filter(n => n.kind === 'LEAF');
  const connectedCount = unifiedNodes.filter(n => n.fromTopology && n.status === 'connected').length;



  // ── Build topology tree from unified list ──
  type TopoEntry = {
    kind: 'node';
    data: { peer: { name: string; address?: string; networkType?: string }; kind: NodeKind; nodeId?: string; onEnter?: () => void; reachable?: boolean };
  } | {
    kind: 'link';
    label: string;
    muted?: boolean;
  };

  const topo: TopoEntry[] = [];
  const addedIds = new Set<string>();

  function addNode(
    id: string,
    info: { name: string; address?: string; networkType?: string; nodeId?: string },
    kind: NodeKind,
    linkLabel?: string, linkMuted?: boolean,
    onEnter?: () => void,
    reachable?: boolean,
  ) {
    if (addedIds.has(id)) return;
    if (linkLabel && topo.length > 0) {
      topo.push({ kind: 'link', label: linkLabel, muted: linkMuted });
    }
    topo.push({ kind: 'node', data: { peer: { name: info.name, address: info.address, networkType: info.networkType }, kind, nodeId: info.nodeId, onEnter, reachable } });
    addedIds.add(id);
  }

  // Build tree from unified list, with appropriate link labels
  for (const n of unifiedNodes) {
    if (n.kind === 'LOCAL') {
      addNode('__local__', { name: n.name, address: n.address, networkType: n.networkType, nodeId: n.nodeId }, 'LOCAL');
    } else if (n.kind === 'RELAY') {
      addNode(n.nodeId, { name: n.name, address: n.address, networkType: n.networkType, nodeId: n.nodeId }, 'RELAY',
        'relay / upstream', false,
        n.onEnter, reachableNodeIds.has(n.nodeId));
    } else if (n.kind === 'LEAF') {
      addNode(n.nodeId, { name: n.name, address: n.address, networkType: n.networkType, nodeId: n.nodeId }, 'LEAF',
        n.fromTrust ? 'leaf (paired)' : undefined, false,
        n.onEnter, reachableNodeIds.has(n.nodeId));
    } else if (n.kind === 'VIEW') {
      addNode('__view__', { name: n.name, address: undefined, networkType: n.networkType }, 'VIEW');
    }
  }
  // ── Render ──
  return (
    <div className="space-y-5 px-1 pb-4">
      {topoLoading ? (
        <div className="border rounded-lg border-gray-700/60 bg-gray-800/20 px-3.5 py-4 text-sm text-gray-500">
          loading topology...
        </div>
      ) : topoError ? (
        <div className="border rounded-lg border-red-800/40 bg-red-900/10 px-3.5 py-3 text-[10px] text-red-400">
          {topoError}
          <button onClick={fetchTopology} className="ml-2 text-purple-400 hover:text-purple-300">
            <RefreshCw size={10} className="inline" /> retry
          </button>
        </div>
      ) : topo.length > 0 ? (
        <div className="space-y-0">
          {topo.map((entry, i) =>
            entry.kind === 'node'
              ? <NodeCard key={`n-${i}`} {...entry.data} />
              : <LinkLine key={`l-${i}`} label={entry.label} muted={entry.muted} />
          )}
        </div>
      ) : (
        <div className="border rounded-lg border-gray-700/60 bg-gray-800/20 px-3.5 py-4 text-sm text-gray-500">
          disconnected / loading
        </div>
      )}

      {/* Peers section — just the action bar (nodes are in the unified tree above) */}
      <div className="border-t border-gray-800 pt-3">
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="text-[9px] font-bold text-gray-600 tracking-wider uppercase">
            Peers
            {meshPeers.length > 0 && (
              <span className="ml-2 text-emerald-500 font-normal text-[9px]">
                ● {connectedCount} connected
              </span>
            )}
          </h3>
          <button onClick={() => setShowAddPeer(true)}
            className="flex items-center gap-1 text-[9px] text-purple-400 hover:text-purple-300 transition-colors">
            <Plus size={10} /> Add Peer
          </button>
        </div>

        {!core.isConnected ? (
          <div className="px-2.5 py-2 text-[10px] text-gray-600">Core offline — peer list unavailable.</div>
        ) : meshPeers.length === 0 && meshInvites.length === 0 ? (
          <div className="px-2.5 py-2 text-[10px] text-gray-600">
            No peers connected. Use <span className="text-purple-400">+ Add Peer</span> to pair with another Core.
          </div>
        ) : null}

        {/* Active invites */}
        {meshInvites.filter(inv => inv.expiresAt > Date.now()).length > 0 && (
          <div className="space-y-1 mt-2">
            <div className="text-[8px] text-gray-600 font-bold tracking-wider uppercase pt-1 px-1">Active Invites</div>
            {meshInvites.filter(inv => inv.expiresAt > Date.now()).map(inv => (
              <div key={inv.inviteId} className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-yellow-800/30 bg-yellow-900/10">
                <span className="w-2 h-2 rounded-full bg-yellow-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[9px] text-gray-300 font-mono truncate">{inv.inviteId}</div>
                  <div className="text-[8px] text-gray-500">expires {new Date(inv.expiresAt).toLocaleTimeString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-2 px-1">
          <button onClick={() => onEnterNode?.('__mesh__')}
            className="text-[9px] text-gray-600 hover:text-gray-400 transition-colors">
            Manage Peers →
          </button>
        </div>
      </div>
      {showAddPeer && (
        <AddPeerDialog onClose={() => { setShowAddPeer(false); fetchMeshPeers(); fetchInvites(); }} core={core} />
      )}
    </div>
  );
}
