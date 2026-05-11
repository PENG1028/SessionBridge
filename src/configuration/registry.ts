// ─── Phase 4M: Configuration Registry ──────────────────────────
// Singleton: aggregates configuration schemas from host and extensions.
// Host registrations take priority over extension registrations.
//
// Key namespace rule:
//   - Host keys: no prefix restriction.
//   - Extension keys: must start with `${extensionId}.`.

import type {
  ConfigurationContribution,
  ConfigurationPropertySchema,
} from './types';

// ─── Types ─────────────────────────────────────────────────────

interface SchemaEntry {
  schema: ConfigurationPropertySchema;
  source: 'host' | string; // string = extension ID
}

// ─── Registry ──────────────────────────────────────────────────

export class ConfigurationRegistry {
  private hostContributions = new Map<string, ConfigurationContribution>();
  private extensionContributions = new Map<string, ConfigurationContribution>();
  private allProperties = new Map<string, SchemaEntry>();

  // ── Registration ────────────────────────────────────────────

  /**
   * Register host/core configuration properties.
   * Host keys have no namespace restrictions and take priority over extensions.
   */
  registerHost(
    id: string,
    title: string,
    properties: Record<string, ConfigurationPropertySchema>,
  ): void {
    const contribution: ConfigurationContribution = {
      extensionId: id,
      title,
      properties: { ...properties },
    };
    this.hostContributions.set(id, contribution);

    for (const [key, schema] of Object.entries(properties)) {
      this.allProperties.set(key, { schema, source: 'host' });
    }
  }

  /**
   * Register extension configuration properties.
   * All keys MUST start with `${extensionId}.`.
   * If a key is already registered (host-owned), the extension's version is
   * skipped with a warning.
   *
   * Throws if any key violates the namespace rule.
   */
  registerExtension(
    id: string,
    title: string,
    properties: Record<string, ConfigurationPropertySchema>,
  ): void {
    // Validate namespace
    const prefix = `${id}.`;
    const invalidKeys: string[] = [];
    for (const key of Object.keys(properties)) {
      if (!key.startsWith(prefix)) {
        invalidKeys.push(key);
      }
    }
    if (invalidKeys.length > 0) {
      throw new Error(
        `Configuration keys for extension "${id}" must start with "${prefix}": ${invalidKeys.join(', ')}`,
      );
    }

    const contribution: ConfigurationContribution = {
      extensionId: id,
      title,
      properties: { ...properties },
    };
    this.extensionContributions.set(id, contribution);

    for (const [key, schema] of Object.entries(properties)) {
      if (this.allProperties.has(key)) {
        const existing = this.allProperties.get(key)!;
        console.warn(
          `[config] Skipping duplicate key "${key}" from extension "${id}" — already registered by "${existing.source}"`,
        );
        continue;
      }
      this.allProperties.set(key, { schema, source: id });
    }
  }

  // ── Queries ─────────────────────────────────────────────────

  /** Look up the schema for a single configuration key. */
  getSchema(key: string): ConfigurationPropertySchema | undefined {
    return this.allProperties.get(key)?.schema;
  }

  /** Get all contributions (host + extension merged). */
  getAllContributions(): ConfigurationContribution[] {
    const result: ConfigurationContribution[] = [];
    for (const c of this.hostContributions.values()) {
      result.push(c);
    }
    for (const c of this.extensionContributions.values()) {
      result.push(c);
    }
    return result;
  }

  /** Get all known properties as a flat key→schema map. */
  getAllProperties(): Record<string, ConfigurationPropertySchema> {
    const result: Record<string, ConfigurationPropertySchema> = {};
    for (const [key, entry] of this.allProperties) {
      result[key] = entry.schema;
    }
    return result;
  }

  /** Get a contribution by extension/host ID. */
  getContribution(id: string): ConfigurationContribution | undefined {
    return this.hostContributions.get(id) ?? this.extensionContributions.get(id);
  }
}

// ─── Singleton ─────────────────────────────────────────────────

export const configRegistry = new ConfigurationRegistry();
