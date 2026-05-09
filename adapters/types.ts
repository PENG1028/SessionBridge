// ─── Remote Agent Console — Core Type Definitions ──────────────────
// These types define the object model and adapter contract.
// No implementation dependencies on Claude Code, relay-server, or any adapter.

import type { ComponentType } from 'react';

// ═══════════════════════════════════════════════════════════════════
// Machine — a host (local or remote) that can run instances
// ═══════════════════════════════════════════════════════════════════

export interface Machine {
  id: string;
  name: string;
  type: 'local' | 'remote' | 'ssh';
  host?: string;
  port?: number;
  status: MachineStatus;
  workspaces: Workspace[];
  lastSeenAt?: number;
}

export type MachineStatus = 'online' | 'offline' | 'connecting' | 'error';

// ═══════════════════════════════════════════════════════════════════
// Workspace — an execution directory on a machine
// ═══════════════════════════════════════════════════════════════════

export interface Workspace {
  id: string;
  machineId: string;
  path: string;          // absolute filesystem path
  label: string;         // display name (auto-derived or user-set)
  instances: Instance[];
}

// ═══════════════════════════════════════════════════════════════════
// Instance — a running agent/terminal session in a workspace
// ═══════════════════════════════════════════════════════════════════

export interface Instance {
  id: string;
  workspaceId: string;
  adapterId: string;
  label: string;
  status: InstanceStatus;
  source: InstanceSource;
  createdAt: number;
  model?: string;
  runtime: RuntimeInfo;
  /** Adapter-specific state blob (e.g., stream parser state for Claude) */
  adapterState?: Record<string, unknown>;
}

export type InstanceStatus = 'starting' | 'running' | 'stopped' | 'error';
export type InstanceSource = 'local' | 'remote';

export interface RuntimeInfo {
  type: 'child_process' | 'pty' | 'websocket' | 'ssh';
  pid?: number;
  remoteUrl?: string;
}

// ═══════════════════════════════════════════════════════════════════
// AgentCapabilityHost — abstract capabilities provided by the agent
// runtime to adapters. Adapters use these instead of raw system calls,
// so permissions can be enforced at one choke point.
// When running on the relay server (no agent), host is undefined.
// ═══════════════════════════════════════════════════════════════════

export interface AgentCapabilityHost {
  fs: FileSystemCapability;
  process: ProcessCapability;
  terminal: TerminalCapability;
  permissions: PermissionState;
  notifications: NotificationCapability;
}

export interface FileSystemCapability {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  list(dir: string): Promise<FileEntry[]>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
}

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedAt: number;
}

export interface ProcessCapability {
  spawn(cmd: string, args: string[], opts?: SpawnOptions): import('child_process').ChildProcess;
  list(): Promise<ProcessInfo[]>;
  kill(pid: number): Promise<void>;
}

export interface ProcessInfo {
  pid: number;
  ppid: number;
  name: string;
  command: string;
  cpu: number;
  memory: number;
  state: string;
  user: string;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdio?: ('pipe' | 'ignore' | 'inherit')[];
}

export interface TerminalCapability {
  spawn(cmd: string, args: string[], opts?: TerminalOptions): TerminalHandle;
}

