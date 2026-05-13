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
  upstreamConnectingUrl?: string;
  upstreamError?: string;
  upstreamErrorUrl?: string;
  upstreamStatus?: string;
  isLocalPage?: boolean;
  browserId?: string;
}

type CardTone = 'local' | 'relay' | 'leaf' | 'view';

interface TopologyNode {
  id: string;
  icon: typeof Cpu;
  name: string;
  address?: string;
  tone: CardTone;
  labels: { text: string; color: string }[];
  action?: 'Enter' | 'View';
  onClick?: () => void;
}

type TopologyItem =
  | { kind: 'node'; node: TopologyNode }
  | { kind: 'link'; label: string; tone?: 'normal' | 'view' };

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
  } catch {
    return true;
  }
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

function cardTheme(tone: CardTone) {
  if (tone === 'relay') return 'border-amber-700/40 bg-amber-900/[0.06]';
  if (tone === 'leaf') return 'border-blue-700/40 bg-blue-900/[0.05]';
  if (tone === 'view') return 'border-gray-700/60 bg-gray-800/20 opacity-75';
  return 'border-gray-700/60 bg-gray-800/30';
}

function iconColor(tone: CardTone) {
  if (tone === 'relay') return 'text-amber-400';
  if (tone === 'leaf') return 'text-blue-400';
  if (tone === 'view') return 'text-gray-500';
  return 'text-purple-400';
}

