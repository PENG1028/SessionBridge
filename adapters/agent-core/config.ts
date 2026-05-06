// ─── Node Configuration ────────────────────────────────────────
// Unified config for all node roles (relay + agent + leaf).
// Loaded from (priority): CLI args, BRIDGE_CONFIG env var,
// ~/.sessionbridge/agent.json, defaults.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { PermissionConfig } from './permissions';

export interface NodeConfig {
  // Identity
  label: string;
  role: 'auto' | 'relay' | 'leaf';
  workingDirectory: string;

  // Relay server (active when role resolves to 'relay')
  relayPort: number;
  relayBind: string;
  relayToken?: string;

  // Upstream relay (agent client connects to this; if absent and role=relay, uses loopback)
  upstreamRelay?: string;

  // Dashboard (always active)
  dashboardPort: number;
  dashboardBind: string;

  // Capabilities
  adapters?: string[];
  permissions?: PermissionConfig;
  notificationSettings?: Record<string, boolean>;
  ntfyTopic?: string;

  // Persistence
  logFile?: string;
  pidFile?: string;
}

const DEFAULT_CONFIG: NodeConfig = {
  label: '',
  role: 'auto',
  workingDirectory: process.cwd(),
  relayPort: 8080,
  relayBind: '0.0.0.0',
  dashboardPort: 9843,
  dashboardBind: '127.0.0.1',
};

export function configDir(): string {
  const base = process.platform === 'win32'
    ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    : join(homedir(), '.sessionbridge');
  return join(base, 'session-bridge');
}

function loadJsonConfig(): Record<string, unknown> {
  try {
    const path = process.env.BRIDGE_CONFIG || process.env.SB_CONFIG || join(configDir(), 'agent.json');
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

  return merged;
}

// Backward compat re-export
export type AgentConfig = NodeConfig;
