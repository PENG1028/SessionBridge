// ─── State Persistence ───────────────────────────────────
// Replaces SurfacePersistence.  Persists all entries marked
// `persist: true` to disk as a single JSON snapshot.
//
// Restore loads them back into the StateBus on relay restart.

import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { StateEntry } from './types';

export interface StateSnapshot {
  version: 2;
  savedAt: number;
  entries: StateEntry[];
}

export class StateStorage {
  private filePath: string;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(workDir: string) {
    this.filePath = join(process.env.BRIDGE_DIR || workDir, '.sessionbridge', 'state.json');
  }

  /** Debounced save — safe to call in hot paths. */
  save(getEntries: () => StateEntry[]): void {
    this.dirty = true;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.writeSnapshot(getEntries());
    }, 500);
  }

  /** Force an immediate write. */
  flush(getEntries: () => StateEntry[]): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.dirty) this.writeSnapshot(getEntries());
  }

  /** Restore entries from disk. Returns empty array if no snapshot. */
  restore(): StateEntry[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as StateSnapshot;
      if (parsed.version !== 2) return [];
      return parsed.entries;
    } catch {
      return [];
    }
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

  private writeSnapshot(entries: StateEntry[]): void {
    if (!this.dirty) return;
    const persistable = entries.filter(e => e.persist !== false);
    const snapshot: StateSnapshot = {
      version: 2,
      savedAt: Date.now(),
      entries: persistable,
    };
    const dir = dirname(this.filePath);
    mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
    this.dirty = false;
  }
}
