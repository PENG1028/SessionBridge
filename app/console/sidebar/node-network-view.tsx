'use client';

import { Cpu, Globe, Network, Wifi, Monitor, Server, X } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────

interface PeerInfo {
  id: string;
  name: string;
  ip?: string;
  type: 'agent' | 'browser';
  role?: 'relay' | 'leaf' | 'view';
  networkType?: 'loopback' | 'lan' | 'wan' | 'unknown';
  hasPublicAccess?: boolean;
  connectedAt?: number;
}

interface TopoLink {
  source: string;
  target: string;
  type: 'agent' | 'view' | 'relay';
}

interface NodeNetworkViewProps {
  peers: PeerInfo[];
  links?: TopoLink[];
  wsUrl: string;
  connections: { id: string; name: string; url: string; networkType: string }[];
  onConnect: (url: string) => void;
  onDeleteConnection: (id: string) => void;
  newConnUrl: string;
  onNewConnUrlChange: (url: string) => void;
  onAddConnection: (e: React.FormEvent) => void;
  onEnterNode?: (nodeId: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────

function networkColor(type?: string) {
  switch (type) {
    case 'wan': return 'border-yellow-700/30 bg-yellow-900/30 text-yellow-400';
    case 'lan': return 'border-green-700/30 bg-green-900/30 text-green-400';
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

// ─── Component ───────────────────────────────────────────────

export function NodeNetworkView({
  peers, links, wsUrl, connections,
  onConnect, onDeleteConnection,
  newConnUrl, onNewConnUrlChange, onAddConnection,
  onEnterNode,
}: NodeNetworkViewProps) {

  const localAccess = isLocalUrl(wsUrl);

  // Filter out local agent from peers for topology (hardcoded LOCAL entry handles it)
  const localAgent = peers.find(p => p.type === 'agent' && p.networkType === 'loopback');
  const remotePeers = peers.filter(p => !(p.type === 'agent' && p.networkType === 'loopback'));
  const peerIds = new Set(peers.map(p => p.id));

  // Separate remote peers by role (local agent already excluded)
  const relayNodes = remotePeers.filter(p =>
    p.type === 'agent' && (p.role === 'relay' || p.hasPublicAccess)
  );
  const leafNodes = remotePeers.filter(p =>
    p.type === 'agent' && p.role !== 'relay' && !p.hasPublicAccess
  );
  const browserViews = remotePeers.filter(p => p.type === 'browser');

  // Build topology: for each relay, find its children
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
  function browsersBehind(relayId: string): PeerInfo[] {
    if (!links) return [];
    const targetIds = links.filter(l => l.source === relayId && l.type === 'view').map(l => l.target);
    return browserViews.filter(p => targetIds.includes(p.id));
  }

  const currentConn = connections.find(c => c.url === wsUrl);

  // Viewer IP from wsUrl
  let viewerIp = '127.0.0.1';
  try { viewerIp = new URL(wsUrl).hostname; } catch {}

  // ── Local: single node view ──
  if (localAccess) {
    return (
      <div className="space-y-5 px-1 pb-4">
        {/* Local node — primary */}
        <div
          className="border border-gray-700/60 rounded-lg overflow-hidden cursor-pointer hover:border-purple-600/50 transition-colors"
          onClick={() => onEnterNode?.('__local__')}
        >
          <div className="bg-gray-800/40 px-3.5 py-2.5 flex items-center gap-2.5">
            <Cpu className="w-4 h-4 text-purple-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-gray-100 truncate">
                {localAgent?.name || '本机'}
              </div>
              <div className="text-[10px] text-gray-500 font-mono">127.0.0.1:8080</div>
            </div>
            <span className="text-[8px] px-1.5 py-0.5 rounded font-mono border border-gray-700 bg-gray-800 text-gray-500 shrink-0">
              LOCAL
            </span>
            <span className="text-[8px] px-1.5 py-0.5 rounded font-mono border border-gray-700 bg-gray-800 text-gray-500 shrink-0">
              LOOPBACK
            </span>
            <span className="text-[9px] px-2 py-0.5 rounded bg-purple-700/30 text-purple-300 border border-purple-700/40 shrink-0">
              Enter
            </span>
          </div>

          {/* Remote peers known to this node — topology tree */}
          {remotePeers.length > 0 && (
            <div className="px-3.5 py-2 border-t border-gray-800/60 space-y-1.5">
              <div className="text-[9px] text-gray-600 font-medium uppercase tracking-wider">网络拓扑</div>
              {relayNodes.map(r => {
                const children = childrenOf(r.id);
                const browsers = browsersBehind(r.id);
                const directLeaves = leafNodes.filter(l => !relayOf(l.id));
                return (
                  <div key={r.id}>
                    <div
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-amber-800/30 bg-amber-900/10 text-xs cursor-pointer hover:border-purple-600/50 transition-colors"
                      onClick={() => onEnterNode?.(r.id)}
                    >
                      <Server className="w-3 h-3 text-amber-400 shrink-0" />
                      <span className="truncate flex-1 text-amber-200">{r.name}</span>
                      <span className="text-[8px] text-amber-400/70 font-mono">{r.ip || '?'}:8080</span>
                      <span className="text-[7px] px-1 py-0.5 rounded font-mono border border-amber-700/30 bg-amber-900/30 text-amber-400">RELAY</span>
                      <span className={`text-[7px] px-1 py-0.5 rounded font-mono border ${networkColor(r.networkType)}`}>{r.networkType?.toUpperCase()}</span>
                      <span className="text-[8px] px-1.5 py-0.5 rounded bg-purple-700/20 text-purple-400 border border-purple-700/30">Enter</span>
                    </div>
                    {children.length > 0 && (
                      <div className="ml-2 mt-0.5 space-y-0.5 border-l-2 border-amber-800/20 pl-3">
                        {children.map(l => (
                          <div key={l.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-gray-900/40 text-xs text-gray-300 cursor-pointer" onClick={() => onEnterNode?.(l.id)}>
                            <span className="text-[8px] text-amber-600/40 shrink-0 font-mono">├─</span>
                            <Cpu className="w-2.5 h-2.5 text-gray-500 shrink-0" />
                            <span className="truncate flex-1">{l.name}</span>
                            <span className={`text-[7px] px-1 py-0.5 rounded font-mono border ${networkColor(l.networkType)}`}>{l.networkType?.toUpperCase()}</span>
                            <span className="text-[7px] text-purple-500/60 hover:text-purple-400 ml-1">Enter</span>
                          </div>
                        ))}
                        {browsers.length > 0 && browsers.map(b => (
                          <div key={b.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-gray-500 italic">
                            <span className="text-[8px] text-gray-600/40 shrink-0 font-mono">├─</span>
                            <Monitor className="w-2.5 h-2.5 shrink-0" />
                            <span className="truncate">{b.name}</span>
                            <span className="text-[7px] px-1 py-0.5 rounded font-mono border border-gray-700 bg-gray-800 text-gray-500">VIEW</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {directLeaves.length > 0 && r === relayNodes[relayNodes.length - 1] && (
                      <div className="ml-2 mt-0.5 space-y-0.5 border-l-2 border-gray-700/20 pl-3">
                        {directLeaves.map(l => (
                          <div key={l.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-gray-900/40 text-xs text-gray-400 cursor-pointer" onClick={() => onEnterNode?.(l.id)}>
                            <span className="text-[8px] text-gray-600/40 shrink-0 font-mono">├─</span>
                            <Cpu className="w-2.5 h-2.5 text-gray-600 shrink-0" />
                            <span className="truncate flex-1">{l.name}</span>
                            <span className="text-[7px] px-1 py-0.5 rounded font-mono border border-gray-700 bg-gray-800 text-gray-500">DIRECT</span>
                            <span className={`text-[7px] px-1 py-0.5 rounded font-mono border ${networkColor(l.networkType)}`}>{l.networkType?.toUpperCase()}</span>
                            <span className="text-[7px] text-purple-500/60 hover:text-purple-400 ml-1">Enter</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {relayNodes.length === 0 && leafNodes.length > 0 && (
                <div className="ml-2 space-y-0.5 pl-3">
                  {leafNodes.map(l => (
                    <div key={l.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-gray-900/40 text-xs text-gray-400 cursor-pointer" onClick={() => onEnterNode?.(l.id)}>
                      <span className="text-[8px] text-gray-600/40 shrink-0 font-mono">├─</span>
                      <Cpu className="w-2.5 h-2.5 text-gray-600 shrink-0" />
                      <span className="truncate flex-1">{l.name}</span>
                      <span className="text-[7px] px-1 py-0.5 rounded font-mono border border-gray-700 bg-gray-800 text-gray-500">LEAF</span>
                      <span className={`text-[7px] px-1 py-0.5 rounded font-mono border ${networkColor(l.networkType)}`}>{l.networkType?.toUpperCase()}</span>
                      <span className="text-[7px] text-purple-500/60 hover:text-purple-400 ml-1">Enter</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {remotePeers.length === 0 && (
            <div className="px-3.5 py-3 text-[10px] text-gray-700 italic">无其他节点。其他设备连接到此 relay 后会显示在这里。</div>
          )}
        </div>

        {/* Connections list */}
        <div className="border-t border-gray-800 pt-3">
          <h3 className="text-[9px] font-bold text-gray-600 tracking-wider uppercase mb-2 px-1">
            已保存连接 ({connections.length})
          </h3>
          <div className="space-y-0.5">
            {connections.map((conn: any) => (
              <div key={conn.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-gray-900/40 text-xs">
                <span className="text-gray-300 truncate min-w-0 flex-1">{conn.url}</span>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  {conn.url === wsUrl ? (
                    <span className="text-[8px] text-emerald-500">已连</span>
                  ) : (
                    <button onClick={() => onConnect(conn.url)}
                      className="text-[8px] px-1.5 py-0.5 bg-purple-700/50 hover:bg-purple-600 text-white rounded">连接</button>
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

  // ── Remote access: show VIEW + node topology ──

  // Detect network type of the viewer
  const viewerNetworkType =
    viewerIp === '127.0.0.1' || viewerIp === 'localhost' ? 'loopback'
    : viewerIp.startsWith('10.') || viewerIp.startsWith('192.168.') ? 'lan'
    : viewerIp.startsWith('172.') && parseInt(viewerIp.split('.')[1] || '0') >= 16 && parseInt(viewerIp.split('.')[1] || '0') <= 31 ? 'lan'
    : 'wan';

  return (
    <div className="space-y-5 px-1 pb-4">
      {/* VIEW indicator */}
      <div className="border border-gray-700/60 bg-gray-900/40 rounded-lg px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-[10px] text-gray-500 mb-1">
          <Monitor className="w-3 h-3" />
          <span className="uppercase tracking-wider font-semibold text-gray-600">当前接入</span>
          <span className="text-[9px] bg-gray-800 text-gray-600 px-1.5 py-0.5 rounded font-mono">VIEW</span>
        </div>
        <div className="text-xs text-gray-300 font-mono truncate">
          {viewerIp}
          <span className="text-gray-600 mx-1.5">→</span>
          <span className="text-purple-400">{wsUrl.replace('ws://', '').replace('wss://', '')}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <span className={`text-[9px] px-1.5 py-0.5 rounded border ${networkColor(viewerNetworkType)}`}>
            {viewerNetworkType.toUpperCase()}
          </span>
          <span className="text-[9px] text-emerald-500">● 已连接</span>
        </div>
      </div>

      {/* Nodes behind this relay */}
      <div className="space-y-2">
        {relayNodes.map(relay => (
          <div key={relay.id} className="border border-amber-700/40 bg-amber-900/10 rounded-lg overflow-hidden">
            <div
              className="bg-amber-900/20 border-b border-amber-800/30 px-3.5 py-2 flex items-center gap-2.5 cursor-pointer hover:bg-amber-900/30 transition-colors"
              onClick={() => onEnterNode?.(relay.id)}
            >
              <Server className="w-4 h-4 text-amber-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-amber-200 truncate">{relay.name}</div>
                <div className="text-[10px] text-amber-400/70 font-mono truncate">{relay.ip || '?'}:8080</div>
              </div>
              <span className="text-[8px] px-1.5 py-0.5 rounded font-mono border border-amber-600/30 bg-amber-900/30 text-amber-400">RELAY</span>
              <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono border ${networkColor(relay.networkType)}`}>{relay.networkType?.toUpperCase()}</span>
              <span className="text-[8px] px-1.5 py-0.5 rounded bg-purple-700/20 text-purple-400 border border-purple-700/30">Enter</span>
            </div>
            <div className="px-3 py-2 space-y-1">
              {(() => {
                const children = childrenOf(relay.id);
                const browsers = browsersBehind(relay.id);
                if (children.length === 0 && browsers.length === 0) {
                  return <div className="text-[10px] text-gray-700 italic px-2 py-1">没有子节点连接到此 relay</div>;
                }
                return (
                  <>
                    {children.map(leaf => (
                      <div key={leaf.id} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md bg-gray-900/40 border border-gray-800/60 text-xs text-gray-300 cursor-pointer hover:border-purple-600/50 transition-colors" onClick={() => onEnterNode?.(leaf.id)}>
                        <Cpu className="w-3 h-3 text-gray-500 shrink-0" />
                        <span className="truncate flex-1">{leaf.name}</span>
                        <span className="text-[8px] px-1.5 py-0.5 rounded font-mono border border-gray-700 bg-gray-800 text-gray-500 shrink-0">LEAF</span>
                        <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono border ${networkColor(leaf.networkType)}`}>{leaf.networkType?.toUpperCase()}</span>
                        <span className="text-[9px] text-gray-600">通过 {relay.name} 中继</span>
                        <span className="text-[7px] text-purple-500/60 hover:text-purple-400 ml-1">Enter</span>
                      </div>
                    ))}
                    {browsers.map(b => (
                      <div key={b.id} className="flex items-center gap-2.5 px-2.5 py-1 rounded-md text-xs text-gray-500 italic">
                        <Monitor className="w-3 h-3 shrink-0" />
                        <span className="truncate flex-1">{b.name}</span>
                        <span className="text-[8px] px-1.5 py-0.5 rounded font-mono border border-gray-700 bg-gray-800 text-gray-500 shrink-0">VIEW</span>
                        <span className="text-[9px] text-gray-600">通过 {relay.name} 观察</span>
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          </div>
        ))}

        {relayNodes.length === 0 && leafNodes.length === 0 && browserViews.length === 0 && (
          <div className="text-[10px] text-gray-700 italic px-2 py-3 text-center">网络中无其他节点</div>
        )}
        {relayNodes.length === 0 && (leafNodes.length > 0 || browserViews.length > 0) && (
          <div className="border border-gray-700/40 rounded-lg overflow-hidden">
            <div className="px-3 py-2 space-y-1">
              <div className="text-[9px] text-gray-600 font-medium uppercase tracking-wider px-1">直连节点</div>
              {leafNodes.map(l => (
                <div key={l.id} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md bg-gray-900/40 border border-gray-800/60 text-xs text-gray-300 cursor-pointer hover:border-purple-600/50 transition-colors" onClick={() => onEnterNode?.(l.id)}>
                  <Cpu className="w-3 h-3 text-gray-500 shrink-0" />
                  <span className="truncate flex-1">{l.name}</span>
                  <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono border ${networkColor(l.networkType)}`}>{l.networkType?.toUpperCase()}</span>
                  <span className="text-[7px] text-purple-500/60 hover:text-purple-400 ml-1">Enter</span>
                </div>
              ))}
              {browserViews.map(b => (
                <div key={b.id} className="flex items-center gap-2.5 px-2.5 py-1 rounded-md text-xs text-gray-500 italic">
                  <Monitor className="w-3 h-3 shrink-0" />
                  <span className="truncate flex-1">{b.name}</span>
                  <span className="text-[8px] px-1.5 py-0.5 rounded font-mono border border-gray-700 bg-gray-800 text-gray-500">VIEW</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Connections list — compact */}
      <div className="border-t border-gray-800 pt-3">
        <h3 className="text-[9px] font-bold text-gray-600 tracking-wider uppercase mb-2 px-1">已保存连接 ({connections.length})</h3>
        <div className="space-y-0.5">
          {connections.map((conn: any) => (
            <div key={conn.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-gray-900/40 text-xs">
              <span className="text-gray-300 truncate min-w-0 flex-1">{conn.url}</span>
              <div className="flex items-center gap-1.5 shrink-0 ml-2">
                {conn.url === wsUrl ? (
                  <span className="text-[8px] text-emerald-500">已连</span>
                ) : (
                  <button onClick={() => onConnect(conn.url)} className="text-[8px] px-1.5 py-0.5 bg-purple-700/50 hover:bg-purple-600 text-white rounded">连接</button>
                )}
                {conn.id !== 'local' && (
                  <button onClick={() => onDeleteConnection(conn.id)} className="text-gray-600 hover:text-red-400"><X className="w-2.5 h-2.5" /></button>
                )}
              </div>
            </div>
          ))}
          <form onSubmit={onAddConnection} className="flex gap-1 pt-1">
            <input type="text" value={newConnUrl} onChange={e => onNewConnUrlChange(e.target.value)}
              placeholder="ws://&lt;ip&gt;:8080"
              className="flex-1 bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[10px] text-gray-200 outline-none focus:border-purple-500"
            />
            <button type="submit" className="px-2 py-1 bg-purple-700 hover:bg-purple-600 text-white text-[9px] rounded border border-purple-600 shrink-0">+ 添加</button>
          </form>
        </div>
      </div>
    </div>
  );
}
