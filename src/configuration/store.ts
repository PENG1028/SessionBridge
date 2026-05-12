// ─── Phase 4M: Configuration Store ─────────────────────────────
// Singleton: layered persistent storage for user and workspace scopes.
//
// Resolution: workspace ?? user ?? default
//
// User file:  ~/.sessionbridge/settings.json
// Workspace:  <workspace>/.sessionbridge/settings.json (optional)

import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { configDir } from '../../agent-core/config';
import type {
  ConfigurationScope,
  ConfigurationPropertySchema,
  ConfigurationInspectResult,
} from './types';

// ─── Store ─────────────────────────────────────────────────────

export class ConfigurationStore {
  private userSettings: Record<string, unknown> = {};
  private workspaceSettings: Record<string, unknown> = {};
  private userPath: string;
  private workspacePath: string | null = null;
  private loaded = false;

  constructor() {
    this.userPath = join(configDir(), 'settings.json');
  }

  /**
   * Set the workspace directory for workspace-scoped settings.
   * Call this after the workspace is determined.
   */
  setWorkspaceDir(workspaceDir?: string): void {
    if (workspaceDir) {
      this.workspacePath = join(workspaceDir, '.sessionbridge', 'settings.json');
    }
  }

  // ── Load / Save ─────────────────────────────────────────────

  /**
   * Load settings from disk. Must be called before any read/write operations.
   * Corrupted JSON files are handled gracefully (warn + empty).
   */
  load(): void {
    this.userSettings = this.readFileSafe(this.userPath);
    this.workspaceSettings = this.workspacePath
      ? this.readFileSafe(this.workspacePath)
      : {};
    this.loaded = true;
  }

  private readFileSafe(filePath: string): Record<string, unknown> {
    if (!existsSync(filePath)) return {};
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      console.warn(`[config] Invalid settings file (not an object): ${filePath}`);
      return {};
    } catch (err) {
      console.warn(`[config] Failed to read settings file: ${filePath}`, (err as Error).message);
      return {};
    }
  }

  /**
   * Atomically save settings for a given scope.
   * Writes to a .tmp file first, then renames to mitigate corruption.
   */
  save(scope: 'user' | 'workspace'): void {
    const filePath = scope === 'user' ? this.userPath : this.workspacePath;
    if (!filePath) return;
    const data = scope === 'user' ? this.userSettings : this.workspaceSettings;

    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const tmpPath = filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    renameSync(tmpPath, filePath);
  }

  // ── Read ────────────────────────────────────────────────────

  getUserValue(key: string): unknown | undefined {
    this.ensureLoaded();
    return this.userSettings[key];
  }

  getWorkspaceValue(key: string): unknown | undefined {
    this.ensureLoaded();
    return this.workspaceSettings[key];
  }

  /**
   * Resolve the effective value: workspace ?? user ?? default.
   */
  getEffectiveValue(
    key: string,
    schema: ConfigurationPropertySchema,
  ): { value: unknown; source: ConfigurationScope } {
    this.ensureLoaded();
    if (this.workspacePath && key in this.workspaceSettings) {
      return { value: this.workspaceSettings[key], source: 'workspace' };
    }
    if (key in this.userSettings) {
      return { value: this.userSettings[key], source: 'user' };
    }
    return { value: schema.default, source: 'default' };
  }

  /** Return all raw values at a given scope. */
  getAllRaw(scope: 'user' | 'workspace'): Record<string, unknown> {
    this.ensureLoaded();
    if (scope === 'user') return { ...this.userSettings };
    return { ...this.workspaceSettings };
  }

  // ── Write ───────────────────────────────────────────────────

  /**
   * Set a value at the given scope.
   * Throws if scope is 'default' (read-only).
   * Auto-saves the affected file.
   */
  set(scope: 'user' | 'workspace', key: string, value: unknown): void {
    this.ensureLoaded();
    if (scope === 'user') {
      this.userSettings[key] = value;
    } else {
      this.workspaceSettings[key] = value;
    }
    this.save(scope);
  }

  /**
   * Remove a value at the given scope (revert to lower scope/default).
   * Idempotent — no-op if key doesn't exist at this scope.
   */
  remove(scope: 'user' | 'workspace', key: string): void {
    this.ensureLoaded();
    const target = scope === 'user' ? this.userSettings : this.workspaceSettings;
    if (key in target) {
      delete target[key];
      this.save(scope);
    }
  }

  // ── Validation ──────────────────────────────────────────────

  /**
   * Validate a value against its schema.
   * Returns an array of error messages (empty = valid).
   */
  validateValue(schema: ConfigurationPropertySchema, value: unknown): string[] {
    const errors: string[] = [];

    // Type check
    switch (schema.type) {
      case 'string':
        if (typeof value !== 'string') errors.push(`Expected string, got ${typeof value}`);
        break;
      case 'boolean':
        if (typeof value !== 'boolean') errors.push(`Expected boolean, got ${typeof value}`);
        break;
      case 'integer':
        if (!Number.isInteger(value)) errors.push(`Expected integer, got ${typeof value} ${JSON.stringify(value)}`);
        break;
      case 'number':
        if (typeof value !== 'number') errors.push(`Expected number, got ${typeof value}`);
        break;
      case 'array':
        if (!Array.isArray(value)) errors.push('Expected array');
        break;
      case 'object':
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          errors.push('Expected object');
        }
        break;
    }

    // No further checks if basic type check failed
    if (errors.length > 0) return errors;

    // Enum check
    if (schema.enum !== undefined) {
      if (!schema.enum.some(e => e === value)) {
        errors.push(`Value must be one of: ${schema.enum.map(String).join(', ')}`);
      }
    }

    // Min/max for numeric types
    if (schema.type === 'integer' || schema.type === 'number') {
      const num = value as number;
      if (schema.minimum !== undefined && num < schema.minimum) {
        errors.push(`Value must be >= ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && num > schema.maximum) {
        errors.push(`Value must be <= ${schema.maximum}`);
      }
    }

    return errors;
  }

  // ── Inspect ─────────────────────────────────────────────────

  /** Get the layered view of a configuration key. */
  inspect(key: string, schema: ConfigurationPropertySchema): ConfigurationInspectResult {
    this.ensureLoaded();
    const userValue = key in this.userSettings ? this.userSettings[key] : undefined;
    const workspaceValue = this.workspacePath && key in this.workspaceSettings
      ? this.workspaceSettings[key]
      : undefined;
    const effective = workspaceValue !== undefined
      ? { value: workspaceValue, source: 'workspace' as ConfigurationScope }
      : userValue !== undefined
        ? { value: userValue, source: 'user' as ConfigurationScope }
        : { value: schema.default, source: 'default' as ConfigurationScope };

    return {
      key,
      defaultValue: schema.default,
      userValue,
      workspaceValue,
      effectiveValue: effective.value,
      schema,
      source: effective.source,
    };
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      this.load();
    }
  }
}

// ─── Singleton ─────────────────────────────────────────────────

export const configStore = new ConfigurationStore();
