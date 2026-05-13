'use client';

import { Cpu, Monitor, Server, X } from 'lucide-react';

interface PeerInfo {
  id: string;
  name: string;
  ip?: string;
  type: 'agent' | 'browser';
  role?: 'relay' | 'leaf';
  networkType?: 'loopback' | 'lan' | 'wan' | 'unknown';
  hasPublicAccess?: boolean;
  connectedAt?: number;
  port?: number;
  isLocal?: boolean;
}

interface ConnectionItem {
  id: string;
  name: string;
  url: string;
  networkType: string;
}

interface NodeNetworkViewProps {
  peers: PeerInfo[];
  links?: any[];
  wsUrl: string;
  connections: ConnectionItem[];
  onDeleteConnection: (id: string) => void;
  newConnUrl: string;
  onNewConnUrlChange: (url: string) => void;
  onAddConnection: (e: React.FormEvent) => void;
  onEnterNode?: (nodeId: string) => void;
  upstreamUrl?: string;
  onConnectUpstream?: (url: string) => Promise<void>;
  onDisconnectUpstream?: () => void;
  upstreamConnectingUrl?: string;
  upstreamError?: string;
  upstreamErrorUrl?: string;
  upstreamStatus?: string;
  isLocalPage?: boolean;
  browserId?: string;
}

// ─── Display node kind ───
type NodeKind = 'RELAY' | 'LEAF' | 'VIEW' | 'LOCAL';

function nodeTheme(kind: NodeKind) {
  switch (kind) {
    case 'RELAY': return 'border-amber-700/40 bg-amber-900/[0.06]';
    case 'LEAF': return 'border-blue-700/40 bg-blue-900/[0.05]';
    case 'VIEW': return 'border-gray-700/60 bg-gray-800/20';
    case 'LOCAL': return 'border-gray-700/60 bg-gray-800/30';
  }
}

function badgeStyle(kind: NodeKind) {
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

// ─── Helpers ───
function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '0.0.0.0';
  } catch { return true; }
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

