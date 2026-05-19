// ─── Phase 4M: Configuration System Types ──────────────────────
//
// Configuration scope: layered persistence model.
// Phase 4M implements 'default' | 'user' | 'workspace'.
// Future: node, device, instance, session.

export type ConfigurationScope = 'default' | 'user' | 'workspace';

/** Schema for a single configuration property. */
export interface ConfigurationPropertySchema {
  type: 'string' | 'boolean' | 'integer' | 'number' | 'array' | 'object';
  default?: unknown;
  description?: string;
  /** Enum of allowed values (type must match the property type). */
  enum?: unknown[];
  enumDescriptions?: string[];
  /** Minimum value (for integer/number). */
  minimum?: number;
  /** Maximum value (for integer/number). */
  maximum?: number;
  /**
   * Which scope this property belongs to.
   * Defaults to 'workspace' if unspecified.
   */
  scope?: ConfigurationScope;
  /** Tags for categorization in the UI. */
  tags?: string[];
  /** Whether changing the value requires restarting the process. */
  requiresRestart?: boolean;
  /** Whether the property is deprecated. String value provides a migration hint. */
  deprecated?: boolean | string;
  /** Whether the value should be masked in the UI. */
  secret?: boolean;
  /** Experimental feature flag. */
  experimental?: boolean;
}

/** A configuration contribution from an extension or host. */
export interface ConfigurationContribution {
  extensionId: string;
  title: string;
  properties: Record<string, ConfigurationPropertySchema>;
}

/** Layered inspect result for a single configuration key. */
export interface ConfigurationInspectResult {
  key: string;
  defaultValue: unknown;
  /** undefined if not set at this scope. */
  userValue?: unknown;
  /** undefined if not set at this scope. */
  workspaceValue?: unknown;
  effectiveValue: unknown;
  schema: ConfigurationPropertySchema;
  /** Which scope the effective value resolved from. */
  source: ConfigurationScope;
}
