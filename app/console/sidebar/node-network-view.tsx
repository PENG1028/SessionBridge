'use client';

import { Cpu, Monitor, Server, X } from 'lucide-react';

// ─── Types ───

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
  latency?: number;
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

function DirectionBadge({ direction }: { direction: string }) {
  const colors: Record<string, string> = {
    '被访问': 'text-gray-400 border-gray-700/50 bg-gray-800/50',
    '被连接': 'text-blue-400 border-blue-700/30 bg-blue-900/20',
    '主动连接': 'text-purple-400 border-purple-700/30 bg-purple-900/20',
    '保存': 'text-gray-500 border-gray-700 bg-gray-800',
  };
  return <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono border ${colors[direction] || colors['保存']}`}>{direction}</span>;
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

function LatencyBadge({ latency }: { latency: string }) {
  return <span className="text-[8px] px-1.5 py-0.5 rounded font-mono border border-gray-700/40 bg-gray-800/40 text-gray-400">{latency}</span>;
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

function latencyLabel(ms?: number): string {
  if (ms === undefined || ms === null) return '--';
  return `${ms}ms`;
}

// ─── Node Card ───

function NodeCard({ peer, kind, onEnter, wsHost }: {
  peer: { name: string; ip?: string; port?: number; networkType?: string };
  kind: NodeKind;
  onEnter?: () => void;
  wsHost?: string;
}) {
  const Icon = kind === 'VIEW' ? Monitor : kind === 'RELAY' ? Server : Cpu;
  const clickable = kind !== 'VIEW' && !!onEnter;

  const hasSplit = kind === 'RELAY' && wsHost && peer.ip && wsHost !== peer.ip && wsHost !== '127.0.0.1' && wsHost !== 'localhost';
  const addressLine = peer.ip ? `${peer.ip}:${peer.port || 8080}` : undefined;
  const publicLine = hasSplit ? `${wsHost}:${peer.port || 8080}` : undefined;

  return (
    <div
      className={`border rounded-lg overflow-hidden transition-colors ${clickable ? 'cursor-pointer hover:border-purple-600/50' : 'cursor-default'} ${nodeTheme(kind)}`}
      onClick={clickable ? onEnter : undefined}
    >
      <div className="px-3.5 py-2.5 flex items-center gap-2.5 bg-gray-800/30">
        <Icon className={`w-4 h-4 shrink-0 ${iconColor(kind)}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-100 truncate">{peer.name}</div>
          {hasSplit && publicLine && (
            <div className="text-[10px] text-amber-500/80 font-mono truncate">public {publicLine}</div>
          )}
          {addressLine && (
            <div className="text-[10px] text-gray-500 font-mono truncate">
              {hasSplit ? `internal ${addressLine}` : addressLine}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
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

// ─── Link Line with optional latency badge ───

function LinkLine({ label, latency, muted }: { label: string; latency?: string; muted?: boolean }) {
  return (
    <div className={`ml-5 -my-1 border-l-2 pl-4 py-2 flex items-center gap-2 ${muted ? 'border-gray-700/50' : 'border-amber-700/30'}`}>
      <div className={`text-[9px] font-mono ${muted ? 'text-gray-500' : 'text-amber-600/70'}`}>{label}</div>
      {latency && latency !== '--' && (
        <span className="text-[8px] px-1.5 py-0.5 rounded font-mono bg-gray-800 border border-gray-700 text-gray-400">{latency}</span>
      )}
    </div>
  );
}

// ─── Connection Card (redesigned) ───

function ConnectionCard({
  name, url, direction, connType, status, active, latency, isPeer,
  onConnect, onDisconnect, onDelete,
}: {
  name: string;
  url?: string;
  direction: string;
  connType: string;
  status: 'connected' | 'connecting' | 'failed' | 'saved';
  active: boolean;
  latency: string;
  isPeer: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onDelete?: () => void;
}) {
  const displayName = name || url?.replace(/^wss?:\/\//, '') || '';
  return (
    <div className={`border rounded-md bg-gray-900/20 overflow-hidden ${active ? 'border-emerald-700/40' : 'border-gray-700/60'}`}>
      <div className="px-2.5 py-1.5 text-xs">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1 font-mono text-gray-300 truncate" title={url || name}>
            {displayName}
          </div>
          {active && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="active" />}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <DirectionBadge direction={direction} />
          <TypeBadge connType={connType} />
          <LatencyBadge latency={latency} />
          <StatusBadge status={status} />
        </div>
      </div>
      {!isPeer && (
        <div className="flex justify-end gap-1 px-2.5 pb-1.5">
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
          {!active && onDelete && (
            <button onClick={onDelete} className="text-gray-600 hover:text-red-400 px-0.5">
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      )}
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

  const localPeer = peers.find(p => p.id === '__local__' || p.isLocal);
  const localName = localPeer?.name || (isLocalPage ? '本机' : wsHost);
  const localIp = localPeer?.ip || wsHost;
  const localPort = localPeer?.port || 8080;

  const remotePeers = peers.filter(p => p.id !== '__local__' && !p.isLocal && !(p.type === 'agent' && p.networkType === 'loopback'));
  const relayPeers = remotePeers.filter(p => p.type === 'agent' && p.role === 'relay');
  const leafPeers = remotePeers.filter(p => p.type === 'agent' && p.role !== 'relay');
  const viewers = peers.filter(p => p.type === 'browser' && p.networkType !== 'loopback' && p.id !== browserId);

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

  type TopoEntry = {
    kind: 'node';
    data: { peer: { name: string; ip?: string; port?: number; networkType?: string }; kind: NodeKind; onEnter?: () => void; wsHost?: string };
  } | {
    kind: 'link';
    label: string;
    latency?: string;
    muted?: boolean;
  };

  const topo: TopoEntry[] = [];
  const addedIds = new Set<string>();

  function addNode(
    id: string,
    peer: { name: string; ip?: string; port?: number; networkType?: string },
    kind: NodeKind,
    linkLabel?: string, linkLatency?: string, linkMuted?: boolean,
    onEnter?: () => void,
  ) {
    if (addedIds.has(id)) return;
    const passWsHost = kind === 'RELAY' ? wsHost : undefined;
    if (linkLabel && topo.length > 0) {
      topo.push({ kind: 'link', label: linkLabel, latency: linkLatency, muted: linkMuted });
    }
    topo.push({ kind: 'node', data: { peer, kind, onEnter, wsHost: passWsHost } });
    addedIds.add(id);
  }

  // 1. VIEW entry
  if (!isLocalAccess) {
    addNode('__view__', { name: 'Current Browser', ip: wsHost, networkType: 'wan' }, 'VIEW');
  }

  // 2. Entry relay
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
    addNode(entryRelay.id, entryRelay, 'RELAY', linkLabel, undefined, !isLocalAccess && !upstreamPeer, () => onEnterNode?.(entryRelay!.id));
  }

  // 3. Local node (if not already relay)
  if (localPeer && localPeer.role !== 'relay') {
    addNode('__local__', { name: localName, ip: localIp, port: localPort, networkType: localPeer.networkType || categorizeNetwork(localIp) }, 'LOCAL',
      upstreamUrl ? 'connected upstream' : !isLocalAccess ? 'view entry' : undefined, undefined, !isLocalAccess && !upstreamUrl,
      () => onEnterNode?.('__local__'));
  }

  // 4. Leaf nodes
  for (const leaf of leafPeers) {
    const ll = leaf.latency !== undefined ? latencyLabel(leaf.latency) : undefined;
    addNode(leaf.id, { name: leaf.name, ip: leaf.ip, port: leaf.port, networkType: leaf.networkType || categorizeNetwork(leaf.ip || '127.0.0.1') }, 'LEAF',
      'leaf connected', ll, false, () => onEnterNode?.(leaf.id));
  }

  // 5. Additional relays (beyond the entry)
  for (const relay of relayPeers) {
    if (entryRelay && relay.id === entryRelay.id) continue;
    addNode(relay.id, { name: relay.name, ip: relay.ip, port: relay.port, networkType: relay.networkType || categorizeNetwork(relay.ip || '127.0.0.1') }, 'RELAY', 'relay / upstream', undefined, false, () => onEnterNode?.(relay.id));
  }

  // ── Build connection panel entries ──

  type PanelConnection = {
    id: string;
    name: string;
    url?: string;
    direction: string;
    connType: string;
    status: 'connected' | 'connecting' | 'failed' | 'saved';
    active: boolean;
    latency: string;
    isPeer: boolean;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onDelete?: () => void;
  };

  const panelConns: PanelConnection[] = [];

  // 1. Browser viewers → 被访问 / view
  for (const v of viewers) {
    panelConns.push({
      id: `viewer:${v.id}`,
      name: `Browser ${v.ip || v.name}`,
      direction: '被访问',
      connType: 'view',
      status: 'connected',
      active: true,
      latency: latencyLabel(v.latency),
      isPeer: true,
    });
  }

  // 2. Incoming leaf agents → 被连接 / incoming leaf
  for (const leaf of leafPeers) {
    const leafAddr = leaf.ip ? `ws://${leaf.ip}:${leaf.port || 8080}` : leaf.name;
    panelConns.push({
      id: `incoming:${leaf.id}`,
      name: leaf.name || leafAddr,
      url: leafAddr,
      direction: '被连接',
      connType: 'incoming leaf',
      status: 'connected',
      active: true,
      latency: latencyLabel(leaf.latency),
      isPeer: true,
    });
  }

  // 3. Active upstream → 主动连接 / upstream
  if (upstreamUrl && !isLocalUrl(upstreamUrl)) {
    const saved = connections.find(c => c.url === upstreamUrl);
    let upstreamLatency: number | undefined;
    try {
      const uHost = new URL(upstreamUrl).hostname;
      const peerWithLatency = peers.find(p => p.ip === uHost);
      if (peerWithLatency) upstreamLatency = peerWithLatency.latency;
    } catch { /* ignore */ }
    const isConnecting = upstreamUrl === upstreamConnectingUrl;
    const isFailed = upstreamUrl === upstreamErrorUrl && !!upstreamError;
    const connStatus: 'connected' | 'connecting' | 'failed' | 'saved' = isConnecting ? 'connecting' : isFailed ? 'failed' : 'connected';
    panelConns.push({
      id: 'upstream:active',
      name: saved?.name || (() => { try { return new URL(upstreamUrl).hostname; } catch { return upstreamUrl; } })(),
      url: upstreamUrl,
      direction: '主动连接',
      connType: 'upstream',
      status: connStatus,
      active: !isConnecting && !isFailed,
      latency: upstreamLatency ? latencyLabel(upstreamLatency) : '--',
      isPeer: false,
      onDisconnect: onDisconnectUpstream,
    });
  }

  // 4. Saved connections → 保存
  for (const conn of connections) {
    if (isLocalUrl(conn.url)) continue;
    // Skip if this is the active upstream (already shown above)
    if (conn.url === upstreamUrl && !upstreamErrorUrl && upstreamUrl) continue;
    const ct = conn.networkType === 'lan' ? 'lan leaf' : 'upstream';
    panelConns.push({
      id: `saved:${conn.id}`,
      name: conn.name,
      url: conn.url,
      direction: '保存',
      connType: ct,
      status: 'saved',
      active: false,
      latency: '--',
      isPeer: false,
      onConnect: () => onConnectUpstream?.(conn.url),
      onDelete: () => onDeleteConnection(conn.id),
    });
  }

  // Sort: active first, then by direction priority
  const dirOrder = ['被访问', '被连接', '主动连接', '保存'];
  panelConns.sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return dirOrder.indexOf(a.direction) - dirOrder.indexOf(b.direction);
  });

  // ── Render ──
  return (
    <div className="space-y-5 px-1 pb-4">
      {/* ── Topology ── */}
      {topo.length > 0 ? (
        <div className="space-y-0">
          {topo.map((entry, i) =>
            entry.kind === 'node'
              ? <NodeCard key={`n-${i}`} {...entry.data} />
              : <LinkLine key={`l-${i}`} label={entry.label} latency={entry.latency} muted={entry.muted} />
          )}
        </div>
      ) : (
        <div className="border rounded-lg border-gray-700/60 bg-gray-800/20 px-3.5 py-4 text-sm text-gray-500">
          disconnected / loading
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
          {panelConns.some(c => c.active) && (
            <span className="ml-2 text-emerald-500 font-normal text-[9px]">
              ● {panelConns.filter(c => c.active).length} active
            </span>
          )}
        </h3>

        {panelConns.length === 0 ? (
          <div className="px-2.5 py-2 text-[10px] text-gray-600">
            暂无连接。
          </div>
        ) : (
          <div className="space-y-1.5">
            {panelConns.map((pc) => (
              <ConnectionCard key={pc.id} {...pc} />
            ))}
          </div>
        )}

        {/* ── Add connection form ── */}
        <form onSubmit={onAddConnection} className="flex gap-1 pt-2 mt-2 border-t border-gray-800/60">
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
  );
}
