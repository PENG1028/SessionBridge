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

  // ── Derive topology entries ──
  const localNode = topoNodes.find(n => n.nodeId === localNodeId);
  const localName = localNode?.name || (isLocalPage ? '本机' : 'Local Core');
  const localAddress = localNode?.address;
  const localHost = extractHost(localAddress);
  const localNetworkType = localAddress ? categorizeNetwork(localHost) : 'loopback';

  const relayNodes = topoNodes.filter(n => n.nodeId !== localNodeId && categorizeNetwork(extractHost(n.address)) === 'wan');
  const leafNodes = topoNodes.filter(n => n.nodeId !== localNodeId && categorizeNetwork(extractHost(n.address)) !== 'wan');

  // ── Build alias map from meshPeers ──
  const peerAliasMap = new Map<string, string>();
  for (const mp of meshPeers) {
    if (mp.name && mp.name !== mp.nodeId) {
      peerAliasMap.set(mp.nodeId, mp.name);
    }
  }

  // ── Build topology tree ──
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
    const alias = info.nodeId ? peerAliasMap.get(info.nodeId) : undefined;
    const displayName = alias || info.name;
    if (linkLabel && topo.length > 0) {
      topo.push({ kind: 'link', label: linkLabel, muted: linkMuted });
    }
    topo.push({ kind: 'node', data: { peer: { name: displayName, address: info.address, networkType: info.networkType }, kind, nodeId: info.nodeId, onEnter, reachable } });
    addedIds.add(id);
  }

  // 1. Local node
  if (core.isConnected) {
    addNode('__local__', { name: localName, address: localAddress, networkType: localNetworkType, nodeId: localNodeId || undefined }, 'LOCAL',
      undefined, false,
      () => onEnterNode?.(localNodeId || '__local__'));
  }

  // 2. Leaf nodes
  for (const leaf of leafNodes) {
    const leafNet = leaf.address ? categorizeNetwork(extractHost(leaf.address)) : 'wan';
    addNode(leaf.nodeId, { name: leaf.name, address: leaf.address, networkType: leafNet, nodeId: leaf.nodeId }, 'LEAF',
      'leaf connected', false,
      () => onEnterNode?.(leaf.nodeId),
      reachableNodeIds.has(leaf.nodeId));
  }

  // 3. Relay nodes
  for (const relay of relayNodes) {
    const relayNet = relay.address ? categorizeNetwork(extractHost(relay.address)) : 'wan';
    addNode(relay.nodeId, { name: relay.name, address: relay.address, networkType: relayNet, nodeId: relay.nodeId }, 'RELAY',
      'relay / upstream', false,
      () => onEnterNode?.(relay.nodeId),
      reachableNodeIds.has(relay.nodeId));
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

      {/* Peers section */}
      <div className="border-t border-gray-800 pt-3">
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="text-[9px] font-bold text-gray-600 tracking-wider uppercase">
            Peers
            {meshPeers.length > 0 && (
              <span className="ml-2 text-emerald-500 font-normal text-[9px]">
                ● {meshPeers.filter(p => reachableNodeIds.has(p.nodeId)).length} connected
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
        ) : meshPeersLoading ? (
          <div className="px-2.5 py-2 text-[10px] text-gray-600">Loading peers...</div>
        ) : meshPeers.length === 0 && meshInvites.length === 0 ? (
          <div className="px-2.5 py-2 text-[10px] text-gray-600">
            No peers connected. Use <span className="text-purple-400">+ Add Peer</span> to pair with another Core.
          </div>
        ) : (
          <div className="space-y-1">
            {meshPeers.map(peer => (
              <div key={peer.nodeId} className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-gray-800 bg-[#111]">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  reachableNodeIds.has(peer.nodeId) ? 'bg-emerald-500' : 'bg-gray-600'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-gray-200 font-mono truncate">{peer.name || peer.nodeId}</div>
                  <div className="text-[8px] text-gray-500 font-mono truncate">{peer.nodeId}</div>
                </div>
                <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono border shrink-0 ${
                  reachableNodeIds.has(peer.nodeId) ? 'text-emerald-400 border-emerald-700/30 bg-emerald-900/10' :
                  'text-gray-500 border-gray-700 bg-gray-800'
                }`}>
                  {reachableNodeIds.has(peer.nodeId) ? 'connected' : (peer.status === 'connecting' ? 'connecting' : 'offline')}
                </span>
              </div>
            ))}

            {meshInvites.filter(inv => inv.expiresAt > Date.now()).length > 0 && (
              <>
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
              </>
            )}
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
