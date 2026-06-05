'use client';

import type { NodeInfo, NodeStatus, SessionInfo } from './core-types';

export function listFromResponse<T>(result: unknown, ...keys: string[]): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    for (const key of keys) {
      const value = obj[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

export function normalizeNodeInfo(raw: Partial<NodeInfo> & Record<string, unknown>): NodeInfo {
  const status = normalizeNodeStatus(String(raw.status || 'offline'));
  const nodeId = String(raw.nodeId || raw.id || 'local');
  return {
    ...raw,
    nodeId,
    name: String(raw.name || raw.displayName || raw.hostname || nodeId),
    status,
    role: raw.role === 'relay' || raw.role === 'leaf' ? raw.role : undefined,
    displayName: typeof raw.displayName === 'string' ? raw.displayName : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags : undefined,
    inboundPeerReachable: typeof raw.inboundPeerReachable === 'boolean' ? raw.inboundPeerReachable : undefined,
    address: typeof raw.address === 'string' ? raw.address : undefined,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    uptime: typeof raw.uptime === 'string' ? raw.uptime : undefined,
    os: typeof raw.os === 'string' ? raw.os : undefined,
    arch: typeof raw.arch === 'string' ? raw.arch : undefined,
    cpu: typeof raw.cpu === 'string' ? raw.cpu : raw.numCPU !== undefined ? String(raw.numCPU) : undefined,
  };
}

export function normalizeSessionInfo(raw: Partial<SessionInfo> & Record<string, unknown>): SessionInfo {
  const state = String(raw.status || raw.state || 'stopped');
  return {
    ...raw,
    sessionId: String(raw.sessionId || ''),
    kind: String(raw.kind || raw.command || 'session'),
    status: state === 'running' || state === 'stopped' || state === 'interrupted' || state === 'failed' || state === 'resumable'
      ? state
      : state === 'created'
        ? 'running'
        : 'stopped',
  };
}

function normalizeNodeStatus(status: string): NodeStatus {
  switch (status) {
    case 'online':
    case 'connected':
    case 'local':
      return 'online';
    case 'connecting':
      return 'connecting';
    case 'error':
    case 'revoked':
    case 'expired':
      return 'error';
    case 'offline':
    case 'disconnected':
    default:
      return 'offline';
  }
}
