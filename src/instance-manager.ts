// ─── Instance Manager ───────────────────────────────────────
// Manages multiple agent instances, each with its own working
// directory, buffers, adapter state, and checkpoint manager.
//
// Originally built for Claude, now supports any adapter via
// the `adapterState` generic state bag.

import { CheckpointManager } from "./checkpoint-manager";
import type { ChildProcess } from "child_process";
import type { WebSocket } from "ws";

// ─── Types ─────────────────────────────────────────────────

export type InstanceStatus = 'starting' | 'running' | 'stopped' | 'error';
export type InstanceSource = 'local' | 'remote';

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

  // Metadata
  createdAt: number;
  adapterId?: string;  // which adapter owns this instance
}

// ─── InstanceManager ───────────────────────────────────────

export class InstanceManager {
  private instances: Map<string, InstanceData> = new Map();
  private _activeId: string | null = null;
  private idCounter = 0;

  /** Create a new instance and register it */
  create(dir: string, label?: string, source?: InstanceSource, adapterId?: string): InstanceData {
    const id = `inst_${++this.idCounter}_${Date.now().toString(36)}`;
    const instance: InstanceData = {
      id,
      dir,
      label: label || labelFromDir(dir),
      status: 'starting',
      source: source || 'local',
      adapterId: adapterId || 'shell',
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
    };
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

  /** Serialise instance list for API responses (excludes process/buffer internals) */
  toJSON() {
    return this.list().map(inst => ({
      id: inst.id,
      dir: inst.dir,
      label: inst.label,
      status: inst.status,
      source: inst.source,
      adapterId: inst.adapterId || 'claude-code',
      model: inst.model,
      blockCount: inst.blockBuffer.length,
      outputSize: inst.outputSize,
      checkpointCount: inst.checkpointManager.totalCheckpoints(),
      createdAt: inst.createdAt,
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
