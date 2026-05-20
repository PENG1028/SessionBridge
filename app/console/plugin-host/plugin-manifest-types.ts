'use client';

// ─── Plugin Manifest types — matches sb-extension.json schema ──

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
