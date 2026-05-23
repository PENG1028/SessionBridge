// ─── Relay Types — local type definitions ──────────────────
// Previously imported from extensions/types.ts.
// Only the subset used by src/ is kept.

// ═══════════════════════════════════════════════════════════════════
// Permission
// ═══════════════════════════════════════════════════════════════════

export type PermissionCategory =
  | 'fileRead' | 'fileWrite'
  | 'network'
  | 'processManagement'
  | 'shellAccess'
  | 'configurationWrite';

// ═══════════════════════════════════════════════════════════════════
// Adapter types — local subset, formerly in extensions/types.ts
// ═══════════════════════════════════════════════════════════════════

export interface AdapterCapabilities {
  terminal?: boolean;
  fileContext?: boolean;
  structuredEvents?: boolean;
  approvals?: boolean;
  modes?: boolean;
  timeline?: boolean;
  compact?: boolean;
  tasks?: boolean;
  [key: string]: unknown;
}

export interface AgentAdapter {
  id: string;
  name?: string;
  displayName: string;
  icon?: string;
  viewId?: string;
  getCapabilities(): AdapterCapabilities;
  start(input: { workspaceId: string; directory: string; label: string; adapterId: string; config?: Record<string, unknown>; onOutput?: (data: string) => void; onExit?: (code: number | null) => void; onBlock?: (block: Record<string, unknown>) => void }): Promise<InstanceHandle>;
  getSessionProvider?(): unknown;
  detect?(runtime: Record<string, unknown>): Promise<boolean>;
  parseLine?(line: string, instance: any, deps: any): void;
}

// ═══════════════════════════════════════════════════════════════════
// When Context
// ═══════════════════════════════════════════════════════════════════

export interface WhenContext {
  view?: string;
  instanceStatus?: string;
  activeAdapterId?: string;
  editorHasSelection?: boolean;
  isRunning?: boolean;
  [key: string]: unknown;
}

// ═══════════════════════════════════════════════════════════════════
// Stream Parser Deps — shared between server and adapters
// ═══════════════════════════════════════════════════════════════════

export interface StreamParserDeps {
  sendBlock: (block: Record<string, unknown>) => void;
  broadcast: (msg: unknown) => void;
  bufferOutput: (data: string) => void;
  nextId: () => string;
  setActive: (id: string | null) => void;
  getActiveId: () => string | null;
  processQueueForInstance: (inst: any) => void;
  sendControlRequest: (subtype: string, data: Record<string, unknown>, instanceId?: string) => boolean;
  getEffortLevel: () => string;
  notify?: (scenarioId: string, title: string, detail?: string) => void;
}

// ═══════════════════════════════════════════════════════════════════
// Relay Event Bus
// ═══════════════════════════════════════════════════════════════════

export interface RelayEventBus {
  on(type: string, handler: (data: Record<string, unknown>) => void): () => void;
  emit(type: string, data: Record<string, unknown>): void;
  off(type: string, handler: (data: Record<string, unknown>) => void): void;
}

// ═══════════════════════════════════════════════════════════════════
// Instance Handle — returned by adapter.start()
// ═══════════════════════════════════════════════════════════════════

export interface InstanceHandle {
  instance: {
    id: string;
    workspaceId: string;
    adapterId: string;
    label: string;
    status: string;
    source: string;
    createdAt: number;
  };
  send: (data: string) => Promise<void>;
  sendCommand: (cmd: string, args?: Record<string, unknown>) => Promise<void>;
  stop: () => Promise<void>;
  onBlock: (handler: (block: any) => void) => () => void;
  resize?: (cols: number, rows: number) => void;
}

// ═══════════════════════════════════════════════════════════════════
// Shared Surface + Runtime Replay
// ═══════════════════════════════════════════════════════════════════

export type ReplayPolicy =
  | { mode: 'none' }
  | { mode: 'latest'; key?: string }
  | { mode: 'tail'; lines?: number; bytes?: number }
  | { mode: 'events'; count?: number }
  | { mode: 'full'; maxBytes?: number };

export interface SharedSurface {
  surfaceId: string;
  nodeId: string;
  title: string;
  viewType: string;
  pluginId?: string;
  scope: 'local' | 'node' | 'network';
  shared: boolean;
  runtimeRef: {
    kind: 'terminal' | 'operation' | 'plugin' | 'snapshot' | 'none';
    operationId?: string;
    instanceId?: string;
    pluginId?: string;
  };
  replayPolicy: ReplayPolicy;
  permissions?: {
    read?: string[];
    input?: string[];
    cancel?: string[];
    admin?: string[];
  };
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  keep?: boolean;
  orphaned?: boolean;
}

export interface RuntimeOutputChunk {
  seq: number;
  stream: 'stdout' | 'stderr' | 'structured';
  data: string;
  timestamp: number;
}

export interface RuntimeEvent {
  seq: number;
  event: string;
  data: unknown;
  timestamp: number;
}

export interface RuntimeState {
  operationId: string;
  nodeId: string;
  surfaceId?: string;
  kind: 'terminal' | 'plugin' | 'operation';
  status: 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
  latest?: unknown;
  outputBuffer: RuntimeOutputChunk[];
  eventBuffer: RuntimeEvent[];
  createdAt: number;
  updatedAt: number;
}
