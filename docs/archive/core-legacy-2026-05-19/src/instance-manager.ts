// ─── Instance Manager ───────────────────────────────────────
// Manages multiple agent instances, each with its own working
// directory, buffers, adapter state, and checkpoint manager.
//
// Originally built for Claude, now supports any adapter via
// the `adapterState` generic state bag.

import { CheckpointManager } from "./checkpoint-manager";
import type { ChildProcess } from "child_process";
import type { WebSocket } from "ws";
import type { RelayEventBus } from '../extensions/types';
import { adapterRegistry, getDefaultAdapterId } from "../extensions/registry";

// ─── Types ─────────────────────────────────────────────────

export type InstanceStatus = 'starting' | 'running' | 'stopped' | 'error';
export type InstanceSource = 'local' | 'remote';

export type OperationStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type OperationKind = 'command' | 'chat' | 'task' | 'spawn';

export interface OperationState {
  id: string;           // unique operation id
  kind: OperationKind;
  status: OperationStatus;
  startedAt: number;
  completedAt?: number;
  command?: string;     // the input that triggered this
  result?: string;      // brief result text
  exitCode?: number;
  error?: string;
}

// Valid transitions
export const VALID_TRANSITIONS: Record<OperationStatus, OperationStatus[]> = {
  pending: ['running', 'cancelled'],
  running: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: ['pending'],  // can retry from cancelled back to pending
};

export interface InstanceData {
  id: string;
  dir: string;
  label: string;
  status: InstanceStatus;
  source: InstanceSource;
  process: ChildProcess | null;
  agentConnection: WebSocket | null;
  model: string | null;

  // Streaming state — maintained for backward compat, prefer adapterState
  thinkingId: string | null;
  thinkingText: string;
  toolUseId: string | null;
  toolResult: string;
  textBuffer: string;

  // Block / output buffers (for reconnect persistence)
  blockBuffer: Record<string, unknown>[];
  outputBuffer: string[];
  outputSize: number;

  // Checkpoint manager (per-instance)
  checkpointManager: CheckpointManager;

  // Queue state
  isProcessing: boolean;
  pendingQueue: string[];
  queueLock: string | null;

  // Adapter-agnostic state bag (for adapter-specific data)
  adapterState: Record<string, unknown>;

  // Adapter start handle (set by spawnInstance via adapter.start())
  handle?: import('../extensions/types').InstanceHandle;

  // Metadata
  createdAt: number;
  adapterId?: string;  // which adapter owns this instance
  /** Top-level role discriminator.
   *  'node'    = device/agent/relay — appears in peer.list/NodeBar.
   *  'runtime' = sub-process under a node — never in peer.list/NodeBar.
   *  undefined = legacy device node (backward compat, treated as 'node'). */
  instanceRole?: 'node' | 'runtime';

  /** Open-ended runtime type. Only meaningful when instanceRole='runtime'.
   *  Built-in: 'terminal', 'plugin'.
   *  Third-party / plugin: 'k8s.pod', 'docker.container', 'my-plugin.worker', etc.
   *  Never used for peer.list / NodeBar gating — that is instanceRole's job. */
  runtimeKind?: string;

  /** For runtime instances, the id of the plugin that owns this runtime (if any). */
  pluginId?: string;
  agentVersion?: string; // agent version reported during registration (remote only)

  // Operation state machine
  currentOperation: OperationState | null;
  operationHistory: OperationState[];  // last 20 operations
}

// ─── InstanceManager ───────────────────────────────────────

export class InstanceManager {
  private instances: Map<string, InstanceData> = new Map();
  private _activeId: string | null = null;
  private idCounter = 0;
  private opCounter = 0;

  constructor(private eventBus?: RelayEventBus) {}

