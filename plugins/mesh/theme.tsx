'use client';

// ─── Types ───
export type NodeKind = 'RELAY' | 'LEAF' | 'VIEW' | 'LOCAL';

// ─── Theme helpers ───
export function nodeTheme(kind: NodeKind) {
  switch (kind) {
    case 'RELAY': return 'border-amber-700/40 bg-amber-900/[0.06]';
    case 'LEAF': return 'border-blue-700/40 bg-blue-900/[0.05]';
    case 'VIEW': return 'border-gray-700/60 bg-gray-800/20';
    case 'LOCAL': return 'border-gray-700/60 bg-gray-800/30';
  }
}

export function kindBadgeStyle(kind: NodeKind) {
  switch (kind) {
    case 'RELAY': return 'text-amber-400 border-amber-700/30 bg-amber-900/30';
    case 'LEAF': return 'text-blue-400 border-blue-700/30 bg-blue-900/20';
    case 'VIEW': return 'text-gray-500 border-gray-700 bg-gray-800';
    case 'LOCAL': return 'text-purple-400 border-purple-700/30 bg-purple-900/20';
  }
}

export function iconColor(kind: NodeKind) {
  switch (kind) {
    case 'RELAY': return 'text-amber-400';
    case 'LEAF': return 'text-blue-400';
    case 'VIEW': return 'text-gray-500';
    case 'LOCAL': return 'text-purple-400';
  }
}

// ─── Little badges ───
export function StatusBadge({ status }: { status: 'connected' | 'connecting' | 'failed' | 'saved' }) {
  const colors: Record<string, string> = {
    connected: 'text-emerald-400 border-emerald-700/30 bg-emerald-900/10',
    connecting: 'text-amber-400 border-amber-700/30 bg-amber-900/10',
    failed: 'text-red-400 border-red-700/30 bg-red-900/10',
    saved: 'text-gray-500 border-gray-700 bg-gray-800',
  };
  return <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono border ${colors[status] || colors.saved}`}>{status}</span>;
}

export function TypeBadge({ connType }: { connType: string }) {
  const colors: Record<string, string> = {
    'view': 'text-gray-500 border-gray-700 bg-gray-800',
    'incoming leaf': 'text-blue-400 border-blue-700/30 bg-blue-900/20',
    'upstream': 'text-amber-400 border-amber-700/30 bg-amber-900/20',
    'lan leaf': 'text-green-400 border-green-700/30 bg-green-900/20',
  };
  return <span className={`text-[8px] px-1.5 py-0.5 rounded font-mono border ${colors[connType] || 'text-gray-500 border-gray-700 bg-gray-800'}`}>{connType}</span>;
}

// ─── Network / address helpers ───
export function extractHost(address?: string): string {
  if (!address) return '127.0.0.1';
  try {
    const colonIdx = address.lastIndexOf(':');
    if (colonIdx > 0) return address.slice(0, colonIdx);
    return address;
  } catch (_e) { return '127.0.0.1'; }
}

export function extractPort(address?: string, defaultPort = 9090): number {
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

export function categorizeNetwork(ip: string): 'loopback' | 'lan' | 'wan' {
  if (ip === '127.0.0.1' || ip === 'localhost' || ip === '::1') return 'loopback';
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return 'lan';
  if (ip.startsWith('172.')) {
    const seg = parseInt(ip.split('.')[1] || '0', 10);
    if (seg >= 16 && seg <= 31) return 'lan';
  }
  if (ip.startsWith('fe80:')) return 'lan';
  if (ip.startsWith('fc') || ip.startsWith('fd')) return 'lan';
  return 'wan';
}

// ─── Relay / Leaf determination ───

/** Determine node kind from Core-reported data + address heuristics.
 *  Priority: role === 'relay' → inboundPeerReachable → WAN address → LEAF. */
export function determineKind(info: {
  role?: string;
  inboundPeerReachable?: boolean;
  address?: string;
}): 'RELAY' | 'LEAF' {
  if (info.role === 'relay') return 'RELAY';
  if (info.inboundPeerReachable) return 'RELAY';
  if (info.address && categorizeNetwork(extractHost(info.address)) === 'wan') return 'RELAY';
  return 'LEAF';
}

export function networkClass(type?: string) {
  switch (type) {
    case 'wan': return 'border-yellow-700/30 bg-yellow-900/10 text-yellow-400';
    case 'lan': return 'border-green-700/30 bg-green-900/10 text-green-400';
    case 'loopback': return 'border-gray-700 bg-gray-800 text-gray-500';
    default: return 'border-gray-700 bg-gray-800 text-gray-500';
  }
}

export function latencyLabel(ms?: number): string {
  if (ms === undefined || ms === null) return '--';
  return `${ms}ms`;
}

// ─── Link Line ───
export function LinkLine({ label, muted, dashed }: { label: string; muted?: boolean; dashed?: boolean }) {
  return (
    <div className={`ml-5 -my-1 pl-4 py-2 flex items-center gap-2 ${dashed ? 'border-dashed' : 'border-l-2'} ${muted ? 'border-gray-700/50' : dashed ? 'border-gray-600' : 'border-amber-700/30'}`}>
      <div className={`text-[9px] font-mono ${muted ? 'text-gray-500' : dashed ? 'text-gray-500' : 'text-amber-600/70'}`}>{label}</div>
    </div>
  );
}
