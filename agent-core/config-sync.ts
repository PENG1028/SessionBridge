// ─── Config Sync ────────────────────────────────────────────────
// Relay-to-agent configuration push infrastructure.
//
// RelayConfigManager: schedules and tracks config changes to push
// to connected agents.
// AgentConfigReceiver: validates and applies config pushes from
// the relay, rejecting unknown or restart-required keys.

import type { RelayEventBus } from '../extensions/types';
import type { NodeConfig } from './config';
import type { RelayConnection } from './relay-connection';

// ─── Shared Types ───────────────────────────────────────────────

export interface ConfigSyncEntry {
  key: string;
  value: unknown;
  source: 'relay' | 'agent' | 'default';
  updatedAt: number;
}

export interface ConfigPushMessage {
  entries: { key: string; value: unknown }[];
  requestId: string;
}

export interface ConfigPushResult {
  requestId: string;
  applied: string[];
  rejected: { key: string; reason: string }[];
}

// ─── Key Validation ─────────────────────────────────────────────

/**
 * All recognised NodeConfig field names.
 * Used to distinguish unknown keys from known-but-rejected keys.
 */
const KNOWN_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'label',
  'role',
  'workingDirectory',
  'relayPort',
  'relayBind',
  'relayToken',
  'upstreamRelay',
  'dashboardPort',
  'dashboardBind',
  'adapters',
  'permissions',
  'notificationSettings',
  'ntfyTopic',
  'logFile',
  'pidFile',
]);

/**
 * Keys that cannot be hot-reloaded — changing them requires a
 * process restart so push attempts are rejected.
 */
const RESTART_REQUIRED_KEYS: ReadonlySet<string> = new Set([
  'role',
  'relayPort',
  'relayBind',
  'dashboardPort',
  'dashboardBind',
]);

// ─── Relay Side — RelayConfigManager ────────────────────────────

export class RelayConfigManager {
  private pending: Map<string, ConfigSyncEntry> = new Map();
  private requestCounter = 0;

  constructor(private eventBus?: RelayEventBus) {}

  /** Schedule a single config change to be pushed to connected agents. */
  set(key: string, value: unknown, source: ConfigSyncEntry['source'] = 'relay'): void {
    this.pending.set(key, {
      key,
      value,
      source,
      updatedAt: Date.now(),
    });
  }

  /** Queue a batch of config changes. */
  setBatch(
    entries: { key: string; value: unknown }[],
    source: ConfigSyncEntry['source'] = 'relay',
  ): void {
    for (const entry of entries) {
      this.set(entry.key, entry.value, source);
    }
  }

  /**
   * Build a push message from all pending entries.
   * Note: the caller is responsible for clearing entries once
   * agents acknowledge them (see `ack`).
   */
  getPending(): ConfigPushMessage {
    const entries = Array.from(this.pending.values()).map(
      ({ key, value }) => ({ key, value }),
    );
    const requestId = `cfg-${++this.requestCounter}-${Date.now()}`;
    return { entries, requestId };
  }

  /**
   * Acknowledge that a specific agent applied the given keys.
   * Those keys are removed from the pending set.
   */
  ack(_agentInstanceId: string, keys: string[]): void {
    for (const key of keys) {
      this.pending.delete(key);
    }
  }

  /** Return all pending entries (for introspection / debugging). */
  getAllPending(): ConfigSyncEntry[] {
    return Array.from(this.pending.values());
  }
}

// ─── Agent Side — AgentConfigReceiver ───────────────────────────

export class AgentConfigReceiver {
  constructor(
    private config: NodeConfig,
    private applyFn?: (key: string, value: unknown) => void,
    private eventBus?: RelayEventBus,
  ) {}

  /**
   * Validate and apply a config push from the relay.
   *
   * Rules:
   *  - Unknown keys are rejected with reason `"unknown_key"`.
   *  - Keys that require a restart (`role`, bind/port settings) are
   *    rejected with reason `"requires_restart"`.
   *  - All other known keys are applied immediately: the NodeConfig
   *    object is mutated, the `applyFn` callback is invoked, and a
   *    `"config.updated"` event is emitted on the EventBus (if one
   *    was provided).
   */
  apply(push: ConfigPushMessage): ConfigPushResult {
    const applied: string[] = [];
    const rejected: { key: string; reason: string }[] = [];

    for (const { key, value } of push.entries) {
      // ── Unknown key ──────────────────────────────────────
      if (!KNOWN_CONFIG_KEYS.has(key)) {
        rejected.push({ key, reason: 'unknown_key' });
        continue;
      }

      // ── Restart-required key ─────────────────────────────
      if (RESTART_REQUIRED_KEYS.has(key)) {
        rejected.push({ key, reason: 'requires_restart' });
        continue;
      }

      // ── Apply ────────────────────────────────────────────
      (this.config as unknown as Record<string, unknown>)[key] = value;
      this.applyFn?.(key, value);
      applied.push(key);

      this.eventBus?.emit('config.updated', {
        key,
        value,
        source: 'relay',
      });
    }

    return {
      requestId: push.requestId,
      applied,
      rejected,
    };
  }

  /** Send an acknowledgement back to the relay via the connection. */
  sendAck(
    connection: RelayConnection,
    requestId: string,
    result: ConfigPushResult,
  ): void {
    connection.sendConfigAck(requestId, result.applied, result.rejected);
  }
}