  /** Create a new instance and register it.
   *  @param opts.instanceRole  'node' for device nodes, 'runtime' for sub-processes
   *  @param opts.parentNodeId  Required when instanceRole='runtime'
   *  @param opts.runtimeKind   Open-ended type tag (e.g. 'terminal', 'k8s.pod')
   *  @param opts.pluginId      Owning plugin id (for plugin-spawned runtimes) */
  create(dir: string, label?: string, source?: InstanceSource, adapterId?: string, opts?: {
    instanceRole?: 'node' | 'runtime';
    parentNodeId?: string;
    runtimeKind?: string;
    pluginId?: string;
  }): InstanceData {
    // TODO(Phase 4F): Require explicit adapterId. The fallback below is only
    // for internal callers (shell.spawn, remote agent registration) that
    // resolve the adapter themselves before calling create(). The REST API
    // route (POST /api/instances) now rejects missing adapterId.
    const id = `inst_${++this.idCounter}_${Date.now().toString(36)}`;
    const instance: InstanceData = {
      id,
      dir,
      label: label || labelFromDir(dir),
      status: 'starting',
      source: source || 'local',
      adapterId: adapterId || getDefaultAdapterId(),
      process: null,
      agentConnection: null,
      model: null,
      thinkingId: null,
      thinkingText: "",
      toolUseId: null,
      toolResult: "",
      textBuffer: "",
      blockBuffer: [],
      outputBuffer: [],
      outputSize: 0,
      checkpointManager: new CheckpointManager(dir),
      isProcessing: false,
      pendingQueue: [],
      queueLock: null,
      adapterState: {},
      createdAt: Date.now(),
      currentOperation: null,
      operationHistory: [],
      instanceRole: opts?.instanceRole,
      runtimeKind: opts?.runtimeKind,
      pluginId: opts?.pluginId,
    };
    if (opts?.parentNodeId) {
      instance.adapterState.parentNodeId = opts.parentNodeId;
    }
    this.instances.set(id, instance);
    return instance;
  }

  /** Get an instance by ID */
  get(id: string): InstanceData | undefined {
    return this.instances.get(id);
  }

  /**
   * Kill (remove) an instance from management.
   * Does NOT kill the underlying process — caller must handle that.
   * Returns false if not found, true on removal.
   */
  kill(id: string): boolean {
    const existed = this.instances.delete(id);
    if (existed && this._activeId === id) {
      this._activeId = null;
    }
    return existed;
  }

  /** List all registered instances */
  list(): InstanceData[] {
    return Array.from(this.instances.values());
  }

  /** Count of registered instances */
  get count(): number {
    return this.instances.size;
  }

  /** Get or set the currently active instance ID */
  get activeId(): string | null {
    return this._activeId;
  }

  setActive(id: string | null): void {
    if (id === null || this.instances.has(id)) {
      this._activeId = id;
    }
  }

  /** Get the active instance (if set and exists) */
  getActive(): InstanceData | undefined {
    return this._activeId ? this.instances.get(this._activeId) : undefined;
  }

  /** Stop all instances — clears internal state */
  stopAll(): void {
    this.instances.clear();
    this._activeId = null;
  }

  // ── Operation State Machine ─────────────────────────────────

  /** Start a new operation for an instance. Returns the operation state, or null if instance not found. */
  startOperation(instanceId: string, kind: OperationKind, command?: string): OperationState | null {
    const inst = this.instances.get(instanceId);
    if (!inst) return null;

    // Push previous operation to history if any
    if (inst.currentOperation) {
      inst.operationHistory.push(inst.currentOperation);
      if (inst.operationHistory.length > 20) {
        inst.operationHistory.shift();
      }
    }

    const op: OperationState = {
      id: `op_${++this.opCounter}_${Date.now().toString(36)}`,
      kind,
      status: 'pending',
      startedAt: Date.now(),
      command,
    };

    inst.currentOperation = op;

    // Emit events
    this.eventBus?.emit('instance.status', {
      instanceId: inst.id,
      status: inst.status,
      operationStatus: op.status,
    } as unknown as Record<string, unknown>);
    this.eventBus?.emit('instance.operation.started', {
      instanceId: inst.id,
      operationId: op.id,
      kind: op.kind,
      command: op.command,
    } as unknown as Record<string, unknown>);

    return op;
  }