export interface TerminalOptions {
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface TerminalHandle {
  pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(handler: (data: string) => void): () => void;
  dispose(): void;
}

export type PermissionCategory =
  | 'fileRead' | 'fileWrite'
  | 'network'
  | 'processManagement'
  | 'shellAccess';

export interface PermissionState {
  grants: Record<PermissionCategory, boolean>;
  check(category: PermissionCategory, context?: Record<string, unknown>): { allowed: boolean; reason?: string };
}

// ═══════════════════════════════════════════════════════════════════
// NotificationCapability — adapter-callable notification system
// Each adapter declares its own scenarios; users toggle them in the dashboard.
// ═══════════════════════════════════════════════════════════════════

export interface NotificationScenario {
  id: string;           // unique: "session.ended", "agent.connected"
  label: string;        // display: "会话结束"
  description: string;  // "Claude 对话结束时通知"
  source: 'system' | string; // 'system' or adapterId
}

export interface NotificationCapability {
  notify(scenarioId: string, title: string, detail?: string): void;
}

// ═══════════════════════════════════════════════════════════════════
// StartInstanceInput — what adapters need to start
// ═══════════════════════════════════════════════════════════════════

export interface StartInstanceInput {
  workspaceId: string;
  directory: string;
  label?: string;
  adapterId: string;
  /** Optional adapter-specific config */
  config?: Record<string, unknown>;
  /** Server-side: callback for structured output blocks (Claude) */
  onBlock?: (block: Record<string, unknown>) => void;
  /** Server-side: callback for raw stdout/stderr output */
  onOutput?: (data: string) => void;
  /** Server-side: callback when process exits */
  onExit?: (code: number | null) => void;
  /** Agent-side: abstract capability host (undefined on relay server) */
  host?: AgentCapabilityHost;
}

// ═══════════════════════════════════════════════════════════════════
// InstanceHandle — returned by adapter.start()
// ═══════════════════════════════════════════════════════════════════

export interface InstanceHandle {
  instance: Instance;
  /** Send user input text */
  send: (data: string) => Promise<void>;
  /** Send a control command (restart, interrupt, setMode, etc.) */
  sendCommand: (cmd: string, args?: Record<string, unknown>) => Promise<void>;
  /** Stop/kill the instance */
  stop: () => Promise<void>;
  /** Stream of output blocks (for UI rendering) */
  onBlock: (handler: (block: OutputBlock) => void) => () => void;
}

// ═══════════════════════════════════════════════════════════════════
// OutputBlock — unified block format for all adapters
// ═══════════════════════════════════════════════════════════════════

export interface OutputBlock {
  id: string;
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'plan' | 'status' | 'error' | 'token_usage';
  name?: string;          // tool name (Read, Bash, Edit, etc.)
  input?: string;         // tool input args (JSON string)
  output?: string;        // tool result/output text
  text?: string;          // generic text content
  status: 'running' | 'done' | 'error';
  /** Adapter-specific metadata */
  meta?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════
// AdapterCapabilities — what this adapter can do
// ═══════════════════════════════════════════════════════════════════

export interface AdapterCapabilities {
  terminal: boolean;          // raw PTY access
  fileContext: boolean;       // file tree + read/write operations
  structuredEvents: boolean;  // tool_use, thinking, plan blocks
  approvals: boolean;         // permission/confirmation dialogs
  modes: boolean;             // /plan, /dontAsk, /acceptEdits modes
  timeline: boolean;          // tool execution timeline visualization
  compact: boolean;           // /compact context summarization
  tasks: boolean;             // background task tracking
}

// ═══════════════════════════════════════════════════════════════════
// AgentAdapter — the core adapter interface
// ═══════════════════════════════════════════════════════════════════

export interface AgentAdapter {
  id: string;
  name: string;
  displayName: string;
  icon: string;

  /** Check if this adapter can run on the given runtime */
  detect(runtime: RuntimeInfo): Promise<boolean>;

  /** Start a new instance and return a handle */
  start(input: StartInstanceInput): Promise<InstanceHandle>;

  /** Get capabilities */
  getCapabilities(): AdapterCapabilities;

  /** Get the main view component for this adapter */
  getView(): ComponentType<AdapterViewProps>;
  /** View component identifier for client-side routing */
  readonly viewId: string;

  /** Get optional side panels for this adapter */
  getSidePanels(): SidePanelDef[];

  /** Resolve the spawn command + args for this adapter (bridging step — used by relay-server until start() is fully integrated) */
  resolveSpawnCommand(config?: Record<string, unknown>): { cmd: string; args: string[]; cwd?: string; env?: Record<string, string> };

  /** Optional: notification scenarios this adapter can emit */
  getNotificationScenarios?(): NotificationScenario[];

  /**
   * Optional: parse a single line of output from a running instance.
   * Used for remote agents that stream structured output.
   */
  parseLine?(line: string, instance: any, deps: StreamParserDeps): void;

  /**
   * Optional: return CLI data paths for persistent session storage.
   * Legacy path metadata — primarily used internally by the adapter's
   * own SessionProvider implementation, or by older API consumers that
   * need direct filesystem access to session/history files.
   */
  getSessionPaths?(): CliSessionPaths;

