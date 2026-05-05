// ─── Agent Configuration ───────────────────────────────────────
// Loaded from (priority): CLI args, SB_CONFIG env var,
// ~/.sessionbridge/agent.json, defaults.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { PermissionConfig } from './permissions';

export interface AgentConfig {
  relayUrl: string;
  relayToken?: string;
  label: string;
  workingDirectory: string;
  dashboardPort: number;
  dashboardBind: string;
  adapters?: string[];
  permissions?: PermissionConfig;
  notificationSettings?: Record<string, boolean>;
  ntfyTopic?: string;
  logFile?: string;
  pidFile?: string;
}

const DEFAULT_CONFIG: AgentConfig = {
  relayUrl: 'ws://localhost:8080',
  label: '',
  workingDirectory: process.cwd(),
  dashboardPort: 9843,
  dashboardBind: '127.0.0.1',
};

function configDir(): string {
  const base = process.platform === 'win32'
    ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    : join(homedir(), '.sessionbridge');
  return join(base, 'session-bridge');
}

function loadJsonConfig(): Partial<AgentConfig> {
  try {
    const path = process.env.SB_CONFIG || join(configDir(), 'agent.json');
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf8'));
    }
  } catch { /* missing or malformed — use defaults */ }
  return {};
}

/** Resolve final config from all sources. */
export function resolveConfig(cliOverrides: Partial<AgentConfig> = {}): AgentConfig {
  const json = loadJsonConfig();
  return { ...DEFAULT_CONFIG, ...json, ...cliOverrides };
}
