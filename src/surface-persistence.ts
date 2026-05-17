// ─── Surface Persistence ──────────────────────────────────────
// Persists SurfaceManager state to disk so surfaces, runtime
// replay buffers, and keep flags survive relay restart.
//
// On restore, all surfaces are marked `orphaned: true` because
// the runtime processes died with the relay. Agent inventory
// reports (Phase 3) re-validate and clear the orphaned flag.
//
// Uses a debounced write (500 ms) to avoid disk thrashing.

import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { SurfaceManager, SurfaceDebugEvent } from './surface-manager';
import type { ReplayPolicy, RuntimeOutputChunk, RuntimeEvent } from '../extensions/types';

// ─── Types ─────────────────────────────────────────────────

export interface PersistedSurfaceData {
  surfaceId: string;
  nodeId: string;
  title: string;
  viewType: string;
  scope: string;
  shared: boolean;
  runtimeRef: {
    kind: string;
    instanceId?: string;
    operationId?: string;
    pluginId?: string;
  };
  replayPolicy: ReplayPolicy;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  keep: boolean;
  orphaned: boolean;
  /** Trimmed output buffer for replay restoration (cap at 1000 chunks / 128KB). */
  outputBuffer: RuntimeOutputChunk[];
  /** Trimmed event buffer. */
  eventBuffer: RuntimeEvent[];
  runtimeStatus: string;
}

export interface SurfaceSnapshot {
  version: 1;
  savedAt: number;
  surfaces: PersistedSurfaceData[];
}

const MAX_PERSIST_CHUNKS = 1000;
const MAX_PERSIST_BYTES = 128 * 1024;

// ─── SurfacePersistence ─────────────────────────────────────

export class SurfacePersistence {
  private filePath: string;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(workDir: string) {
    this.filePath = join(process.env.BRIDGE_DIR || workDir, '.sessionbridge', 'surfaces.json');
  }

  // ── Public API ──────────────────────────────────────────

  /** Debounced save — safe to call in hot paths. */
  save(surfaceManager: SurfaceManager): void {
    this.dirty = true;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.writeSnapshot(surfaceManager);
    }, 500);
  }

  /** Force an immediate write, clearing any pending debounced save. */
  flush(surfaceManager: SurfaceManager): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.dirty) this.writeSnapshot(surfaceManager);
  }

  /** Restore surfaces from disk. Returns null if no snapshot exists. */
  restore(): SurfaceSnapshot | null {
    if (!existsSync(this.filePath)) return null;

    let raw: string;
    try { raw = readFileSync(this.filePath, 'utf-8'); } catch { return null; }

    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return null; }

    if (!isSurfaceSnapshot(parsed)) return null;

    return {
      version: parsed.version,
      savedAt: parsed.savedAt,
      surfaces: parsed.surfaces.map(s => ({ ...s, orphaned: true })),
    };
  }

  /** Delete the snapshot file (clean reset). */
  delete(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.dirty = false;
    try { if (existsSync(this.filePath)) unlinkSync(this.filePath); } catch {}
  }

  // ── Internal ───────────────────────────────────────────

  private writeSnapshot(surfaceManager: SurfaceManager): void {
    if (!this.dirty) return;

    const allSurfaces = surfaceManager.listAll();
    const allRuntime = surfaceManager.listAllRuntimeStates();
    const persisted: PersistedSurfaceData[] = [];

    for (const surface of allSurfaces) {
      const rt = allRuntime.get(surface.surfaceId);
      // Trim output buffer for disk
      let outputBuffer = rt?.outputBuffer ?? [];
      let eventBuffer = rt?.eventBuffer ?? [];
      if (outputBuffer.length > MAX_PERSIST_CHUNKS) {
        outputBuffer = outputBuffer.slice(outputBuffer.length - MAX_PERSIST_CHUNKS);
      }
      let totalBytes = 0;
      for (const c of outputBuffer) totalBytes += c.data.length;
      while (totalBytes > MAX_PERSIST_BYTES && outputBuffer.length > 0) {
        const removed = outputBuffer.shift()!;
        totalBytes -= removed.data.length;
      }

      persisted.push({
        surfaceId: surface.surfaceId,
        nodeId: surface.nodeId,
        title: surface.title,
        viewType: surface.viewType,
        scope: surface.scope,
        shared: surface.shared,
        runtimeRef: {
          kind: surface.runtimeRef.kind,
          instanceId: surface.runtimeRef.instanceId,
          operationId: surface.runtimeRef.operationId,
          pluginId: surface.runtimeRef.pluginId,
        },
        replayPolicy: surface.replayPolicy,
        createdBy: surface.createdBy,
        createdAt: surface.createdAt,
        updatedAt: surface.updatedAt,
        keep: surface.keep ?? false,
        orphaned: surface.orphaned ?? false,
        outputBuffer,
        eventBuffer,
        runtimeStatus: rt?.status ?? 'starting',
      });
    }

    const snapshot: SurfaceSnapshot = { version: 1, savedAt: Date.now(), surfaces: persisted };

    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
    this.dirty = false;
  }
}

// ─── Type Guard ───────────────────────────────────────────

function isSurfaceSnapshot(value: unknown): value is SurfaceSnapshot {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return obj.version === 1 && typeof obj.savedAt === 'number' && Array.isArray(obj.surfaces);
}
