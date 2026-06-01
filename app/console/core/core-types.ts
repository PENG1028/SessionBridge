'use client';

// ─── 协议类型镜像 ──────────────────────────────────
// 以下类型映射 Go Core 的 capability 返回形状。
// 来源：go-core/pkg/types/（CapabilityRequest/Response, CoreError 等）
//      go-core/internal/server/（NodeInfo, SessionInfo 等 HTTP 返回）
//      go-core/internal/executor/（capability handler 的 payload 结构）
// 改 Go Core 侧字段时请同步更新此文件。

// ─── Core API method signatures ─────────────────────────────────
// These types mirror SYSTEM_UI_API_MAP.md naming conventions.

// ─── notify ─────────────────────────────────────────────────────
export type NotifyListParams = { filter?: string; since?: string };
export type NotifyMarkReadParams = { notificationId: string };

// ─── approval ───────────────────────────────────────────────────
export type ApprovalListParams = { status?: string; type?: string };

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
export type StreamListParams = { sessionId: string };

// ─── process ──────────────────────────────────────────────────────
export type ProcessResizeParams = { sessionId: string; cols: number; rows: number };
export type ProcessSignalParams = { sessionId: string; signal: string; tree?: boolean };
export type ProcessListParams = { pluginId?: string; kind?: string; sessionId?: string };

// ─── fs ───────────────────────────────────────────────────────────
export interface FsEntry {
  name: string;
  isDir: boolean;
  size: number;
  mode: string;
}

export type FsListParams = { path: string };
export type FsReadParams = { path: string };
export type FsWriteParams = { path: string; data: string };
export type FsMkdirParams = { path: string; all?: boolean; mode?: number };
export type FsRemoveParams = { path: string; recursive?: boolean };
export type FsRenameParams = { oldPath: string; newPath: string };
export type FsStatParams = { path: string };

// ─── plugin ─────────────────────────────────────────────────────
export interface PluginInfo {
  pluginId: string;
  version: string;
  status: PluginStatus;
  type?: 'builtin' | 'feature';
  description?: string;
  capabilities?: string[];
  contributes?: PluginContributes;
  error?: string;
}

export interface PluginContributes {
  views?: Array<{ id: string; title: string; category?: string; icon?: string; launchable?: boolean }>;
  commands?: Array<{ id: string; title: string; category?: string }>;
  menus?: Record<string, Array<{ command: string; group?: string; when?: string }>>;
  chrome?: {
    header?: Array<{ id: string; title: string; text?: string; side?: string; command?: string }>;
    statusBar?: Array<{ id: string; text: string; side?: string; group?: string }>;
    contextControls?: Array<{ id: string; kind: string; label: string; placement?: string; command?: string }>;
    keyHints?: Array<{ id: string; label: string; keys: string; command?: string }>;
  };
  configuration?: Record<string, unknown>;
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
export type PluginCacheClearPlanParams = { nodeId?: string; pluginId: string; cacheId: string };
export type PluginCacheClearExecuteParams = { pluginId: string; cacheId: string };
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

// ─── run.attach ──────────────────────────────────────────────────────
export interface RunAttachParams {
  runId: string;
  streamTypes?: StreamType[];
  replay?: boolean;
  fromSeq?: number;
}

export interface RunAttachResult {
  runId: string;
  sessionId: string;
  kind?: string;
  pluginId?: string;
  state: string;
  processId?: string;
  streamSubscriptions?: Array<{ streamType: string; subscribed: boolean; reason?: string }>;
  replay?: Record<string, Array<{ seq?: number; data: string; streamType?: string; timestamp?: number }>>;
  process?: RunInfo['process'];
  policy?: RunInfo['policy'];
  label?: string;
}

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

// ─── node.identity ──────────────────────────────────────────────
export interface NodeIdentity {
  nodeId: string;
  publicKey: string;
  fingerprint: string;
  createdAt: number;
}

// ─── node.invite ────────────────────────────────────────────────
export interface NodeInvite {
  inviteId: string;
  createdAt: number;
  expiresAt: number;
  ttlSeconds: number;
  trustDurationSeconds: number;
  localNodeId: string;
  localFingerprint: string;
}

export interface NodeInviteCreateResult extends NodeInvite {
  code: string;
  localNode: {
    nodeId: string;
    fingerprint: string;
    publicKey: string;
  };
}

export interface NodeInviteListResult {
  invites: NodeInvite[];
  total: number;
}

export type NodeInviteCreateParams = {
  ttlSeconds?: number;
  trustDurationSeconds?: number;
  roleHint?: string;
  nameHint?: string;
};

export type NodeInviteRevokeParams = {
  inviteId: string;
};

export type NodeInviteAcceptParams = {
  peerUrl: string;
  code: string;
  nameHint?: string;
};

// ─── node.peer ──────────────────────────────────────────────────
export interface PeerEntry {
  nodeId: string;
  name: string;
  fingerprint: string;
  addresses: string[];
  trustExpiresAt: number;
  autoReconnect: boolean;
  lastSeen: number;
  policy: { mode: string };
  status: string;
}

export interface NodePeerListResult {
  peers: PeerEntry[];
}

export type NodePeerInfoParams = { nodeId: string };
export type NodePeerRevokeParams = { nodeId: string };
export type NodePeerDisconnectParams = { nodeId: string };
export type NodePeerReconnectParams = { nodeId: string };

// ─── node.reachability ──────────────────────────────────────────
export interface ReachabilityResult {
  publicReachable: string;
  inboundPeerAllowed: boolean;
  outboundOnly: boolean;
  reason: string;
}

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
  readonly wsUrl: string;
  readonly lastError: string | null;
  readonly hasToken: boolean;
  readonly authMode: 'token' | 'none';
}

// ─── CoreClient status ──────────────────────────────────────────
export type CoreConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// ─── update ──────────────────────────────────────────────────────
export interface UpdateSource {
  type: string;
  remote: string;
  branch: string;
  repoUrl: string;
  mode: string;
}

export interface UpdatePolicy {
  autoCheck: boolean;
  autoApply: boolean;
  checkIntervalSeconds: number;
  allowDirtyWorktree: boolean;
  allowWhenRunsActive: boolean;
  ignoredVersions: string[];
}

export interface UpdateStatus {
  status: UpdateStatusValue;
  currentCommit: string;
  remoteCommit: string;
  behindBy: number;
  dirty: boolean;
  source: UpdateSource;
  lastCheckedAt: number;
  lastCheckError?: string;
  requiresRestart: boolean;
}

export type UpdateStatusValue = 'unknown' | 'checking' | 'up-to-date' | 'update-available' | 'error';

export interface UpdatePlanBlocker {
  type: string;
  message: string;
  detail?: string;
}

export interface UpdatePlan {
  canUpdate: boolean;
  status: string;
  currentCommit: string;
  remoteCommit: string;
  behindBy: number;
  dirty: boolean;
  blockers: UpdatePlanBlocker[];
  steps: Array<{ order: number; action: string; description: string }>;
}

export type UpdateSourceSetParams = Partial<UpdateSource>;
export type UpdatePolicySetParams = Partial<UpdatePolicy>;
export type UpdateIgnoreParams = { version: string };
