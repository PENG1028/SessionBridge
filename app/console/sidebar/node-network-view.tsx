'use client';

import { Cpu, Monitor, Server, X } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────

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

interface TopoLink {
  source: string;
  target: string;
  type: 'agent' | 'relay';
}

interface ConnectionItem {
  id: string;
  name: string;
  url: string;
  networkType: string;
}

interface NodeNetworkViewProps {
  peers: PeerInfo[];
  links?: TopoLink[];
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
  isLocalPage?: boolean;
  browserId?: string;
}

// ─── Helpers ──────────────────────────────────────────────────

function networkBg(type?: string) {
  switch (type) {
    case 'wan': return 'border-yellow-700/30 bg-yellow-900/10 text-yellow-400';
    case 'lan': return 'border-green-700/30 bg-green-900/10 text-green-400';
    case 'loopback': return 'border-gray-700 bg-gray-800 text-gray-500';
    default: return 'border-gray-700 bg-gray-800 text-gray-500';
  }
}

function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '0.0.0.0';
  } catch { return true; }
}

function categorizeNetwork(ip: string): string {
  if (ip === '127.0.0.1' || ip === 'localhost' || ip === '::1') return 'loopback';
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return 'lan';
  if (ip.startsWith('172.')) {
    const seg = parseInt(ip.split('.')[1] || '0', 10);
    if (seg >= 16 && seg <= 31) return 'lan';
  }
  return 'wan';
}

// ─── Component ───────────────────────────────────────────────

