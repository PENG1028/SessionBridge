'use client';

// ─── Core API method signatures ─────────────────────────────────
// These types mirror SYSTEM_UI_API_MAP.md naming conventions.

// ─── notify ─────────────────────────────────────────────────────
export type NotifyListParams = { filter?: string; since?: string };
export type NotifyMarkReadParams = { notificationId: string };

// ─── approval ───────────────────────────────────────────────────
export type ApprovalListParams = { status?: string; type?: string };
export type ApprovalGetParams = { requestId: string };
export type ApprovalTakeOverParams = { requestId: string };

// ─── logs ───────────────────────────────────────────────────────
export type LogSource = 'core' | 'plugin' | 'system' | 'session';
export type LogTailParams = { source: LogSource; lines?: number; level?: string };
export type LogQueryParams = { source?: LogSource; level?: string; timeRange?: string; search?: string; nodeId?: string; pluginId?: string };
export type LogExportParams = { timeRange: string; format?: string };

// ─── audit ──────────────────────────────────────────────────────
export type AuditListParams = { timeRange?: string; type?: string; actor?: string; target?: string };
export type AuditGetParams = { auditId: string };
export type AuditExportParams = { timeRange: string };

// ─── session ────────────────────────────────────────────────────
export interface SessionInfo {
  sessionId: string;
  kind: string;
  pluginId?: string;
  nodeId?: string;
  status: SessionStatus;
  createdAt?: string;
  uptime?: string;
}

export type SessionStatus = 'running' | 'stopped' | 'interrupted' | 'failed' | 'resumable';

export type SessionListParams = { nodeId?: string; kind?: string; status?: SessionStatus };
export type SessionGetParams = { sessionId: string };
export type SessionCreateParams = { kind: string; nodeId?: string; pluginId?: string; command?: string; cwd?: string; env?: Record<string, string>; historyPolicy?: string; config?: Record<string, unknown> };
export type SessionStopParams = { sessionId: string };
export type SessionEventsParams = { sessionId: string };

// ─── stream ─────────────────────────────────────────────────────
export type StreamType = 'stdout' | 'stderr' | 'stdin';
export type StreamSubscribeParams = { sessionId: string; streamType: StreamType };
export type StreamReplayParams = { sessionId: string; streamType: StreamType; fromSeq?: number };
export type StreamTailParams = { sessionId: string; streamType: StreamType; lines?: number };
export type StreamWriteParams = { sessionId: string; data: string; streamType?: StreamType };

// ─── plugin ─────────────────────────────────────────────────────
export interface PluginInfo {
  pluginId: string;
  version: string;
  status: PluginStatus;
  type?: 'builtin' | 'feature';
  description?: string;
  capabilities?: string[];
  error?: string;
}

export type PluginStatus = 'loaded' | 'enabled' | 'disabled' | 'error';

export type PluginListParams = { nodeId?: string; status?: PluginStatus };
export type PluginGetParams = { pluginId: string };
export type PluginStatusParams = { pluginId: string };
export type PluginEnableParams = { pluginId: string };
export type PluginDisableParams = { pluginId: string };
export type PluginCheckParams = { nodeId?: string; pluginId: string };
export type PluginInstallPlanParams = { nodeId?: string; pluginId: string };
export type PluginInstallExecuteParams = { planId: string };
export type PluginUninstallParams = { nodeId?: string; pluginId: string };
export type PluginFilesListParams = { nodeId?: string; pluginId: string };
export type PluginCacheListParams = { nodeId?: string; pluginId: string };
export type PluginCacheClearPlanParams = { nodeId?: string; pluginId: string };
export type PluginCacheClearExecuteParams = { planId: string };
export type PluginPermissionsListParams = { pluginId: string };
export type PluginPermissionsGrantParams = { pluginId: string; capability: string; mode: "allow" | "deny" | "ask"; constraints?: Record<string, unknown>; planId?: string };
export type PluginPermissionsRevokeParams = { pluginId: string; capability: string };
export type PluginPermissionsResetParams = { pluginId: string };
export type PluginConfigGetParams = { nodeId?: string; pluginId: string; key?: string };
export type PluginConfigSetParams = { nodeId?: string; pluginId: string; key: string; value: unknown };
export type PluginConfigSchemaParams = { pluginId: string };
export type PluginHistoryParams = { nodeId?: string; pluginId: string };

// ─── run ──────────────────────────────────────────────────────────
export interface RunInfo {
  runId: string;
  nodeId?: string;
  kind: string;
  label?: string;
  pluginId?: string;
  state: string;
  sessionId: string;
  processId?: string;
  createdAt?: number;
  updatedAt?: number;
  policy?: {
    onDisconnect?: string;
    onCoreShutdown?: string;
    persistHistory?: boolean;
    restartRestore?: boolean;
  };
  metadata?: Record<string, string>;
  process?: {
    sessionId: string;
    pid?: number;
    state?: string;
    exitCode?: number;
    command?: string;
    createdAt?: number;
  };
}

