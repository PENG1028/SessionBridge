// ─── Checkpoint Manager (file-snapshot based) ────────────────

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { isAbsolute, resolve } from "path";

export interface FileSnapshot {
  filePath: string;
  content: string;
  exists: boolean;
}

export interface Checkpoint {
  id: string;
  turnNumber: number;
  toolUseId: string;
  toolName: string;
  filePath: string;
  snapshots: FileSnapshot[];
  timestamp: number;
  /** Text we expect to find in the file (for Edit tools — verifies this checkpoint is still valid) */
  expectedText?: string;
}

export class CheckpointManager {
  private rootDir: string;
  private checkpoints: Checkpoint[] = [];
  private turnStartIndex = 0;
  private readonly MAX_CHECKPOINTS = 100;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  setRootDir(dir: string): void {
    this.rootDir = dir;
  }

  getRootDir(): string {
    return this.rootDir;
  }

  startNewTurn(): void {
    this.turnStartIndex = this.checkpoints.length;
  }

  private snapshotFile(absPath: string): FileSnapshot | null {
    try {
      if (!absPath.startsWith(this.rootDir)) return null;
      const exists = existsSync(absPath);
      const content = exists ? readFileSync(absPath, "utf8") : "";
      return { filePath: absPath, content, exists };
    } catch {
      return null;
    }
  }

  createCheckpoint(
    toolUseId: string,
    toolName: string,
    filePath: string,
    oldString?: string
  ): Checkpoint | null {
    const absPath = isAbsolute(filePath) ? filePath : resolve(this.rootDir, filePath);
    const snap = this.snapshotFile(absPath);
    if (!snap) return null;

    const cp: Checkpoint = {
      id: "cp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      turnNumber: this.checkpoints.filter(
        c => c.turnNumber <= (this.checkpoints[this.turnStartIndex]?.turnNumber ?? 0)
      ).length,
      toolUseId,
      toolName,
      filePath: absPath,
      snapshots: [snap],
      timestamp: Date.now(),
      expectedText: oldString,
    };

    this.checkpoints.push(cp);
    if (this.checkpoints.length > this.MAX_CHECKPOINTS) {
      const removed = this.checkpoints.splice(0, this.checkpoints.length - this.MAX_CHECKPOINTS);
      this.turnStartIndex = Math.max(0, this.turnStartIndex - removed.length);
    }

    return cp;
  }

  private restoreCheckpoint(cp: Checkpoint): boolean {
    try {
      if (cp.expectedText && existsSync(cp.filePath)) {
        const current = readFileSync(cp.filePath, "utf8");
        if (!current.includes(cp.expectedText)) return false;
      }

      for (const snap of cp.snapshots) {
        if (snap.exists) {
          writeFileSync(snap.filePath, snap.content, "utf8");
        } else {
          if (existsSync(snap.filePath)) unlinkSync(snap.filePath);
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /** Rewind all checkpoints from the current turn */
  rewindCurrentTurn(): { restored: number; failed: number; skipped: number } {
    let restored = 0, failed = 0, skipped = 0;
    while (this.checkpoints.length > this.turnStartIndex) {
      const cp = this.checkpoints.pop()!;
      if (this.restoreCheckpoint(cp)) restored++;
      else if (cp.expectedText) skipped++;
      else failed++;
    }
    return { restored, failed, skipped };
  }

  /** Rewind the single most recent checkpoint */
  rewindLastCheckpoint(): { success: boolean; checkpoint?: Checkpoint } {
    if (this.checkpoints.length === 0 || this.checkpoints.length <= this.turnStartIndex) {
      return { success: false };
    }
    const cp = this.checkpoints.pop()!;
    const ok = this.restoreCheckpoint(cp);
    return { success: ok, checkpoint: cp };
  }

  countCurrentTurnCheckpoints(): number {
    return this.checkpoints.length - this.turnStartIndex;
  }

  totalCheckpoints(): number {
    return this.checkpoints.length;
  }

  getTurnStartIndex(): number {
    return this.turnStartIndex;
  }

  getCheckpoints(): Checkpoint[] {
    return this.checkpoints;
  }

  getCurrentTurnCheckpoints(): Checkpoint[] {
    return this.checkpoints.slice(this.turnStartIndex);
  }

  clear(): void {
    this.checkpoints = [];
    this.turnStartIndex = 0;
  }
}
