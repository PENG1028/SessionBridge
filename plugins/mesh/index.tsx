'use client';

import { Plus, RefreshCw } from 'lucide-react';
import { useCore, useReachableNodeIds } from '../../sdk';
import { useState, useEffect, useCallback } from 'react';
import type { PeerEntry, NodeInvite, NodeInfo } from '../../sdk';
import { normalizeNodeInfo } from '../../sdk';
import { NodeCard } from './node-card';
import { AddPeerDialog } from './add-peer-dialog';
import { LinkLine, extractHost, categorizeNetwork, determineKind, type NodeKind } from './theme';

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
  const [topoLoading, setTopoLoading] = useState(() => core?.isConnected ?? false);
  const [topoError, setTopoError] = useState<string | null>(null);

  const [meshPeers, setMeshPeers] = useState<PeerEntry[]>([]);
  const [meshPeersLoading, setMeshPeersLoading] = useState(false);
  const [meshInvites, setMeshInvites] = useState<NodeInvite[]>([]);
  const [showAddPeer, setShowAddPeer] = useState(false);

  const reachableNodeIds = useReachableNodeIds();

  const fetchTopology = useCallback(async () => {
    if (!core.isConnected) { setTopoLoading(false); setTopoNodes([]); setLocalNodeId(null); setTopoError(null); return; }
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

  // ── Build topology tree ──
  const peerMap = new Map(meshPeers.map(p => [p.nodeId, p]));

  // Categorize remote topo nodes
  const remoteTopoNodes = topoNodes.filter(n => n.nodeId !== localNodeId);
  const relayNodes = remoteTopoNodes.filter(n => determineKind(n) === 'RELAY');
  const leafNodes = remoteTopoNodes.filter(n => determineKind(n) === 'LEAF');

  // Trust-only peers (paired but not in topology)
  const topoNodeIds = new Set(topoNodes.map(n => n.nodeId));
  const trustOnlyPeers = meshPeers.filter(mp => !topoNodeIds.has(mp.nodeId));

  // Connected count from SSE (reactive, not polling)
  const connectedCount = reachableNodeIds.size;

  // ── Local node info ──
  const localNode = topoNodes.find(n => n.nodeId === localNodeId);
  const localName = localNode?.name || (isLocalPage ? '本机' : 'Local Core');
  const localAddress = localNode?.address;
  const localHost = extractHost(localAddress);
  const localNetworkType = localAddress ? categorizeNetwork(localHost) : 'loopback';

  // ── Tree entries ──
  type TopoEntry = {
    kind: 'node';
    data: { peer: { name: string; address?: string; networkType?: string }; kind: NodeKind; nodeId?: string; onEnter?: () => void; reachable?: boolean };
  } | {
    kind: 'link';
    label: string;
    muted?: boolean;
    dashed?: boolean;
  };

  const topo: TopoEntry[] = [];

  function pushNode(
    name: string, address: string | undefined,
    networkType: string | undefined, kind: NodeKind,
    nodeId: string | undefined, onEnter?: () => void, reachable?: boolean,
  ) {
    topo.push({ kind: 'node', data: {
      peer: { name, address, networkType },
      kind, nodeId, onEnter, reachable,
    }});
  }

  function pushLink(label: string, muted?: boolean, dashed?: boolean) {
    if (topo.length === 0) return;
    topo.push({ kind: 'link', label, muted, dashed });
  }

  // Build tree — explicit order: VIEW → LOCAL → RELAY(s) → LEAF(s) → trust-only
  if (core.isConnected) {
    // 1. VIEW — browser session, dashed link to local
    pushNode(`View on ${localName}`, undefined, undefined, 'VIEW', undefined);
    pushLink(localAddress || '127.0.0.1:9090', true, true);

    // 2. LOCAL
    pushNode(localName, localAddress, localNetworkType, 'LOCAL',
      localNodeId || undefined, () => onEnterNode?.(localNodeId || '__local__'));

    // 3. RELAY nodes — link labeled "relay / upstream"
    for (const r of relayNodes) {
      const netType = r.address ? categorizeNetwork(extractHost(r.address)) : 'wan';
      const name = peerMap.get(r.nodeId)?.name || r.displayName || r.name;
      pushLink('relay / upstream', false);
      pushNode(name, r.address, netType, 'RELAY',
        r.nodeId, () => onEnterNode?.(r.nodeId), reachableNodeIds.has(r.nodeId));
    }

    // 4. LEAF nodes — link labeled "leaf / paired" or "leaf connected"
    for (const l of leafNodes) {
      const netType = l.address ? categorizeNetwork(extractHost(l.address)) : 'wan';
      const name = peerMap.get(l.nodeId)?.name || l.displayName || l.name;
      const fromTrust = peerMap.has(l.nodeId);
      pushLink(fromTrust ? 'leaf / paired' : 'leaf connected', false);
      pushNode(name, l.address, netType, 'LEAF',
        l.nodeId, () => onEnterNode?.(l.nodeId), reachableNodeIds.has(l.nodeId));
    }

    // 5. Trust-only peers (paired but not in topology)
    for (const mp of trustOnlyPeers) {
      const addr = mp.addresses?.[0];
      const netType = addr ? categorizeNetwork(extractHost(addr)) : 'wan';
      pushLink('leaf / paired', true);
      pushNode(mp.name || mp.nodeId, addr, netType, 'LEAF',
        mp.nodeId, () => onEnterNode?.(mp.nodeId), false);
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
              : <LinkLine key={`l-${i}`} label={entry.label} muted={entry.muted} dashed={entry.dashed} />
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

export default NodeNetworkView;