  /** Transition an operation to a new status. Validates the transition. Returns false if invalid. */
  transitionOperation(
    instanceId: string,
    opId: string,
    newStatus: OperationStatus,
    result?: { exitCode?: number; error?: string; resultText?: string },
  ): boolean {
    const inst = this.instances.get(instanceId);
    if (!inst) return false;

    const op = inst.currentOperation;
    if (!op || op.id !== opId) return false;

    // Validate transition
    const allowed = VALID_TRANSITIONS[op.status];
    if (!allowed.includes(newStatus)) return false;

    // Apply transition
    op.status = newStatus;

    // Apply result data
    if (result) {
      if (result.exitCode !== undefined) op.exitCode = result.exitCode;
      if (result.error !== undefined) op.error = result.error;
      if (result.resultText !== undefined) op.result = result.resultText;
    }

    // Terminal state — move to history
    const isTerminal = newStatus === 'succeeded' || newStatus === 'failed' || newStatus === 'cancelled';
    if (isTerminal) {
      op.completedAt = Date.now();
      inst.operationHistory.push(op);
      if (inst.operationHistory.length > 20) {
        inst.operationHistory.shift();
      }
      inst.currentOperation = null;

      this.eventBus?.emit('instance.operation.completed', {
        instanceId: inst.id,
        operationId: op.id,
        kind: op.kind,
        status: op.status,
        exitCode: op.exitCode,
        error: op.error,
        result: op.result,
      } as unknown as Record<string, unknown>);
    }

    // Emit status change
    this.eventBus?.emit('instance.status', {
      instanceId: inst.id,
      status: inst.status,
      operationStatus: op.status,
    } as unknown as Record<string, unknown>);

    return true;
  }

  /** Cancel the current operation (if any) for an instance. */
  cancelOperation(instanceId: string): boolean {
    const inst = this.instances.get(instanceId);
    if (!inst || !inst.currentOperation) return false;

    return this.transitionOperation(instanceId, inst.currentOperation.id, 'cancelled');
  }

  /** Get current operation for an instance. */
  getCurrentOperation(instanceId: string): OperationState | null {
    const inst = this.instances.get(instanceId);
    return inst?.currentOperation ?? null;
  }

  /** Serialise instance list for API responses (excludes process/buffer internals) */
  toJSON() {
    return this.list().map(inst => ({
      id: inst.id,
      dir: inst.dir,
      label: inst.label,
      status: inst.status,
      source: inst.source,
      adapterId: inst.adapterId || getDefaultAdapterId(),
      model: inst.model,
      blockCount: inst.blockBuffer.length,
      outputSize: inst.outputSize,
      checkpointCount: inst.checkpointManager.totalCheckpoints(),
      agentVersion: inst.agentVersion || null,
      createdAt: inst.createdAt,
      currentOperation: inst.currentOperation,
      operationCount: inst.operationHistory.length,
      parentNodeId: typeof inst.adapterState.parentNodeId === 'string' ? inst.adapterState.parentNodeId : undefined,
      instanceRole: inst.instanceRole,
      runtimeKind: inst.runtimeKind,
      pluginId: inst.pluginId,
    }));
  }
}

// ─── Helpers ───────────────────────────────────────────────

function labelFromDir(dir: string): string {
  const parts = dir.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || dir;
}

/** Type-safe getter for adapter-specific state */
export function getAdapterState<T = Record<string, unknown>>(inst: InstanceData, key: string, fallback?: T): T {
  return (inst.adapterState[key] as T) ?? fallback!;
}

/** Type-safe setter for adapter-specific state */
export function setAdapterState<T = unknown>(inst: InstanceData, key: string, value: T): void {
  inst.adapterState[key] = value;
}