  /**
   * Optional: return a SessionProvider for reading session history
   * and conversation detail from persistent storage.
   * When present, relay-server delegates /api/sessions/* routes to this
   * provider instead of hardcoding adapter-specific format parsing in core.
   */
  getSessionProvider?(): SessionProvider;
}

// ═══════════════════════════════════════════════════════════════════
// AdapterViewProps — props passed to adapter view components
// ═══════════════════════════════════════════════════════════════════

export interface AdapterViewProps {
  instanceId: string;
  blocks: OutputBlock[];      // unified output stream
  isRunning: boolean;
  cap: AdapterCapabilities;
  sendInput: (text: string) => void;
  sendCommand: (cmd: string, args?: Record<string, unknown>) => void;
  onInterrupt: () => void;
}

// ═══════════════════════════════════════════════════════════════════
// SidePanelDef — a registered side panel for an adapter
// ═══════════════════════════════════════════════════════════════════

export interface SidePanelDef {
  id: string;
  title: string;
  icon: string;
  component: ComponentType<SidePanelProps>;
  defaultVisible: boolean;
  /** When condition expression for visibility. */
  when?: string;
  /** Display order (lower = higher priority). */
  order?: number;
}

export interface SidePanelProps {
  instanceId: string;
  blocks: OutputBlock[];
}

// ═══════════════════════════════════════════════════════════════════
// SystemToast — structured notification message
// ═══════════════════════════════════════════════════════════════════

export interface SystemToast {
  id: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  title: string;
  detail?: string;
  sourceNodeId?: string;
  /** Which nodes should display this: 'all' | 'admins' | node-specific role */
  targetScope?: string;
  /** Display duration in ms. 0 = persistent until dismissed. */
  duration?: number;
  /** Optional action buttons */
  actions?: { label: string; value: string }[];
  /** Underlying event type that triggered this toast */
  triggerEvent?: string;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════════
// RelayEventBus — cross-adapter event bus contract
// ═══════════════════════════════════════════════════════════════════

export interface RelayEventBus {
  on(type: string, handler: (data: Record<string, unknown>) => void): () => void;
  emit(type: string, data: Record<string, unknown>): void;
  off(type: string, handler: (data: Record<string, unknown>) => void): void;
}

// ═══════════════════════════════════════════════════════════════════
// Stream Parser Deps — shared between server and adapters
// ═══════════════════════════════════════════════════════════════════

/** Dependencies needed by an adapter's parseLine() method. */
export interface StreamParserDeps {
  sendBlock: (block: Record<string, unknown>) => void;
  broadcast: (msg: unknown) => void;
  bufferOutput: (data: string) => void;
  nextId: () => string;
  setActive: (id: string | null) => void;
  getActiveId: () => string | null;
  processQueueForInstance: (inst: any) => void;
  sendControlRequest: (subtype: string, data: Record<string, unknown>, instanceId?: string) => boolean;
  getEffortLevel: () => string;
  notify?: (scenarioId: string, title: string, detail?: string) => void;
}

/** CLI data paths exposed by adapters with persistent CLI storage. */
export interface CliSessionPaths {
  dataDir: string;
  projectsDir: string;
  historyPath: string;
  sessionPath(slug: string, sessionId: string): string;
  projectSlug(dir: string): string;
}

// ═══════════════════════════════════════════════════════════════════
// SessionProvider — abstract session/history storage
// ═══════════════════════════════════════════════════════════════════

export interface SessionSearchResult {
  sessionId: string;
  display: string;
  project: string;
  timestamp: number;
  matchedIn?: string;
  snippet?: string;
  compactionCount?: number;
}

export interface SessionMessageBlock {
  type: string;
  text?: string;
  name?: string;
  input?: string;
  output?: string;
}

export interface SessionMessage {
  role: string;
  blocks: SessionMessageBlock[];
  text: string;
  timestamp: number;
  isCompactSummary?: boolean;
  isSystem?: boolean;
}

export interface SessionDetail {
  sessionId: string;
  messages: SessionMessage[];
  content?: string;
}

export interface CurrentSessionResult {
  sessionId: string;
  messages: SessionMessage[];
  found: boolean;
}

/**
 * Abstract session storage provider.
 * Adapters with persistent CLI session files implement this to expose
 * session history, detail, and compaction info to the relay server.
 */
export interface SessionProvider {
  /** Search session history. Empty/falsy query returns all recent sessions. */
  searchSessions(query?: string): SessionSearchResult[];
  /** Get full session detail by ID, optionally scoped to a project. */
  getSessionDetail(sessionId: string, project?: string): SessionDetail | { error: string };
  /** Get the most recent session for the given working directory. */
  getCurrentSession(workingDir: string): CurrentSessionResult;
  /** Count compaction summaries in a session file. */
  getCompactionCount(project: string, sessionId: string): number;
}

// ═══════════════════════════════════════════════════════════════════
// Extension System — VS Code-alike manifest + context
// ═══════════════════════════════════════════════════════════════════

/** A disposable resource that will be cleaned up on deactivation. */
export interface Disposable {
  dispose(): void;
}

/** Simple KV store for persisting extension state. */
export interface StateStore {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
}

/** Extension logging channel. */
export interface ExtensionLogger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  verbose(msg: string, data?: Record<string, unknown>): void;
}

export type ExtensionMode = 'production' | 'development';

/** Context provided to every extension's activate() function. */
export interface ExtensionContext {
  /** Unique extension identifier (from manifest). */
  readonly id: string;
  /** Human-readable display name (from manifest). */
  readonly displayName: string;
  /** Absolute path to the extension directory on disk. */
  readonly extensionPath: string;
  /** Push disposables here for automatic cleanup on deactivation. */
  readonly subscriptions: Disposable[];
  /** Global persistent state (survives extension restarts). */
  readonly globalState: StateStore;
  /** Workspace-scoped persistent state. */
  readonly workspaceState: StateStore;
  /** API capabilities (permission-gated system access). */
  readonly api: AgentCapabilityHost;
  /** Runtime mode: 'production' or 'development'. */
  readonly extensionMode: ExtensionMode;
  /** Stuctured logger with automatic extensionId prefix. */
  readonly log: ExtensionLogger;
}

// ═══════════════════════════════════════════════════════════════════
// Extension Manifest (sb-extension.json)
// ═══════════════════════════════════════════════════════════════════

export interface ExtensionManifest {
  /** Unique identifier (e.g. "claude-code"). */
  id: string;
  /** Display name (e.g. "Claude Code"). */
  displayName: string;
  /** SemVer version. */
  version: string;
  /** Icon identifier for the UI. */
  icon?: string;
  /** View component identifier for client-side routing. */
  viewId?: string;
  /** Compatibility: minimum SessionBridge engine version. */
  engines?: {
    sessionbridge?: string;
  };
  /** Entry module path relative to extension root. */
  main: string;
  /** Activation events that trigger loading this extension. */
  activationEvents?: string[];
  /** Runtime detection and install hints. */
  runtime?: {
    detectCommand?: string;
    installHint?: string;
    autoInstallCommand?: string;
  };
  /** Capability declarations (maps to AdapterCapabilities). */
  capabilities?: Partial<AdapterCapabilities>;
  /** UI contributions. */
  contributes?: {
    views?: {
      'sidebar-left'?: SidePanelContribution[];
      'sidebar-right'?: SidePanelContribution[];
    };
    commands?: CommandContribution[];
    menus?: MenuContribution[];
    notifications?: NotificationContribution[];
    configuration?: Record<string, unknown>;
    languages?: LanguageContribution[];
    spawn?: {
      command: string;
      args: string[];
      cwd?: string;
      env?: Record<string, string>;
    };
  };
}

export interface SidePanelContribution {
  id: string;
  title: string;
  icon: string;
  defaultVisible: boolean;
  /** When condition expression for visibility. */
  when?: string;
  /** Display order (lower = higher priority). */
  order?: number;
}

export interface CommandContribution {
  id: string;
  title: string;
  category?: string;
  icon?: string;
  /** When condition expression for visibility. */
  when?: string;
}

export interface MenuContribution {
  /** Unique menu item identifier. */
  id: string;
  /** Display label for the menu item. */
  title: string;
  /** Icon identifier. */
  icon?: string;
  /** Command ID to execute when activated. */
  command: string;
  /** When condition expression for visibility. */
  when?: string;
  /** Group within the menu ("navigation", "edit", "debug", "view"). */
  group?: string;
  /** Whether the item is disabled. */
  disabled?: boolean;
}

export interface LanguageContribution {
  /** Language ID (e.g. "javascript", "python"). */
  id: string;
  /** File extensions to associate (e.g. [".js", ".ts"]). */
  extensions: string[];
  /** Optional icon identifier. */
  icon?: string;
}

/** Context variables available to when condition evaluation. */
export interface WhenContext {
  view?: string;
  instanceStatus?: string;
  activeAdapterId?: string;
  editorHasSelection?: boolean;
  isRunning?: boolean;
  [key: string]: unknown;
}

export interface NotificationContribution {
  id: string;
  label: string;
  description: string;
}

// ═══════════════════════════════════════════════════════════════════
// Extension Lifecycle — status and diagnostics
// ═══════════════════════════════════════════════════════════════════

export type ExtensionStatus =
  | 'discovered'
  | 'invalid'
  | 'activating'
  | 'activated'
  | 'failed'
  | 'disabled'
  | 'skipped';

export interface ExtensionDiagnostic {
  id: string;
  dir: string;
  status: ExtensionStatus;
  message?: string;
  manifest?: ExtensionManifest;
  activateTime?: number;
}