function NodeCard({ node }: { node: TopologyNode }) {
  const clickable = !!node.onClick;
  const Icon = node.icon;
  return (
    <div
      className={`border rounded-lg overflow-hidden transition-colors ${clickable ? 'cursor-pointer hover:border-purple-600/50' : 'cursor-default'} ${cardTheme(node.tone)}`}
      onClick={node.onClick}
    >
      <div className="px-3.5 py-2.5 flex items-center gap-2.5 bg-gray-800/30">
        <Icon className={`w-4 h-4 shrink-0 ${iconColor(node.tone)}`} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-100 truncate">{node.name}</div>
          {node.address && <div className="text-[10px] text-gray-500 font-mono">{node.address}</div>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {node.labels.map((label, index) => (
            <span key={index} className={`text-[8px] px-1.5 py-0.5 rounded font-mono border shrink-0 ${label.color}`}>
              {label.text}
            </span>
          ))}
          {node.action && (
            <span className="text-[9px] px-2 py-0.5 rounded bg-purple-700/30 text-purple-300 border border-purple-700/40 shrink-0">
              {node.action}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function LinkLine({ label, tone = 'normal' }: { label: string; tone?: 'normal' | 'view' }) {
  const color = tone === 'view'
    ? 'border-gray-700/50 text-gray-500'
    : 'border-amber-700/30 text-amber-600/70';
  return (
    <div className={`ml-5 -my-1 border-l-2 pl-4 py-2 ${color}`}>
      <div className="text-[9px] font-mono">{label}</div>
    </div>
  );
}

export function NodeNetworkView({
  peers, links, wsUrl, connections,
  onDeleteConnection,
  newConnUrl, onNewConnUrlChange, onAddConnection,
  onEnterNode, upstreamUrl, onConnectUpstream, onDisconnectUpstream,
  upstreamConnectingUrl, upstreamError, upstreamErrorUrl, upstreamStatus,
  isLocalPage, browserId,
}: NodeNetworkViewProps) {
  const wsHost = (() => { try { return new URL(wsUrl).hostname; } catch { return '127.0.0.1'; } })();
  const isLocalAccess = wsHost === '127.0.0.1' || wsHost === 'localhost' || wsHost === '0.0.0.0';
  const localNode = peers.find(p => p.id === '__local__' || p.isLocal);
  const localName = localNode?.name || (isLocalPage ? '本机' : wsHost);
  const localIp = localNode?.ip || wsHost;
  const localPort = localNode?.port || 8080;
  const localNetworkType = localNode?.networkType || categorizeNetwork(localIp);
  const localRole = localNode?.role || 'leaf';

  const remotePeers = peers.filter(p => p.id !== '__local__' && !p.isLocal && !(p.type === 'agent' && p.networkType === 'loopback'));
  const relayNodes = remotePeers.filter(p => p.type === 'agent' && (p.role === 'relay' || p.hasPublicAccess));
  const leafNodes = remotePeers.filter(p => p.type === 'agent' && p.role !== 'relay' && !p.hasPublicAccess);
  const viewers = peers.filter(p => p.type === 'browser' && p.networkType !== 'loopback' && p.id !== browserId);

  const childrenOf = (relayId: string): PeerInfo[] => {
    if (!links) return [];
    const targetIds = links.filter(l => l.source === relayId).map(l => l.target);
    return leafNodes.filter(p => targetIds.includes(p.id));
  };

  const relayOf = (leafId: string): PeerInfo | undefined => {
    if (!links) return undefined;
    const link = links.find(l => l.target === leafId && l.type === 'agent');
    return link ? relayNodes.find(r => r.id === link.source) : undefined;
  };

  const isUpstreamConnected = upstreamUrl && !isLocalUrl(upstreamUrl) && connections.some(c => c.url === upstreamUrl);
  const upstreamNode = (() => {
    if (!isUpstreamConnected || !upstreamUrl) return null;
    try {
      const u = new URL(upstreamUrl);
      const saved = connections.find(c => c.url === upstreamUrl);
      return {
        id: `upstream:${upstreamUrl}`,
        name: saved?.name || u.hostname,
        host: u.hostname,
        port: u.port || '8080',
        networkType: categorizeNetwork(u.hostname),
      };
    } catch {
      return null;
    }
  })();

  const items: TopologyItem[] = [];
  const added = new Set<string>();
  const pushNode = (node: TopologyNode, linkLabel?: string, tone?: 'normal' | 'view') => {
    if (added.has(node.id)) return;
    if (items.length > 0) items.push({ kind: 'link', label: linkLabel || 'connected', tone });
    items.push({ kind: 'node', node });
    added.add(node.id);
  };

  if (!isLocalAccess) {
    pushNode({
      id: 'current-view',
      icon: Monitor,
      name: 'Current Browser',
      address: `via ${wsHost}:8080`,
      tone: 'view',
      labels: [
        { text: 'VIEW', color: 'border-gray-700 bg-gray-800 text-gray-500' },
        { text: 'VIEW', color: 'border-gray-700 bg-gray-800 text-gray-500' },
      ],
      action: 'View',
    });
  }

  if (localNode) {
    pushNode({
      id: '__local__',
      icon: Cpu,
      name: localName,
      address: `${localIp}:${localPort}`,
      tone: localRole === 'relay' ? 'relay' : 'local',
      labels: [
        { text: localNetworkType.toUpperCase(), color: networkBg(localNetworkType) },
        localRole === 'relay'
          ? { text: 'RELAY', color: 'text-amber-400 border-amber-700/30 bg-amber-900/30' }
          : { text: 'LEAF', color: 'text-gray-500 border-gray-700 bg-gray-800' },
      ],
      action: 'Enter',
      onClick: () => onEnterNode?.('__local__'),
    }, !isLocalAccess ? 'view entry' : undefined, !isLocalAccess ? 'view' : undefined);
  }

  if (upstreamNode && upstreamUrl) {
    pushNode({
      id: upstreamNode.id,
      icon: Server,
      name: upstreamNode.name,
      address: `${upstreamNode.host}:${upstreamNode.port}`,
      tone: 'relay',
      labels: [
        { text: upstreamNode.networkType.toUpperCase(), color: networkBg(upstreamNode.networkType) },
        { text: 'RELAY', color: 'text-amber-400 border-amber-700/30 bg-amber-900/30' },
      ],
      action: 'Enter',
      onClick: () => onEnterNode?.(`upstream:${upstreamUrl}`),
    }, 'connected upstream');
  }

  relayNodes.forEach((relay) => {
    pushNode({
      id: relay.id,
      icon: Server,
      name: relay.name,
      address: relay.ip ? `${relay.ip}:8080` : undefined,
      tone: 'relay',
      labels: [
        ...(relay.networkType ? [{ text: relay.networkType.toUpperCase(), color: networkBg(relay.networkType) }] : []),
        { text: 'RELAY', color: 'text-amber-400 border-amber-700/30 bg-amber-900/30' },
      ],
      action: 'Enter',
      onClick: () => onEnterNode?.(relay.id),
    }, 'relay / upstream');

    childrenOf(relay.id).forEach((leaf) => {
      pushNode({
        id: leaf.id,
        icon: Cpu,
        name: leaf.name,
        address: leaf.ip ? `${leaf.ip}:8080` : undefined,
        tone: 'leaf',
        labels: [
          ...(leaf.networkType ? [{ text: leaf.networkType.toUpperCase(), color: networkBg(leaf.networkType) }] : []),
          { text: 'LEAF', color: 'border-blue-700/30 bg-blue-900/20 text-blue-400' },
        ],
        action: 'Enter',
        onClick: () => onEnterNode?.(leaf.id),
      }, `via ${relay.name}`);
    });
  });

  leafNodes.forEach((leaf) => {
    if (relayOf(leaf.id)) return;
    pushNode({
      id: leaf.id,
      icon: Cpu,
      name: leaf.name,
      address: leaf.ip ? `${leaf.ip}:8080` : undefined,
      tone: 'leaf',
      labels: [
        ...(leaf.networkType ? [{ text: leaf.networkType.toUpperCase(), color: networkBg(leaf.networkType) }] : []),
        { text: 'LEAF', color: 'border-blue-700/30 bg-blue-900/20 text-blue-400' },
      ],
      action: 'Enter',
      onClick: () => onEnterNode?.(leaf.id),
    }, 'leaf connected');
  });

  return (
    <div className="space-y-5 px-1 pb-4">
      {items.length > 0 ? (
        <div className="space-y-1">
          {items.map((item, index) => (
            item.kind === 'node'
              ? <NodeCard key={`${item.node.id}-${index}`} node={item.node} />
              : <LinkLine key={`link-${index}`} label={item.label} tone={item.tone} />
          ))}
        </div>
      ) : (
        <div className="border rounded-lg border-gray-700/60 bg-gray-800/20 px-3.5 py-4 text-sm text-gray-500">
          disconnected / loading: 没有真实后端节点数据，不显示伪造卡片。
        </div>
      )}

      {viewers.length > 0 && (
        <div className="space-y-1">
          {viewers.map((viewer) => (
            <div key={viewer.id}>
              <LinkLine label="view entry" tone="view" />
              <NodeCard
                node={{
                  id: viewer.id,
                  icon: Monitor,
                  name: viewer.name || 'Browser View',
                  address: viewer.ip ? `via ${viewer.ip}` : 'view',
                  tone: 'view',
                  labels: [
                    ...(viewer.networkType ? [{ text: viewer.networkType.toUpperCase(), color: networkBg(viewer.networkType) }] : []),
                    { text: 'VIEW', color: 'border-gray-700 bg-gray-800 text-gray-500' },
                  ],
                  action: 'View',
                }}
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
          {isUpstreamConnected && (
            <span className="ml-2 text-emerald-500 font-normal">
              ● {connections.find(c => c.url === upstreamUrl)?.name || upstreamUrl}
            </span>
          )}
        </h3>
        <div className="space-y-0.5">
          {connections.filter(c => !isLocalUrl(c.url)).length === 0 && !upstreamUrl ? (
            <div className="px-2.5 py-2 text-[10px] text-gray-600">
              暂无连接。输入远程 relay 地址保存并连接。
            </div>
          ) : (
            connections.filter(c => !isLocalUrl(c.url)).map((conn) => {
              let badgeStyle = 'text-gray-500 border-gray-700 bg-gray-800/50';
              let badgeText = '已保存';
              let showError = false;

              if (conn.url === upstreamUrl) {
                badgeStyle = 'text-emerald-400 border-emerald-700/30 bg-emerald-900/20';
                badgeText = '已连接';
              } else if (conn.url === upstreamConnectingUrl) {
                badgeStyle = 'text-yellow-400 border-yellow-700/30 bg-yellow-900/20';
                badgeText = '连接中...';
              } else if (conn.url === upstreamErrorUrl) {
                badgeStyle = 'text-red-400 border-red-700/30 bg-red-900/20';
                badgeText = '失败';
                showError = true;
              }

              return (
                <div key={conn.id}>
                  <div className="flex items-center justify-between px-2.5 py-1.5 rounded-md hover:bg-gray-900/40 text-xs">
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <span className="text-gray-300 truncate">{conn.url}</span>
                      {badgeText !== '已保存' && (
                        <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono border shrink-0 ${badgeStyle}`}>
                          {badgeText}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      {conn.url === upstreamUrl ? (
                        <button
                          onClick={onDisconnectUpstream}
                          className="text-[8px] px-1.5 py-0.5 bg-red-800/40 hover:bg-red-700/50 text-red-400 rounded border border-red-800/40"
                        >断开</button>
                      ) : conn.url === upstreamConnectingUrl ? (
                        <span className="text-[8px] px-1.5 py-0.5 text-yellow-500 animate-pulse">连接中...</span>
                      ) : (
                        onConnectUpstream && (
                          <button
                            onClick={() => onConnectUpstream(conn.url)}
                            className="text-[8px] px-1.5 py-0.5 bg-gray-700/40 hover:bg-amber-700/50 text-gray-400 hover:text-amber-200 rounded"
                          >连接</button>
                        )
                      )}
                      {conn.id !== 'local' && (
                        <button onClick={() => onDeleteConnection(conn.id)} className="text-gray-600 hover:text-red-400">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {showError && upstreamError && (
                    <div className="pb-1 px-2.5 text-[9px] text-red-500/80">{upstreamError}</div>
                  )}
                </div>
              );
            })
          )}

          {/* ── Add connection form ── */}
          <form onSubmit={onAddConnection} className="flex gap-1 pt-2">
            <input
              type="text"
              value={newConnUrl}
              onChange={e => onNewConnUrlChange(e.target.value)}
              placeholder="ws://&lt;ip&gt;:8080"
              className="flex-1 bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[10px] text-gray-200 outline-none focus:border-purple-500"
            />
            <div className="flex gap-1 shrink-0">
              <button type="submit"
                className="px-2 py-1 bg-purple-700 hover:bg-purple-600 text-white text-[9px] rounded border border-purple-600"
              >保存</button>
              {onConnectUpstream && newConnUrl.trim() && (
                <button type="button"
                  onClick={() => onConnectUpstream(newConnUrl.trim())}
                  className="px-2 py-1 bg-amber-700 hover:bg-amber-600 text-white text-[9px] rounded border border-amber-600"
                >连接</button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
