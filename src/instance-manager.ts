// ─── Instance Manager ───────────────────────────────────────
// Manages multiple Claude process instances, each with its own
// working directory, buffers, streaming state, and checkpoint manager.

import { CheckpointManager } from "./checkpoint-manager";
import type { ChildProcess } from "child_process";

// ─── Types ─────────────────────────────────────────────────

export type InstanceStatus = 'starting' | 'running' | 'stopped' | 'error';

export interface InstanceData {
  id: string;
  dir: string;
  label: string;
  status: InstanceStatus;
  process: ChildProcess | null;
  model: string | null;

  // Streaming state (reset per turn)
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

  // Metadata
  createdAt: number;
}

// ─── InstanceManager ───────────────────────────────────────

export class InstanceManager {
  private instances: Map<string, InstanceData> = new Map();
  private _activeId: string | null = null;
  private idCounter = 0;

  /** Create a new instance and register it */
  create(dir: string, label?: string): InstanceData {
    const id = `inst_${++this.idCounter}_${Date.now().toString(36)}`;
    const instance: InstanceData = {
      id,
      dir,
      label: label || labelFromDir(dir),
      status: 'starting',
      process: null,
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
    return this.instances.delete(id);
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