export function NodeNetworkView({
  peers, links, wsUrl, connections,
  onDeleteConnection,
  newConnUrl, onNewConnUrlChange, onAddConnection,
  onEnterNode, upstreamUrl, onConnectUpstream, onDisconnectUpstream,
  isLocalPage, browserId,
}: NodeNetworkViewProps) {

  // ── LOCAL card: reported by the server; wsUrl is only the access path. ──
  const wsHost = (() => { try { return new URL(wsUrl).hostname; } catch { return '127.0.0.1'; } })();
  const isLocalAccess = wsHost === '127.0.0.1' || wsHost === 'localhost' || wsHost === '0.0.0.0';
  const localNode = peers.find(p => p.id === '__local__' || p.isLocal);
  const localName = localNode?.name || (isLocalPage ? '本机' : wsHost);
  const localIp = localNode?.ip || wsHost;
  const localPort = localNode?.port || 8080;
  const localNetworkType = localNode?.networkType || categorizeNetwork(localIp);
  const localRole = localNode?.role || 'leaf';

  // ── Other nodes: exclude ALL loopback agents (they are the relay's own self) ──
  const remotePeers = peers.filter(p => p.id !== '__local__' && !p.isLocal && !(p.type === 'agent' && p.networkType === 'loopback'));

  const relayNodes = remotePeers.filter(p =>
    p.type === 'agent' && (p.role === 'relay' || p.hasPublicAccess)
  );
  const leafNodes = remotePeers.filter(p =>
    p.type === 'agent' && p.role !== 'relay' && !p.hasPublicAccess
  );

  // ── Viewers (browser connections from non-local IP) ──
  const viewers = peers.filter(p => p.type === 'browser' && p.networkType !== 'loopback'
    && p.id !== browserId);

  // ── Topology links ──
  function childrenOf(relayId: string): PeerInfo[] {
    if (!links) return [];
    const targetIds = links.filter(l => l.source === relayId).map(l => l.target);
    return leafNodes.filter(p => targetIds.includes(p.id));
  }
  function relayOf(leafId: string): PeerInfo | undefined {
    if (!links) return undefined;
    const link = links.find(l => l.target === leafId && l.type === 'agent');
    if (!link) return undefined;
    return relayNodes.find(r => r.id === link.source);
  }

  const isUpstreamConnected = upstreamUrl && !isLocalUrl(upstreamUrl) && connections.some(c => c.url === upstreamUrl);

  // ── Card component ──
  function NodeCard({
    icon: Icon,
    name,
    ipPort,
    labels,
    networkType,
    isRelay,
    onClick,
  }: {
    icon: typeof Cpu;
    name: string;
    ipPort?: string;
    labels: { text: string; color: string }[];
    networkType?: string;
    isRelay?: boolean;
    onClick?: () => void;
  }) {
    return (
      <div
        className={`border rounded-lg overflow-hidden transition-colors ${
          onClick ? 'cursor-pointer hover:border-purple-600/50' : ''
        } ${isRelay ? 'border-amber-700/40 bg-amber-900/[0.06]' : 'border-gray-700/60'}`}
        onClick={onClick}
      >
        <div className={`px-3.5 py-2.5 flex items-center gap-2.5 ${
          isRelay ? 'bg-amber-900/15' : 'bg-gray-800/30'
        }`}>
          <Icon className={`w-4 h-4 shrink-0 ${
            isRelay ? 'text-amber-400' : 'text-purple-400'
          }`} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-100 truncate">{name}</div>
            {ipPort && <div className="text-[10px] text-gray-500 font-mono">{ipPort}</div>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {labels.map((l, i) => (
              <span key={i} className={`text-[8px] px-1.5 py-0.5 rounded font-mono border shrink-0 ${l.color}`}>
                {l.text}
              </span>
            ))}
            {onClick && (
              <span className="text-[9px] px-2 py-0.5 rounded bg-purple-700/30 text-purple-300 border border-purple-700/40 shrink-0">
                Enter
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-1 pb-4">

      {/* ── LOCAL card ── */}
      {localNode && (
      <NodeCard
        icon={Cpu}
        name={localName}
        ipPort={`${localIp}:${localPort}`}
        labels={[
          { text: localNetworkType.toUpperCase(), color: networkBg(localNetworkType) },
          ...(localRole === 'relay'
            ? [{ text: 'RELAY', color: 'text-amber-400 border-amber-700/30 bg-amber-900/30' }]
            : [{ text: 'LEAF', color: 'text-gray-500 border-gray-700 bg-gray-800' }]),
        ]}
        networkType={localNetworkType}
        isRelay={localRole === 'relay'}
        onClick={() => onEnterNode?.('__local__')}
      />
      )}

      {/* ── Peer topology ── */}
      {relayNodes.length === 0 && leafNodes.length === 0 && (
        <div className="text-[10px] text-gray-700 italic text-center py-2">
          {!isLocalAccess
            ? '此 relay 下无其他节点。连接设备后拓扑会显示在这里。'
            : '无其他节点。其他设备连接到此 relay 后会显示在这里。'}
        </div>
      )}

      {relayNodes.length > 0 || leafNodes.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[9px] text-gray-600 font-medium uppercase tracking-wider px-0.5">节点</div>

          {relayNodes.map(r => {
            const children = childrenOf(r.id);
            const directLeaves = leafNodes.filter(l => !relayOf(l.id));
            return (
              <div key={r.id}>
                <NodeCard
                  icon={Server}
                  name={r.name}
                  ipPort={r.ip ? `${r.ip}:8080` : undefined}
                  labels={[
                    { text: 'RELAY', color: 'text-amber-400 border-amber-700/30 bg-amber-900/30' },
                    ...(r.networkType ? [{ text: r.networkType.toUpperCase(), color: networkBg(r.networkType) }] : []),
                  ]}
                  isRelay
                  onClick={() => onEnterNode?.(r.id)}
                />
                {children.length > 0 && (
                  <div className="ml-3 mt-0.5 space-y-0.5 border-l-2 border-amber-800/20 pl-3">
                    {children.map(l => (
                      <div key={l.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-gray-900/40 text-xs text-gray-300 cursor-pointer group" onClick={() => onEnterNode?.(l.id)}>
                        <span className="text-[8px] text-amber-600/30 shrink-0 font-mono">├─</span>
                        <Cpu className="w-2.5 h-2.5 text-gray-500 shrink-0" />
                        <span className="truncate flex-1">{l.name}</span>
                        {l.networkType && (
                          <span className={`text-[7px] px-1 py-0.5 rounded font-mono border ${networkBg(l.networkType)}`}>{l.networkType.toUpperCase()}</span>
                        )}
                        <span className="text-[8px] text-gray-600 ml-1">通过 {r.name} 中继</span>
                        <span className="text-[7px] text-purple-500/60 group-hover:text-purple-400 ml-auto">Enter</span>
                      </div>
                    ))}
                  </div>
                )}
                {directLeaves.length > 0 && (
                  <div className="ml-3 mt-0.5 space-y-0.5 border-l-2 border-gray-700/20 pl-3">
                    {directLeaves.map(l => (
                      <div key={l.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-gray-900/40 text-xs text-gray-400 cursor-pointer group" onClick={() => onEnterNode?.(l.id)}>
                        <span className="text-[8px] text-gray-600/30 shrink-0 font-mono">├─</span>
                        <Cpu className="w-2.5 h-2.5 text-gray-600 shrink-0" />
                        <span className="truncate flex-1">{l.name}</span>
                        {l.networkType && (
                          <span className={`text-[7px] px-1 py-0.5 rounded font-mono border ${networkBg(l.networkType)}`}>{l.networkType.toUpperCase()}</span>
                        )}
                        <span className="text-[7px] text-purple-500/60 group-hover:text-purple-400 ml-auto">Enter</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {relayNodes.length === 0 && leafNodes.length > 0 && (
            <div className="ml-2 space-y-0.5 pl-2">
              {leafNodes.map(l => (
                <div key={l.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-gray-900/40 text-xs text-gray-300 cursor-pointer group" onClick={() => onEnterNode?.(l.id)}>
                  <Cpu className="w-2.5 h-2.5 text-gray-500 shrink-0" />
                  <span className="truncate flex-1">{l.name}</span>
                  {l.networkType && (
                    <span className={`text-[7px] px-1 py-0.5 rounded font-mono border ${networkBg(l.networkType)}`}>{l.networkType.toUpperCase()}</span>
                  )}
                  <span className="text-[7px] text-purple-500/60 group-hover:text-purple-400 ml-auto">Enter</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* ── VIEW cards ── */}
      {viewers.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[9px] text-gray-600 font-medium uppercase tracking-wider px-0.5">浏览器接入</div>
          {viewers.map(v => (
            <div key={v.id} className="border border-gray-700/40 bg-gray-900/20 rounded-lg px-3.5 py-2.5 opacity-60">
              <div className="flex items-center gap-2 text-[10px] text-gray-500 mb-0.5">
                <Monitor className="w-3 h-3 text-gray-500" />
                <span className="font-medium text-gray-500">VIEW</span>
              </div>
              <div className="text-xs text-gray-400 font-mono truncate">
                来源: {v.ip || '?'}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                {v.networkType && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded border ${networkBg(v.networkType)}`}>
                    {v.networkType.toUpperCase()}
                  </span>
                )}
                <span className="text-[9px] text-emerald-600">● 已连接</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 上游连接 ── */}
      <div className="border-t border-gray-800 pt-3">
        <h3 className="text-[9px] font-bold text-gray-600 tracking-wider uppercase mb-2 px-1">
          上游连接
          {isUpstreamConnected && (
            <span className="ml-2 text-amber-500 font-normal">
              ● {connections.find(c => c.url === upstreamUrl)?.name || upstreamUrl}
            </span>
          )}
        </h3>
        <div className="space-y-0.5">
          {connections.filter(c => !isLocalUrl(c.url)).map((conn: ConnectionItem) => (
            <div key={conn.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-gray-900/40 text-xs">
              <span className="text-gray-300 truncate min-w-0 flex-1">{conn.url}</span>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {conn.url === upstreamUrl ? (
                  <button onClick={onDisconnectUpstream}
                    className="text-[8px] px-1.5 py-0.5 bg-red-800/40 hover:bg-red-700/50 text-red-400 rounded border border-red-800/40">断开</button>
                ) : (
                  onConnectUpstream && (
                    <button onClick={() => onConnectUpstream(conn.url)}
                      className="text-[8px] px-1.5 py-0.5 bg-gray-700/40 hover:bg-amber-700/50 text-gray-400 hover:text-amber-200 rounded">连接上游</button>
                  )
                )}
                {conn.id !== 'local' && (
                  <button onClick={() => onDeleteConnection(conn.id)} className="text-gray-600 hover:text-red-400">
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
          <form onSubmit={onAddConnection} className="flex gap-1 pt-1">
            <input type="text" value={newConnUrl} onChange={e => onNewConnUrlChange(e.target.value)}
              placeholder="ws://&lt;ip&gt;:8080"
              className="flex-1 bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[10px] text-gray-200 outline-none focus:border-purple-500"
            />
            <button type="submit" className="px-2 py-1 bg-purple-700 hover:bg-purple-600 text-white text-[9px] rounded border border-purple-600 shrink-0">
              + 添加
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
