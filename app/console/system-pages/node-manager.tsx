'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { RefreshCw, ChevronDown, ChevronRight, Plus, X, Copy, Check, Activity } from 'lucide-react';
import type { CoreClient, NodeInfo, NodeIdentity, PeerEntry, NodeInvite, ReachabilityResult } from '../core/core-types';
import { PageHeader, PageLoading, PageError, PageEmpty, PageOffline, type PageState } from './page-utils';
import { listFromResponse, normalizeNodeInfo } from './core-response-utils';

interface NodeManagerProps {
  core: CoreClient;
}

type MeshTab = 'nodes' | 'identity' | 'peers' | 'invites' | 'reachability';

export function NodeManager({ core }: NodeManagerProps) {
  const [activeTab, setActiveTab] = useState<MeshTab>('nodes');
  const [pageState, setPageState] = useState<PageState>('loading');
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [selectedNode, setSelectedNode] = useState<NodeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mesh state
  const [identity, setIdentity] = useState<NodeIdentity | null>(null);
  const [identityState, setIdentityState] = useState<PageState>('loading');
  const [peers, setPeers] = useState<PeerEntry[]>([]);
  const [peersState, setPeersState] = useState<PageState>('loading');
  const [invites, setInvites] = useState<NodeInvite[]>([]);
  const [invitesState, setInvitesState] = useState<PageState>('loading');
  const [reachability, setReachability] = useState<ReachabilityResult | null>(null);
  const [reachabilityState, setReachabilityState] = useState<PageState>('loading');

  // Invite create form
  const [showCreateInvite, setShowCreateInvite] = useState(false);
  const [inviteTtl, setInviteTtl] = useState('60');
  const [inviteTrustDuration, setInviteTrustDuration] = useState('0');
  const [inviteNameHint, setInviteNameHint] = useState('');
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [codeCopied, setCodeCopied] = useState(false);

  // Invite accept form
  const [showAcceptInvite, setShowAcceptInvite] = useState(false);
  const [acceptPeerUrl, setAcceptPeerUrl] = useState('');
  const [acceptCode, setAcceptCode] = useState('');
  const [acceptInviting, setAcceptInviting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  // Invite create loading state
  const [createInviting, setCreateInviting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Per-peer action states
  const [peerActions, setPeerActions] = useState<Record<string, { loading?: boolean; error?: string }>>({});

  function setPeerAction(nodeId: string, update: { loading?: boolean; error?: string }) {
    setPeerActions(prev => ({
      ...prev,
      [nodeId]: { ...prev[nodeId], ...update },
    }));
  }

  async function fetchNodes() {
    if (!core.isConnected) {
      setPageState('offline');
      return;
    }
    setPageState('loading');
    setError(null);
    try {
      const result = await core.call<unknown>('node.list');
      const normalized = listFromResponse<Partial<NodeInfo> & Record<string, unknown>>(result, 'nodes').map(normalizeNodeInfo);
      setNodes(normalized);
      setPageState(normalized.length > 0 ? 'ready' : 'empty');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load nodes');
      setPageState('error');
    }
  }

  async function fetchNodeDetail(nodeId: string) {
    try {
      const detail = await core.call<Partial<NodeInfo> & Record<string, unknown>>('node.info', { nodeId });
      setSelectedNode(normalizeNodeInfo(detail));
    } catch (err) {
      setSelectedNode(prev => prev ? { ...prev, status: 'error', address: err instanceof Error ? err.message : prev.address } : prev);
    }
  }

  const fetchIdentity = useCallback(async () => {
    if (!core.isConnected) { setIdentityState('offline'); return; }
    setIdentityState('loading');
    try {
      const result = await core.call<NodeIdentity>('node.identity.get');
      setIdentity(result);
      setIdentityState('ready');
    } catch { setIdentityState('error'); }
  }, [core]);

  const fetchPeers = useCallback(async () => {
    if (!core.isConnected) { setPeersState('offline'); return; }
    setPeersState('loading');
    try {
      const result = await core.call<{ peers: PeerEntry[] }>('node.peer.list');
      setPeers(result.peers || []);
      setPeersState(result.peers?.length > 0 ? 'ready' : 'empty');
    } catch { setPeersState('error'); }
  }, [core]);

  const fetchInvites = useCallback(async () => {
    if (!core.isConnected) { setInvitesState('offline'); return; }
    setInvitesState('loading');
    try {
      const result = await core.call<{ invites: NodeInvite[]; total: number }>('node.invite.list');
      setInvites(result.invites || []);
      setInvitesState(result.invites?.length > 0 ? 'ready' : 'empty');
    } catch { setInvitesState('error'); }
  }, [core]);

  const fetchReachability = useCallback(async () => {
    if (!core.isConnected) { setReachabilityState('offline'); return; }
    setReachabilityState('loading');
    try {
      const result = await core.call<ReachabilityResult>('node.reachability.check');
      setReachability(result);
      setReachabilityState('ready');
    } catch { setReachabilityState('error'); }
  }, [core]);

  useEffect(() => {
    fetchNodes();
    fetchIdentity();
    fetchPeers();
    fetchInvites();
    fetchReachability();
  }, [core, fetchIdentity, fetchPeers, fetchInvites, fetchReachability]);

  async function handleCreateInvite() {
    setCreateInviting(true);
    setCreateError(null);
    try {
      const result = await core.call<{ code: string; inviteId: string }>('node.invite.create', {
        ttlSeconds: parseInt(inviteTtl, 10) || 60,
        trustDurationSeconds: parseInt(inviteTrustDuration, 10) || 0,
        nameHint: inviteNameHint || undefined,
      });
      setCreatedCode(result.code);
      await fetchInvites();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create invite');
    } finally {
      setCreateInviting(false);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    try {
      await core.call('node.invite.revoke', { inviteId });
      await fetchInvites();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke invite');
    }
  }

  async function handleAcceptInvite() {
    setAcceptInviting(true);
    setAcceptError(null);
    try {
      await core.call<unknown>('node.invite.accept', {
        peerUrl: acceptPeerUrl,
        code: acceptCode,
      });
      setShowAcceptInvite(false);
      setAcceptPeerUrl('');
      setAcceptCode('');
      await fetchPeers();
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : 'Failed to accept invite');
    } finally {
      setAcceptInviting(false);
    }
  }

  async function handleReconnectPeer(nodeId: string) {
    setPeerAction(nodeId, { loading: true, error: undefined });
    try {
      await core.call('node.peer.reconnect', { nodeId });
    } catch (err) {
      setPeerAction(nodeId, { error: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setPeerAction(nodeId, { loading: false });
    }
  }

  async function handleDisconnectPeer(nodeId: string) {
    setPeerAction(nodeId, { loading: true, error: undefined });
    try {
      await core.call<unknown>('node.peer.disconnect', { nodeId });
      await fetchPeers();
    } catch (err) {
      setPeerAction(nodeId, { error: err instanceof Error ? err.message : 'Failed' });
    } finally {
      setPeerAction(nodeId, { loading: false });
    }
  }

  async function handleRevokePeer(nodeId: string) {
    setPeerAction(nodeId, { loading: true, error: undefined });
    try {
      await core.call<unknown>('node.peer.revoke', { nodeId });
      await fetchPeers();
    } catch (err) {
      setPeerAction(nodeId, { error: err instanceof Error ? err.message : 'Failed to revoke peer' });
    } finally {
      setPeerAction(nodeId, { loading: false });
    }
  }

  function copyCode() {
    if (createdCode) {
      navigator.clipboard.writeText(createdCode);
      setCodeCopied(true);
      setTimeout(() => setCodeCopied(false), 2000);
    }
  }

  const tabs: { id: MeshTab; label: string }[] = [
    { id: 'nodes', label: 'Nodes' },
    { id: 'identity', label: 'Identity' },
    { id: 'peers', label: 'Peers' },
    { id: 'invites', label: 'Invites' },
    { id: 'reachability', label: 'Reachability' },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <PageHeader
        title="Nodes"
        actions={
          <button onClick={() => { fetchNodes(); fetchIdentity(); fetchPeers(); fetchInvites(); fetchReachability(); }}
            className="p-1.5 rounded hover:bg-[#1a1a1a] text-gray-400 hover:text-gray-200 transition-colors" title="Refresh all">
            <RefreshCw size={16} />
          </button>
        }
      />

      {/* Tab bar */}
      <div className="flex border-b border-gray-800 px-4 gap-0">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-[10px] font-mono border-b-2 transition-colors ${
              activeTab === tab.id ? 'border-purple-500 text-purple-400' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 p-4">
        {activeTab === 'nodes' && renderNodesTab()}
        {activeTab === 'identity' && renderIdentityTab()}
        {activeTab === 'peers' && renderPeersTab()}
        {activeTab === 'invites' && renderInvitesTab()}
        {activeTab === 'reachability' && renderReachabilityTab()}
      </div>
    </div>
  );

  function renderNodesTab() {
    if (pageState === 'loading') return <PageLoading rows={5} />;
    if (pageState === 'offline') return <PageOffline />;
    if (pageState === 'error') return <PageError message={error || 'Unknown error'} onRetry={fetchNodes} />;
    if (pageState === 'empty') return <PageEmpty title="No nodes configured" description="Add a node to get started with cluster management." />;

    return (
      <>
        <div className="space-y-1.5">
          {nodes.map(node => (
            <button key={node.nodeId} onClick={() => { setSelectedNode(node); fetchNodeDetail(node.nodeId); }}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded border text-[10px] text-left transition-colors ${
                selectedNode?.nodeId === node.nodeId ? 'border-purple-500/50 bg-purple-900/10' : 'border-gray-800 bg-[#111] hover:bg-[#1a1a1a]'
              }`}>
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                node.status === 'online' ? 'bg-emerald-500' :
                node.status === 'connecting' ? 'bg-yellow-500' :
                node.status === 'error' ? 'bg-red-500' : 'bg-gray-600'
              }`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-gray-200">{node.name}</span>
                  <span className="text-[9px] text-gray-500 bg-[#1a1a1a] px-1.5 py-0.5 rounded">{node.role || '-'}</span>
                  <span className="text-[9px] text-gray-600">{node.version || ''}</span>
                </div>
                <div className="text-[9px] text-gray-500 mt-0.5">{node.address || ''}{node.uptime ? ` - up ${node.uptime}` : ''}</div>
              </div>
              <span className="text-[9px] text-gray-500 flex-shrink-0">CPU {node.cpu || '-'}</span>
            </button>
          ))}
        </div>

        {selectedNode && (
          <div className="mt-4 p-3 bg-[#111] rounded border border-gray-800">
            <h3 className="text-[11px] font-mono text-gray-200 mb-2">Node Detail: {selectedNode.name}</h3>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <DetailRow label="ID" value={selectedNode.nodeId} />
              <DetailRow label="Role" value={selectedNode.role || '-'} />
              <DetailRow label="Status" value={selectedNode.status} />
              <DetailRow label="Version" value={selectedNode.version || '-'} />
              <DetailRow label="Uptime" value={selectedNode.uptime || '-'} />
              <DetailRow label="Address" value={selectedNode.address || '-'} />
              {selectedNode.os && <DetailRow label="OS" value={`${selectedNode.os} ${selectedNode.arch || ''}`} />}
              {selectedNode.memory && <DetailRow label="Memory" value={selectedNode.memory} />}
              {selectedNode.disk && <DetailRow label="Disk" value={selectedNode.disk} />}
            </div>
          </div>
        )}
      </>
    );
  }

  function renderIdentityTab() {
    if (identityState === 'loading') return <PageLoading rows={4} />;
    if (identityState === 'offline') return <PageOffline />;
    if (identityState === 'error') return <PageError message="Failed to load identity" onRetry={fetchIdentity} />;

    if (!identity) return <PageEmpty title="No identity" description="Node identity not available." />;

    return (
      <div className="p-3 bg-[#111] rounded border border-gray-800">
        <h3 className="text-[11px] font-mono text-gray-200 mb-3">Local Node Identity</h3>
        <div className="space-y-2 text-[10px]">
          <DetailRow label="Node ID" value={identity.nodeId} />
          <div>
            <span className="text-gray-500 block mb-0.5">Fingerprint:</span>
            <span className="font-mono text-[9px] text-gray-300 break-all bg-black px-2 py-1 rounded">{identity.fingerprint}</span>
          </div>
          <div>
            <span className="text-gray-500 block mb-0.5">Public Key:</span>
            <span className="font-mono text-[9px] text-gray-300 break-all bg-black px-2 py-1 rounded">{identity.publicKey}</span>
          </div>
          <DetailRow label="Created" value={new Date(identity.createdAt).toLocaleString()} />
        </div>
      </div>
    );
  }

  function renderPeersTab() {
    if (peersState === 'loading') return <PageLoading rows={3} />;
    if (peersState === 'offline') return <PageOffline />;
    if (peersState === 'error') return <PageError message="Failed to load peers" onRetry={fetchPeers} />;

    return (
      <>
        {peers.length === 0 ? (
          <PageEmpty title="No trusted peers" description="Use the Invites tab to create an invite or accept one from another node." />
        ) : (
          <div className="space-y-1.5">
            {peers.map(peer => (
              <React.Fragment key={peer.nodeId}>
                <div className="flex items-center gap-3 px-3 py-2 rounded border border-gray-800 bg-[#111] text-[10px]">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    peer.status === 'connected' ? 'bg-emerald-500' :
                    peer.status === 'connecting' || peer.status === 'reconnecting' ? 'bg-yellow-500' :
                    peer.status === 'revoked' || peer.status === 'expired' ? 'bg-red-500' : 'bg-gray-600'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-gray-200">{peer.name || peer.nodeId}</span>
                      <span className="text-[9px] text-gray-500 bg-[#1a1a1a] px-1.5 py-0.5 rounded">{peer.status}</span>
                    </div>
                    <div className="text-[9px] text-gray-500 mt-0.5 font-mono">{peer.nodeId}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleReconnectPeer(peer.nodeId)} disabled={peerActions[peer.nodeId]?.loading}
                      className="text-[9px] px-2 py-1 rounded bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40 transition-colors disabled:opacity-50">
                      Reconnect
                    </button>
                    <button onClick={() => handleDisconnectPeer(peer.nodeId)} disabled={peerActions[peer.nodeId]?.loading || peer.status !== 'connected'}
                      className="text-[9px] px-2 py-1 rounded bg-yellow-900/20 text-yellow-400 hover:bg-yellow-900/40 transition-colors disabled:opacity-50">
                      Disconnect
                    </button>
                    <button onClick={() => handleRevokePeer(peer.nodeId)} disabled={peerActions[peer.nodeId]?.loading}
                      className="text-[9px] px-2 py-1 rounded bg-red-900/20 text-red-400 hover:bg-red-900/40 transition-colors disabled:opacity-50">
                      Revoke
                    </button>
                  </div>
                </div>
                {peerActions[peer.nodeId]?.error && (
                  <div className="text-[9px] text-red-400 mt-1 ml-3">{peerActions[peer.nodeId].error}</div>
                )}
              </React.Fragment>
            ))}
          </div>
        )}
        <p className="text-[9px] text-gray-600 mt-3">
          Peers are authenticated via ed25519 challenge-response. Use an invite code to add a new peer.
        </p>
      </>
    );
  }

  function renderInvitesTab() {
    if (invitesState === 'loading') return <PageLoading rows={3} />;
    if (invitesState === 'offline') return <PageOffline />;
    if (invitesState === 'error') return <PageError message="Failed to load invites" onRetry={fetchInvites} />;

    return (
      <div className="space-y-3">
        {/* Action buttons */}
        <div className="flex gap-2">
          <button onClick={() => { setShowCreateInvite(true); setCreatedCode(null); }}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white text-[10px] transition-colors">
            <Plus size={12} /> Create Invite
          </button>
          <button onClick={() => setShowAcceptInvite(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded border border-gray-700 hover:border-purple-500 text-gray-300 text-[10px] transition-colors">
            <Plus size={12} /> Accept Invite
          </button>
        </div>

        {/* Create invite form */}
        {showCreateInvite && (
          <div className="p-3 bg-[#111] rounded border border-gray-800 space-y-2">
            <h4 className="text-[10px] font-mono text-gray-300">New Invite</h4>
            <div className="flex gap-2 flex-wrap">
              <div>
                <label className="text-[9px] text-gray-500 block mb-0.5">TTL (seconds)</label>
                <input type="number" value={inviteTtl} onChange={e => setInviteTtl(e.target.value)}
                  className="w-20 px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 focus:border-purple-500 outline-none" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 block mb-0.5">Trust Duration (0=permanent)</label>
                <input type="number" value={inviteTrustDuration} onChange={e => setInviteTrustDuration(e.target.value)}
                  className="w-20 px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 focus:border-purple-500 outline-none" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 block mb-0.5">Name Hint</label>
                <input type="text" value={inviteNameHint} onChange={e => setInviteNameHint(e.target.value)} placeholder="optional"
                  className="w-32 px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 focus:border-purple-500 outline-none placeholder:text-gray-600" />
              </div>
            </div>
            <div className="flex gap-2 mt-1">
              <button onClick={handleCreateInvite} disabled={createInviting}
                className="px-3 py-1 rounded bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40 text-[10px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {createInviting ? 'Generating...' : 'Generate'}
              </button>
              <button onClick={() => setShowCreateInvite(false)}
                className="px-3 py-1 rounded text-gray-500 hover:text-gray-300 text-[10px] transition-colors">
                Cancel
              </button>
            </div>
            {createError && (
              <div className="text-[9px] text-red-400 mt-1">{createError}</div>
            )}

            {/* Created code display */}
            {createdCode && (
              <div className="mt-2 p-2 bg-black rounded border border-emerald-800/50">
                <div className="text-[9px] text-emerald-400 mb-1">One-time code (copy now, it won't be shown again):</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-[10px] text-gray-200 break-all">{createdCode}</code>
                  <button onClick={copyCode}
                    className="p-1 rounded hover:bg-[#1a1a1a] text-gray-400 hover:text-gray-200 transition-colors">
                    {codeCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Accept invite form */}
        {showAcceptInvite && (
          <div className="p-3 bg-[#111] rounded border border-gray-800 space-y-2">
            <h4 className="text-[10px] font-mono text-gray-300">Accept Invite</h4>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[9px] text-gray-500 block mb-0.5">Peer URL</label>
                <input type="text" value={acceptPeerUrl} onChange={e => setAcceptPeerUrl(e.target.value)}
                  placeholder="ws://host:port/peer/ws"
                  className="w-full px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 focus:border-purple-500 outline-none placeholder:text-gray-600" />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 block mb-0.5">Code</label>
                <input type="text" value={acceptCode} onChange={e => setAcceptCode(e.target.value)}
                  className="w-48 px-2 py-1 bg-[#1a1a1a] border border-gray-700 rounded text-[10px] text-gray-200 font-mono focus:border-purple-500 outline-none" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleAcceptInvite} disabled={acceptInviting || !acceptPeerUrl || !acceptCode}
                className="px-3 py-1 rounded bg-emerald-900/20 text-emerald-400 hover:bg-emerald-900/40 text-[10px] transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {acceptInviting ? 'Accepting...' : 'Accept'}
              </button>
              <button onClick={() => setShowAcceptInvite(false)}
                className="px-3 py-1 rounded text-gray-500 hover:text-gray-300 text-[10px] transition-colors">
                Cancel
              </button>
            </div>
            {acceptError && (
              <div className="text-[9px] text-red-400 mt-1">{acceptError}</div>
            )}
          </div>
        )}

        {/* Invite list */}
        {invites.length === 0 ? (
          <PageEmpty title="No invites" description="Create an invite to pair with another node." />
        ) : (
          <div className="space-y-1.5">
            {invites.map(inv => {
              const expired = inv.expiresAt * 1000 < Date.now();
              return (
                <div key={inv.inviteId} className={`flex items-center gap-3 px-3 py-2 rounded border text-[10px] ${
                  expired ? 'border-gray-800/50 bg-[#0d0d0d] opacity-60' : 'border-gray-800 bg-[#111]'
                }`}>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${expired ? 'bg-gray-600' : 'bg-yellow-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-gray-200">{inv.inviteId}</div>
                    <div className="text-[9px] text-gray-500">
                      expires {new Date(inv.expiresAt * 1000).toLocaleString()}
                      {inv.trustDurationSeconds > 0 ? ` · trust: ${inv.trustDurationSeconds}s` : ' · permanent trust'}
                    </div>
                  </div>
                  {!expired && (
                    <button onClick={() => handleRevokeInvite(inv.inviteId)}
                      className="text-[9px] px-2 py-1 rounded bg-red-900/20 text-red-400 hover:bg-red-900/40 transition-colors">
                      Revoke
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  function renderReachabilityTab() {
    if (reachabilityState === 'loading') return <PageLoading rows={2} />;
    if (reachabilityState === 'offline') return <PageOffline />;
    if (reachabilityState === 'error') return <PageError message="Failed to check reachability" onRetry={fetchReachability} />;

    if (!reachability) return <PageEmpty title="No data" description="Reachability check not available." />;

    return (
      <div className="space-y-3">
        <div className="p-3 bg-[#111] rounded border border-gray-800">
          <h3 className="text-[11px] font-mono text-gray-200 mb-3">Reachability Status</h3>
          <div className="space-y-2 text-[10px]">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                reachability.inboundPeerAllowed ? 'bg-emerald-500' : 'bg-gray-600'
              }`} />
              <span className="text-gray-400">Inbound peer connections:</span>
              <span className={reachability.inboundPeerAllowed ? 'text-emerald-400' : 'text-gray-500'}>
                {reachability.inboundPeerAllowed ? 'Allowed' : 'Not allowed'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                reachability.outboundOnly ? 'bg-yellow-500' : 'bg-emerald-500'
              }`} />
              <span className="text-gray-400">Outbound only:</span>
              <span className={reachability.outboundOnly ? 'text-yellow-400' : 'text-gray-500'}>
                {reachability.outboundOnly ? 'Yes' : 'No'}
              </span>
            </div>
            <DetailRow label="Public reachable" value={reachability.publicReachable} />
            <DetailRow label="Reason" value={reachability.reason} />
          </div>
        </div>

        <div className="p-3 bg-[#111] rounded border border-gray-800">
          <h3 className="text-[11px] font-mono text-gray-200 mb-2">Connection Safety</h3>
          <div className="space-y-1.5 text-[10px]">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full flex-shrink-0 bg-emerald-500" />
              <span className="text-gray-400">WebSocket:</span>
              <span className="font-mono text-gray-300">{core.wsUrl}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full flex-shrink-0 bg-emerald-500" />
              <span className="text-gray-400">Connected:</span>
              <span className="text-emerald-400">{core.isConnected ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                !core.lastError ? 'bg-emerald-500' : 'bg-red-500'
              }`} />
              <span className="text-gray-400">Last Error:</span>
              <span className={core.lastError ? 'text-red-400' : 'text-gray-500'}>
                {core.lastError || 'None'}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-gray-500 w-20 flex-shrink-0 text-[10px]">{label}:</span>
      <span className="text-gray-300 text-[10px]">{value}</span>
    </div>
  );
}
