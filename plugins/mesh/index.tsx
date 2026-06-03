'use client';

import { Cpu, Monitor, Server, X, Plus, Copy, Check, RefreshCw } from 'lucide-react';
import { useCore, useReachableNodeIds } from '../../app/console/core/core-client-provider';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { PeerEntry, NodeInvite, NodeInfo } from '../../app/console/core/core-types';
import { normalizeNodeInfo } from '../../app/console/core/core-response-utils';

// ─── Types ───

interface NodeNetworkViewProps {
  onEnterNode?: (nodeId: string) => void;
  isLocalPage?: boolean;
}

// ─── Theme helpers ───

type NodeKind = 'RELAY' | 'LEAF' | 'VIEW' | 'LOCAL';

function nodeTheme(kind: NodeKind) {
  switch (kind) {
    case 'RELAY': return 'border-amber-700/40 bg-amber-900/[0.06]';
    case 'LEAF': return 'border-blue-700/40 bg-blue-900/[0.05]';
    case 'VIEW': return 'border-gray-700/60 bg-gray-800/20';
    case 'LOCAL': return 'border-gray-700/60 bg-gray-800/30';
  }
}

function kindBadgeStyle(kind: NodeKind) {
  switch (kind) {
    case 'RELAY': return 'text-amber-400 border-amber-700/30 bg-amber-900/30';
    case 'LEAF': return 'text-blue-400 border-blue-700/30 bg-blue-900/20';
    case 'VIEW': return 'text-gray-500 border-gray-700 bg-gray-800';
    case 'LOCAL': return 'text-purple-400 border-purple-700/30 bg-purple-900/20';
  }
}

function iconColor(kind: NodeKind) {
  switch (kind) {
    case 'RELAY': return 'text-amber-400';
    case 'LEAF': return 'text-blue-400';
    case 'VIEW': return 'text-gray-500';
    case 'LOCAL': return 'text-purple-400';
  }
}

// ─── Little badges ───

function StatusBadge({ status }: { status: 'connected' | 'connecting' | 'failed' | 'saved' }) {
  const colors: Record<string, string> = {
    connected: 'text-emerald-400 border-emerald-700/30 bg-emerald-900/10',
    connecting: 'text-amber-400 border-amber-700/30 bg-amber-900/10',
    failed: 'text-red-400 border-red-700/30 bg-red-900/10',
    saved: 'text-gray-500 border-gray-700 bg-gray-800',
  };
  return <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono border ${colors[status] || colors.saved}`}>{status}</span>;
}

function TypeBadge({ connType }: { connType: string }) {
  const colors: Record<string, string> = {
    'view': 'text-gray-500 border-gray-700 bg-gray-800',
    'incoming leaf': 'text-blue-400 border-blue-700/30 bg-blue-900/20',
    'upstream': 'text-amber-400 border-amber-700/30 bg-amber-900/20',
    'lan leaf': 'text-green-400 border-green-700/30 bg-green-900/20',
  };
  return <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono border ${colors[connType] || 'text-gray-500 border-gray-700 bg-gray-800'}`}>{connType}</span>;
}

// ─── Helpers ───

function extractHost(address?: string): string {
  if (!address) return '127.0.0.1';
  try {
    // Handle "host:port" format
    const colonIdx = address.lastIndexOf(':');
    if (colonIdx > 0) return address.slice(0, colonIdx);
    return address;
  } catch (_e) { return '127.0.0.1'; }
}

function extractPort(address?: string, defaultPort = 9090): number {
  if (!address) return defaultPort;
  try {
    const colonIdx = address.lastIndexOf(':');
    if (colonIdx > 0) {
      const port = parseInt(address.slice(colonIdx + 1), 10);
      if (!isNaN(port) && port > 0 && port < 65536) return port;
    }
    return defaultPort;
  } catch (_e) { return defaultPort; }
}

function categorizeNetwork(ip: string): 'loopback' | 'lan' | 'wan' {
  if (ip === '127.0.0.1' || ip === 'localhost' || ip === '::1') return 'loopback';
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return 'lan';
  if (ip.startsWith('172.')) {
    const seg = parseInt(ip.split('.')[1] || '0', 10);
    if (seg >= 16 && seg <= 31) return 'lan';
  }
  return 'wan';
}

