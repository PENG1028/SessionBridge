// ─── Claude Code Adapter ──────────────────────────────────────
// Implements AgentAdapter for Anthropic's Claude Code CLI.

import { spawn } from 'child_process';
import { createInterface } from 'readline';
import type {
  AgentAdapter, AdapterCapabilities, AdapterViewProps,
  OutputBlock, InstanceHandle, StartInstanceInput, SidePanelDef, RuntimeInfo,
} from '../types';
import { resolveClaudeCommand, buildClaudeArgs } from './runtime';
import { processStreamLine } from './parser';

const CLAUDE_CAPABILITIES: AdapterCapabilities = {
  terminal:       true,
  fileContext:    true,
  structuredEvents: true,
  approvals:      true,
  modes:          true,
  timeline:       true,
  compact:        true,
  tasks:          true,
};

const genId = () => Math.random().toString(36).substring(2, 11);

interface StreamState {
  thinkingId: string | null;
  thinkingText: string;
  toolUseId: string | null;
  toolResult: string;
  textBuffer: string;
  blockBuffer: Record<string, unknown>[];
  outputBuffer: string[];
  outputSize: number;
}

function createStreamState(): StreamState {
  return { thinkingId: null, thinkingText: '', toolUseId: null, toolResult: '', textBuffer: '', blockBuffer: [], outputBuffer: [], outputSize: 0 };
}

export class ClaudeCodeAdapter implements AgentAdapter {
  id = 'claude-code' as const;
  name = 'claude-code';
  displayName = 'Claude Code';
  icon = 'sparkles';
  viewId = 'claude-chat';

  getCapabilities(): AdapterCapabilities {
    return { ...CLAUDE_CAPABILITIES };
  }

  async detect(runtime: RuntimeInfo): Promise<boolean> {
    if (runtime.type === 'websocket') return true;
    if (runtime.type === 'child_process' || runtime.type === 'pty') {
      try {
        const { execSync } = await import('child_process');
        execSync('claude --version', { stdio: 'ignore', timeout: 5000 });
        return true;
      } catch { return false; }
    }
    return false;
  }

  async start(input: StartInstanceInput): Promise<InstanceHandle> {
    const { cmd, args, cwd } = this.resolveSpawnCommand(input.config);
    const proc = spawn(cmd, args, {
      cwd: cwd || input.directory,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    const state = createStreamState();
    const pendingInput: string[] = [];

    // Build parser deps adapted to this single instance
    const deps = {
      sendBlock: (block: Record<string, unknown>) => {
        input.onBlock?.(block);
        state.blockBuffer.push(block);
        if (state.blockBuffer.length > 2000) state.blockBuffer.shift();
      },
      broadcast: (_msg: unknown) => {},  // adapter has no WebSocket; use onBlock/onOutput
      bufferOutput: (data: string) => {
        state.outputBuffer.push(data);
        if (state.outputBuffer.length > 2000) state.outputBuffer.shift();
        state.outputSize += data.length;
      },
      nextId: genId,
      setActive: (_id: string | null) => {},  // single instance, always active
      getActiveId: () => input.workspaceId,
      processQueueForInstance: (_inst: any) => {
        while (pendingInput.length > 0) {
          const text = pendingInput.shift()!;
          proc.stdin?.write(JSON.stringify({
            type: 'user',
            message: { role: 'user', content: [{ type: 'text', text }] },
          }) + '\n');
        }
      },
      sendControlRequest: (subtype: string, data: Record<string, unknown>) => {
        const msg = JSON.stringify({
          type: 'control_request',
          request_id: `r${Date.now()}_${genId()}`,
          request: { subtype, ...data },
        }) + '\n';
        if (proc.stdin?.writable) proc.stdin.write(msg);
        return true;
      },
      getEffortLevel: () => 'medium',
    };

    // Minimal InstanceData-like object for the parser
    const parserInst = state as any;
    parserInst.id = input.workspaceId;
    parserInst.status = 'running';
    parserInst.source = 'local';

    const rl = createInterface({ input: proc.stdout! });
    rl.on('line', (line: string) => processStreamLine(parserInst, line, deps));

    proc.stderr?.on('data', (chunk: Buffer) => {
      input.onOutput?.(chunk.toString());
    });

    proc.on('close', (code) => {
      input.onExit?.(code);
    });

    return {
      instance: {
        id: input.workspaceId,
        workspaceId: input.workspaceId,
        adapterId: this.id,
        label: input.label || 'Claude Code',
        status: 'running',
        source: 'local',
        createdAt: Date.now(),
        runtime: { type: 'child_process', pid: proc.pid },
      },
      send: async (data: string) => {
        if (proc.stdin?.writable) {
          proc.stdin.write(JSON.stringify({
            type: 'user',
            message: { role: 'user', content: [{ type: 'text', text: data }] },
          }) + '\n');
        }
      },
      sendCommand: async (cmd: string, args?: Record<string, unknown>) => {
        deps.sendControlRequest(cmd, args || {});
      },
      stop: async () => {
        proc.kill();
      },
      onBlock: (_handler: (block: OutputBlock) => void) => {
        return () => {};
      },
    };
  }

  getView(): React.ComponentType<AdapterViewProps> {
    const PlaceholderView: React.ComponentType<AdapterViewProps> = () => null;
    return PlaceholderView;
  }

  resolveSpawnCommand(config?: Record<string, unknown>): { cmd: string; args: string[]; cwd?: string; env?: Record<string, string> } {
    const { cmd, args: prefix } = resolveClaudeCommand();
    const model = config?.model as string | undefined;
    return { cmd, args: [...prefix, ...buildClaudeArgs(model ?? null)] };
  }

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

export const claudeCodeAdapter = new ClaudeCodeAdapter();
