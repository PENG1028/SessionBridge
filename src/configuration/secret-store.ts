// ─── Phase 4M: Secret Store ─────────────────────────────────────
// Layered secret storage, separate from ConfigurationStore.
//
// Secrets are NEVER returned in API responses — only existence checks.
// Storage is plain JSON on disk for now; encryption is future work.
//
// User file:  ~/.sessionbridge/secrets.json  (encrypted, future)
//
// Design notes:
//   - No workspace scope (Phase 1). Secrets are user-global.
//   - Never log secret values to console, audit, or anywhere.
//   - Atomic writes (tmp + rename) to mitigate corruption.

import { homedir } from 'os';
import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';

// ─── SecretStore ─────────────────────────────────────────────────

export class SecretStore {
  private secrets: Map<string, string> = new Map();
  private filePath: string;
  private loaded = false;

  constructor() {
    const dir = join(homedir(), '.sessionbridge');
    this.filePath = join(dir, 'secrets.json');
  }

  // ── Load / Save ─────────────────────────────────────────────

  /**
   * Load secrets from disk. Must be called before any read/write operations.
   * Corrupted JSON is handled gracefully (warn + empty).
   */
  load(): void {
    if (!existsSync(this.filePath)) {
      this.loaded = true;
      return;
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        this.secrets = new Map(Object.entries(parsed));
      } else {
        console.warn('[secrets] Invalid secrets file (not an object) — starting empty');
      }
    } catch (err) {
      console.warn('[secrets] Failed to read secrets file, starting empty:', (err as Error).message);
    }
    this.loaded = true;
  }

  /**
   * Persist all secrets to disk atomically (tmp + rename).
   */
  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const data: Record<string, string> = {};
    for (const [key, value] of this.secrets) {
      data[key] = value;
    }
    const tmpPath = this.filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(tmpPath, this.filePath);
  }

  // ── CRUD ────────────────────────────────────────────────────

  /**
   * Get a secret value by key.
   * Returns undefined if the key is not set.
   */
  get(key: string): string | undefined {
    this.ensureLoaded();
    return this.secrets.get(key);
  }

  /**
   * Check if a secret key exists.
   */
  has(key: string): boolean {
    this.ensureLoaded();
    return this.secrets.has(key);
  }

  /**
   * Set a secret value. Persists to disk.
   */
  set(key: string, value: string): void {
    this.ensureLoaded();
    this.secrets.set(key, value);
    this.save();
  }

  /**
   * Delete a secret by key. Persists to disk.
   * Idempotent — no-op if key doesn't exist.
   */
  delete(key: string): void {
    this.ensureLoaded();
    if (this.secrets.has(key)) {
      this.secrets.delete(key);
      this.save();
    }
  }

  /**
   * Return all known secret keys (not values).
   */
  keys(): string[] {
    this.ensureLoaded();
    return Array.from(this.secrets.keys());
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      this.load();
    }
  }
}

// ─── Singleton ─────────────────────────────────────────────────

export const secretStore = new SecretStore();
