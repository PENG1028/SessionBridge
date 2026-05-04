// ─── Claude Code Adapter ──────────────────────────────────────
// Implements AgentAdapter for Anthropic's Claude Code CLI.
// This is the reference adapter — the first and most complete.

import type {
  AgentAdapter, AdapterCapabilities, AdapterViewProps,
  OutputBlock, InstanceHandle, StartInstanceInput, SidePanelDef, RuntimeInfo,
} from '../types';
import { resolveClaudeCommand, buildClaudeArgs } from './runtime';

// ─── Claude Code capability profile ─────────────────────────

const CLAUDE_CAPABILITIES: AdapterCapabilities = {
  terminal:       true,   // raw PTY for shell commands
  fileContext:    true,   // file tree, Read/Glob/Grep/Edit/Write
  structuredEvents: true, // thinking, tool_use, plan, text blocks
  approvals:      true,   // AskUserQuestion tool
  modes:          true,   // /plan, /dontAsk, /acceptEdits
  timeline:       true,   // tool execution timeline
  compact:        true,   // /compact context summarization
  tasks:          true,   // TodoWrite + background tasks
};

// ─── ClaudeCodeAdapter ──────────────────────────────────────

export class ClaudeCodeAdapter implements AgentAdapter {
  id = 'claude-code' as const;
  name = 'claude-code';
  displayName = 'Claude Code';
  icon = 'sparkles';

  getCapabilities(): AdapterCapabilities {
    return { ...CLAUDE_CAPABILITIES };
  }

  /** Check if Claude CLI is available on the given runtime */
  async detect(runtime: RuntimeInfo): Promise<boolean> {
    // Local child_process: check if `claude` binary exists
    // Remote websocket: assume the agent handles detection
    if (runtime.type === 'websocket') return true;

    if (runtime.type === 'child_process' || runtime.type === 'pty') {
      try {
        const { execSync } = await import('child_process');
        execSync('claude --version', { stdio: 'ignore', timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Start a Claude Code instance.
   * Currently delegates to the relay-server's spawnClaude logic.
   * In future: calls the adapter's own runtime module.
   */
  async start(input: StartInstanceInput): Promise<InstanceHandle> {
    // This is a stub — the actual instance creation is handled by
    // the relay server's existing spawnClaude() function.
    // After the relay-server refactor, this will call the adapter's
    // own process manager directly.
    throw new Error(
      'ClaudeCodeAdapter.start() requires integration with relay-server.\n' +
      'Currently, instances are created via spawnClaude() in relay-server.ts.\n' +
      'This will be refactored in Step 5.'
    );
  }

  /** Get the Claude Code view component (stub — extracted from page.tsx later) */
  getView(): React.ComponentType<AdapterViewProps> {
    // Placeholder — the actual ClaudeCodeView will be extracted
    // from app/page.tsx in a later step.
    const PlaceholderView: React.ComponentType<AdapterViewProps> = () => null;
    return PlaceholderView;
  }

  resolveSpawnCommand(config?: Record<string, unknown>): { cmd: string; args: string[]; cwd?: string; env?: Record<string, string> } {
    const { cmd, args: prefix } = resolveClaudeCommand();
    const model = config?.model as string | undefined;
    return { cmd, args: [...prefix, ...buildClaudeArgs(model ?? null)] };
  }

  /** Side panels for Claude Code */
  getSidePanels(): SidePanelDef[] {
    const SidePanelStub: React.ComponentType<any> = () => null;
    return [
      { id: 'tasks',    title: 'Tasks',    icon: 'list-checks',  component: SidePanelStub, defaultVisible: true },
      { id: 'files',    title: 'Files',    icon: 'folder-tree',  component: SidePanelStub, defaultVisible: true },
      { id: 'logs',     title: 'Logs',     icon: 'scroll-text',  component: SidePanelStub, defaultVisible: false },
      { id: 'terminal', title: 'Terminal', icon: 'terminal',     component: SidePanelStub, defaultVisible: false },
    ];
  }
}

/** Singleton adapter instance */
export const claudeCodeAdapter = new ClaudeCodeAdapter();