// ─── Node Card ───
function NodeCard({ peer, kind, onEnter }: { peer: { name: string; ip?: string; port?: number; networkType?: string }; kind: NodeKind; onEnter?: () => void }) {
  const Icon = kind === 'VIEW' ? Monitor : kind === 'RELAY' ? Server : Cpu;
  const clickable = kind !== 'VIEW' && !!onEnter;
  const address = peer.ip ? `${peer.ip}:${peer.port || 8080}` : undefined;

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-colors ${clickable ? 'cursor-pointer hover:border-purple-600/50' : 'cursor-default'} ${nodeTheme(kind)}`}
      onClick={clickable ? onEnter : undefined}
    >
      <div className="px-3.5 py-2.5 flex items-center gap-2.5 bg-gray-800/30">
        <Icon className={`w-4 h-4 shrink-0 ${iconColor(kind)}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-100 truncate">{peer.name}</div>
          {address && <div className="text-[10px] text-gray-500 font-mono truncate">{address}</div>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {peer.networkType && (
            <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono border shrink-0 ${networkClass(peer.networkType)}`}>
              {peer.networkType.toUpperCase()}
            </span>
          )}
          {kind !== 'LOCAL' && (
            <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono border shrink-0 ${badgeStyle(kind)}`}>
              {kind}
            </span>
          )}
          {kind === 'VIEW' ? (
            <span className="text-[9px] px-2 py-0.5 rounded bg-gray-700/30 text-gray-400 border border-gray-700/40 shrink-0">View</span>
          ) : clickable ? (
            <span className="text-[9px] px-2 py-0.5 rounded bg-purple-700/30 text-purple-300 border border-purple-700/40 shrink-0">Enter</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Link Line ───
function LinkLine({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <div className={`ml-5 -my-1 border-l-2 pl-4 py-2 ${muted ? 'border-gray-700/50 text-gray-500' : 'border-amber-700/30 text-amber-600/70'}`}>
      <div className="text-[9px] font-mono">{label}</div>
    </div>
  );
}

// ─── Connection Badge ───
function ConnBadge({ status }: { status: 'connected' | 'connecting' | 'failed' | 'saved' }) {
  const colors: Record<string, string> = {
    connected: 'text-emerald-400 border-emerald-700/30 bg-emerald-900/10',
    connecting: 'text-amber-400 border-amber-700/30 bg-amber-900/10',
    failed: 'text-red-400 border-red-700/30 bg-red-900/10',
    saved: 'text-gray-500 border-gray-700 bg-gray-800',
  };
  return <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono border ${colors[status] || colors.saved}`}>{status}</span>;
}

// ─── Connection Card ───
function ConnectionCard({
  url, status, connType, active, onConnect, onDisconnect, onDelete,
}: {
  url: string; status: 'connected' | 'connecting' | 'failed' | 'saved'; connType: string;
  active: boolean; onConnect?: () => void; onDisconnect?: () => void; onDelete?: () => void;
}) {
  return (
    <div className="border border-gray-700/60 rounded-md bg-gray-900/20 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
        <div className="min-w-0 flex-1">
          <div className="text-gray-300 truncate font-mono">{url}</div>
          <div className="mt-0.5 flex items-center gap-1.5">
            <ConnBadge status={status} />
            <span className="text-[8px] px-1.5 py-0.5 rounded font-mono border border-amber-700/30 bg-amber-900/10 text-amber-500">
              {connType}
            </span>
            {active && (
              <span className="text-[8px] px-1.5 py-0.5 rounded font-mono border border-purple-700/40 bg-purple-900/20 text-purple-400">
                active
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {status === 'connecting' ? (
            <span className="text-[8px] px-1.5 py-0.5 text-amber-500 animate-pulse">连接中...</span>
          ) : active ? (
            <button onClick={onDisconnect}
              className="text-[8px] px-1.5 py-0.5 bg-red-800/40 hover:bg-red-700/50 text-red-400 rounded border border-red-800/40"
            >断开</button>
          ) : (
            onConnect && (
              <button onClick={onConnect}
                className="text-[8px] px-1.5 py-0.5 bg-purple-700/30 hover:bg-purple-700/50 text-purple-300 rounded border border-purple-700/40"
              >启用</button>
            )
          )}
          {!active && (
            <button onClick={onDelete} className="text-gray-600 hover:text-red-400 px-0.5">
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Export ───
export function NodeNetworkView({
  peers, wsUrl, connections, onDeleteConnection,
  newConnUrl, onNewConnUrlChange, onAddConnection,
  onEnterNode, upstreamUrl, onConnectUpstream, onDisconnectUpstream,
  upstreamConnectingUrl, upstreamError, upstreamErrorUrl,
  isLocalPage, browserId,
}: NodeNetworkViewProps) {
  // ── Derived data ──
  const wsHost = (() => { try { return new URL(wsUrl).hostname; } catch { return '127.0.0.1'; } })();
  const isLocalAccess = wsHost === '127.0.0.1' || wsHost === 'localhost' || wsHost === '0.0.0.0';

  // Local node (the machine running the relay the page is connected to)
  const localPeer = peers.find(p => p.id === '__local__' || p.isLocal);
  const localName = localPeer?.name || (isLocalPage ? '本机' : wsHost);
  const localIp = localPeer?.ip || wsHost;
  const localPort = localPeer?.port || 8080;

  // Remote agent peers: real connected nodes, not loopback
  const remotePeers = peers.filter(p => p.id !== '__local__' && !p.isLocal && !(p.type === 'agent' && p.networkType === 'loopback'));
  // Only use role field to classify — hasPublicAccess is a network hint, not a role
  const relayPeers = remotePeers.filter(p => p.type === 'agent' && p.role === 'relay');
  const leafPeers = remotePeers.filter(p => p.type === 'agent' && p.role !== 'relay');
  // Browser viewers (excluding self)
  const viewers = peers.filter(p => p.type === 'browser' && p.networkType !== 'loopback' && p.id !== browserId);

  // Upstream relay info
  const isUpstreamConnected = upstreamUrl && !isLocalUrl(upstreamUrl) && connections.some(c => c.url === upstreamUrl);
  const upstreamPeer = (() => {
    if (!isUpstreamConnected || !upstreamUrl) return null;
    try {
      const u = new URL(upstreamUrl);
      const saved = connections.find(c => c.url === upstreamUrl);
      return {
        id: `upstream:${upstreamUrl}`,
        name: saved?.name || u.hostname,
        ip: u.hostname,
        port: parseInt(u.port || '8080', 10),
        networkType: categorizeNetwork(u.hostname),
      };
    } catch { return null; }
  })();

  // ── Build topology ──
  // Ordered by access path: entry (VIEW/browser) → relay → leafs
  type TopoEntry = { kind: 'node'; data: { peer: { name: string; ip?: string; port?: number; networkType?: string }; kind: NodeKind; onEnter?: () => void } } | { kind: 'link'; label: string; muted?: boolean };

  const topo: TopoEntry[] = [];
  const addedIds = new Set<string>();

  function addNode(id: string, peer: { name: string; ip?: string; port?: number; networkType?: string }, kind: NodeKind, linkLabel?: string, linkMuted?: boolean, onEnter?: () => void) {
    if (addedIds.has(id)) return;
    if (linkLabel && topo.length > 0) topo.push({ kind: 'link', label: linkLabel, muted: linkMuted });
    topo.push({ kind: 'node', data: { peer, kind, onEnter } });
    addedIds.add(id);
  }

  // 1. VIEW entry — when accessing remotely, show the browser as the entry point
  if (!isLocalAccess) {
    addNode('__view__', { name: 'Current Browser', ip: wsHost, networkType: 'wan' }, 'VIEW');
  }

  // 2. Entry relay — upstream relay URL > local peer if role=relay > first remote relay
  const entryRelay = upstreamPeer || (localPeer?.role === 'relay' ? {
    id: '__local__',
    name: localName,
    ip: localIp,
    port: localPort,
    networkType: localPeer.networkType || categorizeNetwork(localIp),
  } : relayPeers.length > 0 ? {
    id: relayPeers[0].id,
    name: relayPeers[0].name,
    ip: relayPeers[0].ip,
    port: relayPeers[0].port,
    networkType: relayPeers[0].networkType || categorizeNetwork(relayPeers[0].ip || '127.0.0.1'),
  } : null);

  if (entryRelay) {
    const linkLabel = upstreamPeer ? 'connected upstream' : !isLocalAccess ? 'view entry' : undefined;
    addNode(entryRelay.id, entryRelay, 'RELAY', linkLabel, !isLocalAccess && !upstreamPeer, () => onEnterNode?.(entryRelay!.id));
  }

  // 3. Local node (if not already shown as relay entry)
  if (localPeer && localPeer.role !== 'relay') {
    addNode('__local__', { name: localName, ip: localIp, port: localPort, networkType: localPeer.networkType || categorizeNetwork(localIp) }, 'LOCAL',
      upstreamUrl ? 'connected upstream' : !isLocalAccess ? 'view entry' : undefined, !isLocalAccess && !upstreamUrl,
      () => onEnterNode?.('__local__'));
  }

  // 4. Remote leaf nodes
  for (const leaf of leafPeers) {
    addNode(leaf.id, { name: leaf.name, ip: leaf.ip, port: leaf.port, networkType: leaf.networkType || categorizeNetwork(leaf.ip || '127.0.0.1') }, 'LEAF', 'leaf connected', false, () => onEnterNode?.(leaf.id));
  }

  // 5. Remote relay peers that aren't the entry (additional relays in the network)
  for (const relay of relayPeers) {
    if (entryRelay && relay.id === entryRelay.id) continue;
    addNode(relay.id, { name: relay.name, ip: relay.ip, port: relay.port, networkType: relay.networkType || categorizeNetwork(relay.ip || '127.0.0.1') }, 'RELAY', 'relay / upstream', false, () => onEnterNode?.(relay.id));
  }

  // ── Determine connection status for each saved URL ──
  function connStatus(url: string): { status: 'connected' | 'connecting' | 'failed' | 'saved'; active: boolean } {
    if (url === upstreamUrl) return { status: 'connected', active: true };
    if (url === upstreamConnectingUrl) return { status: 'connecting', active: false };
    if (url === upstreamErrorUrl) return { status: 'failed', active: false };
    return { status: 'saved', active: false };
  }

  // ── Render ──
  return (
    <div className="space-y-5 px-1 pb-4">
      {/* ── Topology ── */}
      {topo.length > 0 ? (
        <div className="space-y-0">
          {topo.map((entry, i) =>
            entry.kind === 'node'
              ? <NodeCard key={`n-${i}`} {...entry.data} />
              : <LinkLine key={`l-${i}`} label={entry.label} muted={entry.muted} />
          )}
        </div>
      ) : (
        <div className="border rounded-lg border-gray-700/60 bg-gray-800/20 px-3.5 py-4 text-sm text-gray-500">
          disconnected / loading: 没有真实后端节点数据，不显示伪造卡片。
        </div>
      )}

      {/* ── Browser viewers (linked into existing topology vs listed separately) ── */}
      {viewers.length > 0 && (
        <div className="space-y-1">
          <div className="text-[9px] text-gray-600 font-medium uppercase tracking-wider px-0.5">浏览器接入</div>
          {viewers.map((viewer) => (
            <LinkLine key={`sep-${viewer.id}`} label="view entry" muted />
          ))}
          {viewers.map((viewer) => (
            <div key={viewer.id}>
              <NodeCard
                peer={{ name: viewer.name || 'Browser View', ip: viewer.ip ? `via ${viewer.ip}` : undefined, networkType: viewer.networkType }}
                kind="VIEW"
              />
            </div>
          ))}
        </div>
      )}

      {/* ── Error banner ── */}
      {upstreamError && (
        <div className="flex items-start gap-2 border border-red-800/40 bg-red-900/10 rounded px-3 py-2 text-[10px] text-red-400 leading-relaxed">
          <span className="shrink-0 mt-px">⚠</span>
          <span>{upstreamError}</span>
        </div>
      )}

      {/* ── Connection management ── */}
      <div className="border-t border-gray-800 pt-3">
        <h3 className="text-[9px] font-bold text-gray-600 tracking-wider uppercase mb-2 px-1">
          连接管理
          {upstreamUrl && (
            <span className="ml-2 text-emerald-500 font-normal">
              ● {connections.find(c => c.url === upstreamUrl)?.name || upstreamUrl}
            </span>
          )}
        </h3>

        <div className="space-y-1.5">
          {connections.filter(c => !isLocalUrl(c.url)).length === 0 && !upstreamUrl ? (
            <div className="px-2.5 py-2 text-[10px] text-gray-600">
              暂无连接。输入远程 relay 地址保存并连接。
            </div>
          ) : (
            connections.filter(c => !isLocalUrl(c.url)).map((conn) => {
              const { status, active } = connStatus(conn.url);
              return (
                <ConnectionCard
                  key={conn.id}
                  url={conn.url}
                  status={status}
                  connType={conn.networkType === 'lan' ? 'lan leaf' : 'upstream'}
                  active={active}
                  onConnect={status === 'saved' ? () => onConnectUpstream?.(conn.url) : undefined}
                  onDisconnect={active ? onDisconnectUpstream : undefined}
                  onDelete={status === 'saved' ? () => onDeleteConnection(conn.id) : undefined}
                />
              );
            })
          )}

          {/* ── Add connection form ── */}
          <form onSubmit={onAddConnection} className="flex gap-1 pt-1">
            <input
              type="text"
              value={newConnUrl}
              onChange={e => onNewConnUrlChange(e.target.value)}
              placeholder="ws://&lt;ip&gt;:8080"
              className="flex-1 bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[10px] text-gray-200 outline-none focus:border-purple-500"
            />
            <div className="flex gap-1 shrink-0">
              {onConnectUpstream && newConnUrl.trim() && (
                <button type="button"
                  onClick={() => onConnectUpstream(newConnUrl.trim())}
                  className="px-2 py-1 bg-purple-700 hover:bg-purple-600 text-white text-[9px] rounded border border-purple-600"
                >连接</button>
              )}
              <button type="submit"
                className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-[9px] rounded border border-gray-700"
              >保存</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
