// ─── App Registry Types ────────────────────────────────────────────
// UI-owned app manifest system. Replaces the removed Core plugin.* API.
// Apps are declared in plugins/*/plugin.yaml and read by the Next.js
// server, not by Go Core.

// ─── Manifest ─────────────────────────────────────────────────────
export interface AppManifest {
  id: string;
  name: string;
  version: string;
  type: 'plugin' | 'system';
  trusted: boolean;
  description?: string;
  author?: string;
  core: AppCoreSpec;
  adapters: AppAdapters;
}

export interface AppCoreSpec {
  permissions: AppPermissionSpec[];
  environment?: AppEnvironmentSpec;
  files?: AppFilesSpec;
  history?: AppHistorySpec;
}

export interface AppPermissionSpec {
  id: string;
  description?: string;
  capabilities: string[];
  default: 'ask' | 'deny' | 'allow';
  constraints?: AppPermissionConstraints;
}

export interface AppPermissionConstraints {
  targetNodes?: string[];
}

export interface AppEnvironmentSpec {
  checks: AppEnvCheckSpec[];
}

export interface AppEnvCheckSpec {
  id: string;
  type: string;
  required: boolean;
  command?: string;
  args?: string[];
  installHint?: string;
}

export interface AppFilesSpec {
  logs?: string;
  config?: string;
  data?: string;
  cache?: string;
  artifacts?: string;
  declarations?: AppFileDecl[];
}

export interface AppFileDecl {
  id: string;
  path: string;
  description?: string;
  clearable?: boolean;
}

export interface AppHistorySpec {
  defaultPolicy: string;
}

// ─── Adapters ─────────────────────────────────────────────────────
export interface AppAdapters {
  'system-ui'?: AppSystemUI;
}

export interface AppSystemUI {
  views?: AppUIView[];
  panels?: AppUIPanel[];
  commands?: AppUICommand[];
  status?: AppUIStatus[];
  settings?: Record<string, unknown>;
}

export interface AppUIView {
  id: string;
  surface: string;
  type: string;
  entry?: string;
  componentId?: string;
  title?: string;
  icon?: string;
}

export interface AppUIPanel {
  id: string;
  surface: string;
  type: string;
  entry?: string;
  componentId?: string;
  title?: string;
  icon?: string;
  /** When-condition for panel visibility (e.g. 'activeAdapterId != ""'). */
  when?: string;
  /** Display order within the sidebar (lower = first). */
  order?: number;
}

export interface AppUICommand {
  id: string;
  title: string;
  command?: string;
}

export interface AppUIStatus {
  id: string;
  label: string;
  icon?: string;
  command?: string;
}

// ─── Summary (for list view) ──────────────────────────────────────
export interface AppSummary {
  id: string;
  name: string;
  version: string;
  type: 'plugin' | 'system';
  trusted: boolean;
  enabled: boolean;
  description?: string;
  capabilities: string[];
}

// ─── App State (stored per-app) ───────────────────────────────────
export interface AppState {
  enabled: boolean;
  /** Timestamp of last state change (ms). */
  updatedAt: number;
  /** Capability → grant mode. Written by the permission management UI. */
  grants: Record<string, AppGrantEntry>;
}

export interface AppGrantEntry {
  mode: 'allow' | 'deny' | 'ask';
  grantedAt: number;
}

// ─── Dependency Checking ─────────────────────────────────────────

export interface CheckResult {
  id: string;
  type: string;
  command: string;
  found: boolean;
  version?: string;
  path?: string;
  error?: string;
  required: boolean;
  installHint?: string;
  /** Cascading: if a parent dependency is missing, this check is blocked. */
  blockedBy?: string;
}

// ─── Install History ─────────────────────────────────────────────

export interface InstallRecord {
  installId: string;
  appId: string;
  checkId: string;
  command: string;
  status: 'running' | 'success' | 'failed';
  startedAt: number;
  finishedAt?: number;
  stdout?: string;
  stderr?: string;
}
