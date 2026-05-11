// ─── Session Persistence ─────────────────────────────────────
// Persists InstanceManager state to disk so sessions survive
// relay restart. On restore, all instances come back as 'stopped'
// (the previous OS process died with the relay).
//
// Uses a debounced write (500 ms) to avoid thrashing the disk
// during bursts of instance state changes.

import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { InstanceManager } from './instance-manager';
import type { RelayEventBus } from '../extensions/types';
import { getDefaultAdapterId } from '../extensions/registry';

// ─── Types ─────────────────────────────────────────────────

export interface PersistedInstance {
  id: string;
  dir: string;
  label: string;
  /** Always restored as stopped — the OS process died with the relay. */
  status: 'stopped';
  source: 'local' | 'remote';
  adapterId: string;
  agentVersion?: string;
  createdAt: number;
  /** Timestamp set by restore() to mark when this instance was recovered. */
  restoredAt: number;
  /** Snapshot of the last in-flight operation, if any, at save time. */
  lastOperation?: { kind: string; status: string; command?: string };
}

export interface SessionSnapshot {
  version: 1;
  savedAt: number;
  activeId: string | null;
  instances: PersistedInstance[];
}

// ─── SessionPersistence ────────────────────────────────────

export class SessionPersistence {
  private filePath: string;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private eventBus?: RelayEventBus;

  /**
   * @param workDir  Root working directory.  The snapshot is stored at
   *                 `<workDir>/.sessionbridge/sessions.json`.
   * @param eventBus Optional RelayEventBus — `audit.log` events are emitted
   *                 on each successful save when provided.
   */
  constructor(workDir: string, eventBus?: RelayEventBus) {
    this.filePath = join(workDir, '.sessionbridge', 'sessions.json');
    this.eventBus = eventBus;
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Save instance state to disk (debounced — writes after 500 ms of
   * no further calls).  Safe to call in hot paths.
   */
  save(instanceManager: InstanceManager): void {
    this.dirty = true;

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.writeSnapshot(instanceManager);
    }, 500);
  }

  /**
   * Force an immediate write, clearing any pending debounced save.
   * Call this during graceful shutdown so no state is lost.
   */
  flush(instanceManager: InstanceManager): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.dirty) {
      this.writeSnapshot(instanceManager);
    }
  }

  /**
   * Restore instances from the last snapshot on disk.
   *
   * Returns `null` when:
   * - The snapshot file does not exist.
   * - The file contents are not valid JSON.
   * - The top-level structure is not a recognised snapshot.
   *
   * On success every `PersistedInstance.restoredAt` is set to `Date.now()`
   * so callers can distinguish freshly-restored instances.
   */
  restore(): SessionSnapshot | null {
    if (!existsSync(this.filePath)) {
      return null;
    }

    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf-8');
    } catch {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!isSessionSnapshot(parsed)) {
      return null;
    }

    const now = Date.now();
    // Stamp every instance with the restore time.
    const instances: PersistedInstance[] = parsed.instances.map((inst) => ({
      ...inst,
      restoredAt: now,
    }));

    return {
      version: parsed.version,
      savedAt: parsed.savedAt,
      activeId: parsed.activeId,
      instances,
    };
  }

  /**
   * Delete the snapshot file from disk (e.g. for a clean reset).
   * Safe to call when the file does not exist.
   */
  delete(): void {
    // Clear any pending write so it does not resurrect the file.
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.dirty = false;

    try {
      if (existsSync(this.filePath)) {
        unlinkSync(this.filePath);
      }
    } catch {
      // Best-effort — ignore permission errors etc.
    }
  }

  // ── Internal helpers ────────────────────────────────────

  /**
   * Build the snapshot from the live InstanceManager and persist to disk.
   */
  private writeSnapshot(instanceManager: InstanceManager): void {
    if (!this.dirty) return;

    const list = instanceManager.list();

    const persisted: PersistedInstance[] = list.map((inst) => ({
      id: inst.id,
      dir: inst.dir,
      label: inst.label,
      status: 'stopped' as const,
      source: inst.source,
      adapterId: inst.adapterId ?? getDefaultAdapterId(),
      agentVersion: inst.agentVersion,
      createdAt: inst.createdAt,
      restoredAt: 0, // placeholder — set by restore()
      lastOperation: inst.currentOperation
        ? {
            kind: inst.currentOperation.kind,
            status: inst.currentOperation.status,
            command: inst.currentOperation.command,
          }
        : undefined,
    }));

    const snapshot: SessionSnapshot = {
      version: 1,
      savedAt: Date.now(),
      activeId: instanceManager.activeId,
      instances: persisted,
    };

    // Ensure the parent directory exists.
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });

    writeFileSync(this.filePath, JSON.stringify(snapshot, null, 2), 'utf-8');

    this.dirty = false;

    // Emit audit event so other subsystems (e.g. audit-log) can react.
    this.eventBus?.emit('audit.log', {
      action: 'session.saved',
      detail: { instanceCount: persisted.length, activeId: snapshot.activeId },
      timestamp: snapshot.savedAt,
    });
  }
}

// ─── Type Guard ────────────────────────────────────────────

/**
 * Lightweight structural check so we do not blindly trust on-disk data.
 */
function isSessionSnapshot(value: unknown): value is SessionSnapshot {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.version === 1 &&
    typeof obj.savedAt === 'number' &&
    (obj.activeId === null || typeof obj.activeId === 'string') &&
    Array.isArray(obj.instances)
  );
}