export type RunCreateParams = {
  kind?: string;
  label?: string;
  pluginId?: string;
  command: string;
  args?: string[];
  cwd?: string;
  pty?: boolean;
  cols?: number;
  rows?: number;
  policy?: {
    onDisconnect?: string;
    onCoreShutdown?: string;
    persistHistory?: boolean;
    restartRestore?: boolean;
  };
  metadata?: Record<string, string>;
};

export type RunListParams = {
  kind?: string;
  pluginId?: string;
  state?: string;
};

export type RunInfoParams = {
  runId: string;
};

export type RunStopParams = {
  runId: string;
  signal?: string;
  tree?: boolean;
};

export type RunUpdatePolicyParams = {
  runId: string;
  policy: {
    onDisconnect?: string;
    onCoreShutdown?: string;
    persistHistory?: boolean;
  };
};

// ─── config ─────────────────────────────────────────────────────
export interface ConfigEntry {
  key: string;
  value: unknown;
  revision: number;
}

export type ConfigListParams = { namespace?: string };
export type ConfigGetParams = { key: string };
export type ConfigSetParams = { key: string; value: unknown; expectedRevision?: number };
export type ConfigResetParams = { key: string };

// ─── node ───────────────────────────────────────────────────────
export interface NodeInfo {
  nodeId: string;
  name: string;
  role?: 'relay' | 'leaf';
  status: NodeStatus;
  version?: string;
  uptime?: string;
  address?: string;
  os?: string;
  arch?: string;
  cpu?: string;
  memory?: string;
  disk?: string;
  labels?: Record<string, string>;
}

export type NodeStatus = 'online' | 'offline' | 'connecting' | 'error';

export type NodeGetParams = { nodeId: string };
export type NodeHealthParams = { nodeId: string };
export type NodeUpdateParams = { nodeId: string; labels?: Record<string, string> };

// ─── plugin check blockers ─────────────────────────────────────
export interface BlockerEntry {
  kind: 'unsupported_capability' | 'missing_dependency' | 'missing_grant' | 'unknown_capability';
  capability?: string;
  dependency?: string;
  reason: string;
}

export interface PluginCheckResult {
  pluginId: string;
  status: 'ok' | 'blocked' | 'incomplete';
  checkedAt: number;
  dependencies: Record<string, unknown>[];
  capabilities: Record<string, unknown>[];
  blockers: BlockerEntry[];
}

// ─── install plan ───────────────────────────────────────────────
export interface InstallStep {
  order: number;
  description: string;
  commands: string[];
  risk: string;
  status: string;
}

export interface InstallPlan {
  planId: string;
  pluginId: string;
  steps: InstallStep[];
  risk: string;
  status: string;
  summary: string;
  createdAt: number;
}

// ─── task ───────────────────────────────────────────────────────
export interface TaskEvent {
  taskId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  message?: string;
}

// ─── WebSocket event types ──────────────────────────────────────
export type CoreEvent =
  | { type: 'connected'; pluginId: string }
  | { type: 'connectionStatus'; status: CoreConnectionStatus; pluginId: string }
  | { type: 'node.health'; nodeId: string; cpu: number; mem: number; disk: number; uptime: number }
  | { type: 'node.connected'; nodeId: string }
  | { type: 'node.disconnected'; nodeId: string }
  | { type: 'session.created'; sessionId: string; kind: string; nodeId: string }
  | { type: 'session.stopped'; sessionId: string; reason: string }
  | { type: 'plugin.registered'; pluginId: string; version: string }
  | { type: 'plugin.unregistered'; pluginId: string }
  | { type: 'config.changed'; key: string; oldValue: unknown; newValue: unknown; revision: number }
  | { type: 'logs.event'; source: string; level: string; message: string; timestamp: string }
  | { type: 'audit.event'; eventType: string; actor: string; target: string; metadata?: Record<string, unknown> }
  | { type: 'approval.request'; pluginId: string; action: string; detail: Record<string, unknown> }
  | { type: 'approval.response'; requestId: string; result: string }
  | { type: 'approval.viewing'; requestId: string; deviceId: string }
  | { type: 'notify.approval.request'; requestId: string; pluginId: string; payload?: Record<string, unknown> }
  | { type: 'notify.approval.result'; requestId: string; action: string; respondedBy: string }
  | { type: 'notify.event'; notificationType: string; title: string; body: string }
  | { type: 'task.event'; taskId: string; status: string; progress?: number; message?: string }
  | { type: 'stream.chunk'; sessionId: string; streamType: string; eventSeq: number; data: string };

// ─── CoreClient interface ───────────────────────────────────────
export interface CoreClient {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(event: string, handler: (data: CoreEvent) => void): () => void;
  once(event: string, handler: (data: CoreEvent) => void): void;
  off(event: string, handler: (data: CoreEvent) => void): void;
  disconnect(): void;
  readonly pluginId: string;
  readonly isConnected: boolean;
}

// ─── CoreClient status ──────────────────────────────────────────
export type CoreConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
