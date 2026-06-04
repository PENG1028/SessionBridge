// ─── Session/Connection types — shared between use-ws and consumers ───

export interface ConnStatus {
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  sessionId?: string;
  retryCount?: number;
}

export interface MsgLog {
  id: number;
  time: string;
  type: string;
  data: string;
  size: number;
}

export type SessionInfo = {
  id: string;
  directory: string;
  label: string;
  hasBridge: boolean;
  hasClient: boolean;
  webUrl: string;
};

export type InstanceInfo = {
  id: string;
  dir: string;
  label: string;
  status: string;
  source: string;
  adapterId?: string;
  model: string | null;
  blockCount: number;
  outputSize: number;
  checkpointCount: number;
  createdAt: number;
};

export type QueueStatus = {
  processing: boolean;
  source: string | null;
  queueDepth: number;
};

export type RunLike = {
  runId?: string;
  sessionId?: string;
  kind?: string;
  label?: string;
  pluginId?: string;
  state?: string;
  createdAt?: number;
  metadata?: Record<string, string>;
  process?: { command?: string };
};
