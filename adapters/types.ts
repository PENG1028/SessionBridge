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
// StartInstanceInput — what adapters need to start
// ═══════════════════════════════════════════════════════════════════

export interface StartInstanceInput {
  workspaceId: string;
  directory: string;
  label?: string;
  adapterId: string;
  /** Optional adapter-specific config */
  config?: Record<string, unknown>;
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

  /** Get optional side panels for this adapter */
  getSidePanels(): SidePanelDef[];

  /** Resolve the spawn command + args for this adapter (bridging step — used by relay-server until start() is fully integrated) */
  resolveSpawnCommand(config?: Record<string, unknown>): { cmd: string; args: string[]; cwd?: string; env?: Record<string, string> };
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
}

export interface SidePanelProps {
  instanceId: string;
  blocks: OutputBlock[];
}
