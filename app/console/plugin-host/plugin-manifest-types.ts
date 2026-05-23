'use client';

// ─── Plugin Manifest types — matches plugin.yaml schema ──

export interface PluginManifest {
  id: string;
  version: string;
  name?: string;
  description?: string;
  author?: string;
  type?: 'builtin' | 'feature';

  contributes?: PluginContributions;

  /** Declared capabilities (e.g. process.spawn, fs.read). */
  capabilities?: string[];

  /** Required binaries for this plugin. */
  requiredBinaries?: Array<{ name: string; version?: string; optional?: boolean }>;

  /** Go Core manifest core spec — permissions, env checks, files, tasks, history. */
  core?: PluginCoreSpec;
}

export interface PluginContributions {
  views?: Record<string, PluginViewContribution[]>;
  panels?: Record<string, PluginPanelContribution[]>;
  configuration?: PluginConfigurationContribution;
  commands?: PluginCommandContribution[];
  menus?: Record<string, PluginMenuItem[]>;
  status?: PluginStatusContribution[];
  notifications?: string[];
  approval?: PluginApprovalContribution[];
}

export interface PluginViewContribution {
  id: string;
  type: 'custom-react' | 'host-rendered';
  title: string;
  entry?: string;        // For custom-react
  componentId?: string;  // For host-rendered
  sandbox?: 'same-origin' | 'iframe';
}

export interface PluginPanelContribution {
  id: string;
  type: 'custom-react' | 'host-rendered';
  title: string;
  entry?: string;
  componentId?: string;
  sandbox?: 'same-origin' | 'iframe';
  icon?: string;
}

export interface PluginConfigurationContribution {
  title?: string;
  properties: Record<string, PluginConfigProperty>;
}

export interface PluginConfigProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object';
  default?: unknown;
  description?: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}

export interface PluginCommandContribution {
  id: string;
  title: string;
  shortcut?: string;
}

export interface PluginMenuItem {
  command: string;
  group?: string;
}

export interface PluginStatusContribution {
  id: string;
  label: string;
  icon?: string;
  onClick?: { command: string };
}

export interface PluginApprovalContribution {
  actionId: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  description?: string;
  timeout?: number;
}

// ─── Go Core Manifest Alignment Types ──────────────────────────

/** Core specification — maps to Go Core's CoreSpec. */
export interface PluginCoreSpec {
  permissions?: PluginPermissionSpec[];
  environment?: PluginEnvironmentSpec;
  files?: PluginFilesSpec;
  tasks?: PluginTaskSpec[];
  history?: PluginHistorySpec;
}

export interface PluginPermissionSpec {
  id: string;
  description: string;
  capabilities: string[];
  default: 'ask' | 'deny' | 'allow';
  constraints?: PluginPermissionConstraints;
}

export interface PluginPermissionConstraints {
  paths?: { allow?: string[]; deny?: string[] };
  targetNodes?: string[];
  env?: string[];
  network?: string[];
  resources?: { maxMemory?: string; maxCPU?: string; maxDisk?: string; maxProcess?: number };
}

export interface PluginEnvironmentSpec {
  checks: PluginEnvCheckSpec[];
}

export interface PluginEnvCheckSpec {
  id: string;
  type: 'binary' | 'env' | 'path' | 'file' | 'directory' | 'command';
  required?: boolean;
  command?: string;
  args?: string;
  versionCommand?: string;
  requiredVersion?: string;
  installHint?: string;
}

export interface PluginFilesSpec {
  config?: string;
  data?: string;
  cache?: string;
  logs?: string;
  artifacts?: string;
  declarations?: PluginFileDeclaration[];
}

export interface PluginFileDeclaration {
  id: string;
  path: string;
  description?: string;
  clearable: boolean;
  external?: boolean;
  risk?: 'low' | 'medium' | 'high';
}

export interface PluginTaskSpec {
  id: string;
  capability: string;
  planRequired: boolean;
  risk: 'low' | 'medium' | 'high';
}

export interface PluginHistorySpec {
  defaultPolicy?: 'memory' | 'disk' | 'none';
}
