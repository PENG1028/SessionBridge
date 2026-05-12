// ─── Node Configuration ────────────────────────────────────────
// Unified config for all node roles (relay + agent + leaf).
// Loaded from (priority): CLI args, BRIDGE_CONFIG env var,
// ~/.sessionbridge/agent.json, defaults.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';
import type { PermissionConfig } from './permissions';

export interface NodeConfig {
  // Identity
  label: string;
  role: 'auto' | 'relay' | 'leaf';
  workingDirectory: string;

  /** Persistent node identifier (auto-generated on first start, survives restarts) */
  nodeId?: string;

  /** Node role tag for future mesh routing / permission scoping (e.g. "admin", "worker", "gateway") */
  nodeRole?: string;

  // Relay server (active when role resolves to 'relay')
  relayPort: number;
  relayBind: string;
  relayToken?: string;

  // Upstream relay (agent client connects to this; if absent and role=relay, uses loopback)
  upstreamRelay?: string;

  // Dashboard (always active)
  dashboardPort: number;
  dashboardBind: string;

  /** Dashboard access token (auto-generated on first start). Used as login password. */
  dashboardToken?: string;

  /** Enable dashboard authentication (default: true). Set to false to disable login. */
  dashboardAuthEnabled?: boolean;

  /** Dashboard session TTL in seconds (default: 1209600 = 14 days). */
  dashboardSessionTtl?: number;

  // Capabilities
  adapters?: string[];
  permissions?: PermissionConfig;
  notificationSettings?: Record<string, boolean>;
  ntfyTopic?: string;

  // Persistence
  logFile?: string;
  pidFile?: string;

  /** Extension bag — opaque config for devices / platforms / future features */
  extensions?: Record<string, unknown>;

  /** Path to the node identity file (~/.sessionbridge/identity.json by default) */
  identityPath?: string;

  /** Crypto/encryption configuration */
  crypto?: {
    /** Enable ECDH+AES-GCM encryption for WebSocket transport (default: true) */
    enabled: boolean;
  };

  /** Development mode (--dev flag). Enables extension host isolation and debugging. */
  devMode?: boolean;

  /** Additional extension directories to scan (--extensions flag). */
  extensionPaths?: string[];
}

const DEFAULT_CONFIG: NodeConfig = {
  label: '',
  role: 'auto',
  workingDirectory: process.cwd(),
  relayPort: 8080,
  relayBind: '0.0.0.0',
  dashboardPort: 9843,
  dashboardBind: '127.0.0.1',
  dashboardAuthEnabled: true,
  dashboardSessionTtl: 1209600, // 14 days
};

export function configDir(): string {
  const base = process.platform === 'win32'
    ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    : join(homedir(), '.sessionbridge');
  return join(base, 'session-bridge');
}

function loadJsonConfig(): Record<string, unknown> {
  try {
    const path = process.env.BRIDGE_CONFIG || join(configDir(), 'agent.json');
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf8'));
    }
  } catch { /* missing or malformed — use defaults */ }
  return {};
}

/** Resolve final config from all sources. */
export function resolveConfig(cliOverrides: Partial<NodeConfig> & { relayUrl?: string } = {}): NodeConfig {
  const json = loadJsonConfig();

  // Normalize: old configs may have relayUrl instead of upstreamRelay
  const upstreamRelay = cliOverrides.upstreamRelay
    || cliOverrides.relayUrl
    || (json.relayUrl as string | undefined)
    || (json.upstreamRelay as string | undefined)
    || undefined;

  const merged: NodeConfig = {
    ...DEFAULT_CONFIG,
    ...json as Partial<NodeConfig>,
    ...cliOverrides,
    upstreamRelay,
    // Ensure label is at least the hostname
    label: cliOverrides.label || (json.label as string) || '',
  };

  // Auto-generate persistent nodeId on first start, save back to config
  if (!merged.nodeId) {
    merged.nodeId = generateNodeId();
    persistNodeId(merged.nodeId);
  }

  return merged;
}

/** Generate a unique node identifier (32 hex chars). */
export function generateNodeId(): string {
  return randomBytes(16).toString('hex');
}

/** Persist nodeId into the JSON config file so it survives restarts. */
function persistNodeId(nodeId: string): void {
  try {
    const path = process.env.BRIDGE_CONFIG || join(configDir(), 'agent.json');
    let existing: Record<string, unknown> = {};
    try {
      if (existsSync(path)) {
        existing = JSON.parse(readFileSync(path, 'utf8'));
      }
    } catch { /* malformed — overwrite */ }
    existing.nodeId = nodeId;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(existing, null, 2), 'utf8');
  } catch (e) {
    console.warn(`[config] Failed to persist nodeId: ${e}`);
  }
}

// Backward compat re-export
export type AgentConfig = NodeConfig;