function networkClass(type?: string) {
  switch (type) {
    case 'wan': return 'border-yellow-700/30 bg-yellow-900/10 text-yellow-400';
    case 'lan': return 'border-green-700/30 bg-green-900/10 text-green-400';
    case 'loopback': return 'border-gray-700 bg-gray-800 text-gray-500';
    default: return 'border-gray-700 bg-gray-800 text-gray-500';
  }
}

function latencyLabel(ms?: number): string {
  if (ms === undefined || ms === null) return '--';
  return `${ms}ms`;
}

// ─── Node Card ───

function NodeCard({ peer, kind, nodeId, onEnter, reachable }: {
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
  const host = extractHost(peer.address);
  const port = extractPort(peer.address);
  const addressLine = peer.address || `${host}:${port}`;

  // When reachability flips to true while reconnecting, the attempt succeeded.
  // When it stays false after timeout, mark as failed.
  useEffect(() => {
    if (reachable && reconnecting) {
      setReconnecting(false);
      setFailed(false);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    }
  }, [reachable, reconnecting]);

  // Cleanup timer on unmount.
  useEffect(() => () => { if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current); }, []);

  const handleReconnect = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!nodeId) return;
    setReconnecting(true);
    setFailed(false);
    try {
      await core.call('node.peer.reconnect', { nodeId });
    } catch (_e) { /* ignore — SSE event will confirm or timeout will fire */ }
    // Don't reset reconnecting here — wait for SSE node.connected or timeout.
    reconnectTimerRef.current = setTimeout(() => {
      setReconnecting(false);
      setFailed(true);
    }, 10000); // 10s timeout: if no node.connected by then, consider failed
  }, [core, nodeId]);

  const showEnter = isRemote && reachable;
  const showReconnect = isRemote && !reachable && onEnter && !reconnecting;
  const showReconnecting = isRemote && !reachable && reconnecting;
  const showRetry = isRemote && !reachable && failed;

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-colors ${isRemote ? 'cursor-pointer hover:border-purple-600/50' : 'cursor-default'} ${nodeTheme(kind)}`}
      onClick={showEnter ? onEnter : undefined}
    >
      <div className="px-3.5 py-2.5 flex items-start gap-2.5 bg-gray-800/30">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor(kind)}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-100 truncate">{peer.name}</div>
          <div className="text-[11px] text-gray-300 font-mono truncate">{addressLine}</div>
          {nodeId && (
            <div className="text-[9px] text-gray-600 font-mono truncate">{nodeId}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          {peer.networkType && (
            <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono border shrink-0 ${networkClass(peer.networkType)}`}>
              {peer.networkType.toUpperCase()}
            </span>
          )}
          {kind !== 'LOCAL' && (
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

// ─── Link Line ───

function LinkLine({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <div className={`ml-5 -my-1 border-l-2 pl-4 py-2 flex items-center gap-2 ${muted ? 'border-gray-700/50' : 'border-amber-700/30'}`}>
      <div className={`text-[9px] font-mono ${muted ? 'text-gray-500' : 'text-amber-600/70'}`}>{label}</div>
    </div>
  );
}

// ─── [+ Add Peer] Dialog ───

function AddPeerDialog({ onClose, core }: { onClose: () => void; core: { call: Function } }) {
  const [tab, setTab] = useState<'invite' | 'direct'>('invite');

  // Accept invite state
  const [peerUrl, setPeerUrl] = useState('');
  const [code, setCode] = useState('');
  const [nameHint, setNameHint] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [acceptErr, setAcceptErr] = useState<string | null>(null);

  // Create invite state
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  const handleAccept = async () => {
    if (!peerUrl.trim() || !code.trim()) return;
    setAccepting(true);
    setAcceptErr(null);
    try {
      await core.call('node.invite.accept', { peerUrl: peerUrl.trim(), code: code.trim(), nameHint: nameHint.trim() || undefined });
      onClose();
    } catch (err) {
      setAcceptErr(err instanceof Error ? err.message : 'Failed to accept invite');
    } finally {
      setAccepting(false);
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    setCreateErr(null);
    setCreatedCode(null);
    try {
      const result = await core.call('node.invite.create', { ttlSeconds: 300, nameHint: nameHint.trim() || undefined });
      setCreatedCode(result.code);
    } catch (err) {
      setCreateErr(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setCreating(false);
    }
  };

  function copyCode() {
    if (createdCode) {
      navigator.clipboard.writeText(createdCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#111] border border-gray-700 rounded-lg w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
          <span className="text-[11px] font-mono text-gray-200">Add Peer</span>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400 text-lg leading-none">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          <button onClick={() => setTab('invite')}
            className={`flex-1 px-3 py-1.5 text-[10px] font-mono border-b-2 transition-colors ${
              tab === 'invite' ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>Invite Code</button>
          <button onClick={() => setTab('direct')}
            className={`flex-1 px-3 py-1.5 text-[10px] font-mono border-b-2 transition-colors ${
              tab === 'direct' ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>Direct Add</button>
        </div>

        <div className="p-4 space-y-3">
          {tab === 'invite' ? (
            <>
              {/* Create invite */}
              <div>
                <h4 className="text-[9px] text-gray-500 mb-2">Generate invite code for another node to connect to this Core:</h4>
                <div className="flex gap-2">
                  <input type="text" value={nameHint} onChange={e => setNameHint(e.target.value)}
                    placeholder="name hint (optional)"
                    className="flex-1 px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 focus:border-purple-500 outline-none placeholder:text-gray-600" />
                  <button onClick={handleCreate} disabled={creating}
                    className="px-3 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white text-[10px] transition-colors disabled:opacity-50">
                    {creating ? 'Creating...' : 'Generate'}
                  </button>
                </div>
                {createErr && <div className="text-[9px] text-red-400 mt-1">{createErr}</div>}
                {createdCode && (
                  <div className="mt-2 p-2 bg-black rounded border border-emerald-800/50">
                    <div className="text-[9px] text-emerald-400 mb-1">One-time code (copy now):</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 font-mono text-[10px] text-gray-200 break-all">{createdCode}</code>
                      <button onClick={copyCode} className="p-1 rounded hover:bg-[#1a1a1a] text-gray-400 hover:text-gray-200">
                        {codeCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="border-t border-gray-800 pt-3">
                <h4 className="text-[9px] text-gray-500 mb-2">Or accept an invite from another Core:</h4>
                <div className="space-y-2">
                  <input type="text" value={peerUrl} onChange={e => setPeerUrl(e.target.value)}
                    placeholder="ws://host:port/peer/ws"
                    className="w-full px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 focus:border-purple-500 outline-none placeholder:text-gray-600" />
                  <div className="flex gap-2">
                    <input type="text" value={code} onChange={e => setCode(e.target.value)}
                      placeholder="invite code"
                      className="flex-1 px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 font-mono focus:border-purple-500 outline-none placeholder:text-gray-600" />
                    <input type="text" value={nameHint} onChange={e => setNameHint(e.target.value)}
                      placeholder="name (optional)"
                      className="w-28 px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 focus:border-purple-500 outline-none placeholder:text-gray-600" />
                  </div>
                  <button onClick={handleAccept} disabled={accepting || !peerUrl.trim() || !code.trim()}
                    className="px-3 py-1 rounded bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40 text-[10px] transition-colors disabled:opacity-50">
                    {accepting ? 'Accepting...' : 'Accept Invite'}
                  </button>
                  {acceptErr && <div className="text-[9px] text-red-400 mt-1">{acceptErr}</div>}
                </div>
              </div>
            </>
          ) : (
            /* Direct add tab */
            <div className="text-[10px] text-gray-500 space-y-3">
              <p className="font-mono">Connect directly to a peer Core by address.</p>
              <input type="text" disabled
                placeholder="remote address (ws://host:port/peer/ws)"
                className="w-full px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-600 outline-none cursor-not-allowed" />
              <input type="text" disabled
                placeholder="node ID (optional)"
                className="w-full px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-600 outline-none cursor-not-allowed" />
              <div className="text-[9px] text-yellow-600 bg-yellow-900/10 border border-yellow-800/30 rounded px-2 py-1">
                Direct peer add requires a <code className="text-yellow-400">node.peer.connect</code> Core API. Use invite code pairing instead.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Export ───

export function NodeNetworkView({
  onEnterNode, isLocalPage,
}: NodeNetworkViewProps) {
  const core = useCore();

  // ── Topology state (from CoreClient) ──
  const [localNodeId, setLocalNodeId] = useState<string | null>(null);
  const [topoNodes, setTopoNodes] = useState<NodeInfo[]>([]);
  const [topoLoading, setTopoLoading] = useState(true);
  const [topoError, setTopoError] = useState<string | null>(null);

  // ── Mesh peer state ──
  const [meshPeers, setMeshPeers] = useState<PeerEntry[]>([]);
  const [meshPeersLoading, setMeshPeersLoading] = useState(false);
  const [meshInvites, setMeshInvites] = useState<NodeInvite[]>([]);
  const [showAddPeer, setShowAddPeer] = useState(false);

  // ── Reachability (from SSE events — single source of truth) ──
  const reachableNodeIds = useReachableNodeIds();

  // ── Fetch topology from CoreClient ──
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

  // ── Build alias map from meshPeers (trust store names) ──
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
    // Use alias from peer trust store if available
    const alias = info.nodeId ? peerAliasMap.get(info.nodeId) : undefined;
    const displayName = alias || info.name;
    if (linkLabel && topo.length > 0) {
      topo.push({ kind: 'link', label: linkLabel, muted: linkMuted });
    }
    topo.push({ kind: 'node', data: { peer: { name: displayName, address: info.address, networkType: info.networkType }, kind, nodeId: info.nodeId, onEnter, reachable } });
    addedIds.add(id);
  }

  // 1. Local node — only shown when Core is connected
  if (core.isConnected) {
    addNode('__local__', { name: localName, address: localAddress, networkType: localNetworkType, nodeId: localNodeId || undefined }, 'LOCAL',
      undefined, false,
      () => onEnterNode?.(localNodeId || '__local__'));
  }

  // 2. Leaf nodes connected to local
  for (const leaf of leafNodes) {
    const leafHost = extractHost(leaf.address);
    const leafNet = leaf.address ? categorizeNetwork(leafHost) : 'wan';
    addNode(leaf.nodeId, { name: leaf.name, address: leaf.address, networkType: leafNet, nodeId: leaf.nodeId }, 'LEAF',
      'leaf connected', false,
      () => onEnterNode?.(leaf.nodeId),
      reachableNodeIds.has(leaf.nodeId));
  }

  // 3. Relay nodes
  for (const relay of relayNodes) {
    const relayHost = extractHost(relay.address);
    const relayNet = relay.address ? categorizeNetwork(relayHost) : 'wan';
    addNode(relay.nodeId, { name: relay.name, address: relay.address, networkType: relayNet, nodeId: relay.nodeId }, 'RELAY',
      'relay / upstream', false,
      () => onEnterNode?.(relay.nodeId),
      reachableNodeIds.has(relay.nodeId));
  }


  // ── Render ──
  return (
    <div className="space-y-5 px-1 pb-4">
      {/* ── Topology ── */}
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

      {/* ── Mesh peers section ── */}
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
            {/* Mesh peers */}
            {meshPeers.map(peer => (
              <div key={peer.nodeId} className="flex items-center gap-2 px-2.5 py-1.5 rounded border border-gray-800 bg-[#111]">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  reachableNodeIds.has(peer.nodeId) ? 'bg-emerald-500' :
                  'bg-gray-600'
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

            {/* Active invites */}
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

        {/* Manage peers link */}
        <div className="mt-2 px-1">
          <button onClick={() => onEnterNode?.('__mesh__')}
            className="text-[9px] text-gray-600 hover:text-gray-400 transition-colors">
            Manage Peers →
          </button>
        </div>
      </div>

      {/* ── [+ Add Peer] dialog ── */}
      {showAddPeer && (
        <AddPeerDialog onClose={() => { setShowAddPeer(false); fetchMeshPeers(); fetchInvites(); }} core={core} />
      )}
    </div>
  );
}

// ─── Connection Card (simplified) ───

