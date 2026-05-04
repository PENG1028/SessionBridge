// ─── Shell Adapter ───────────────────────────────────────────
// Implements AgentAdapter for raw shell (bash/powershell/cmd).
// Simple PTY wrapper — no structured events, just terminal I/O.

import { spawn } from 'child_process';
import type {
  AgentAdapter, AdapterCapabilities, AdapterViewProps,
  InstanceHandle, StartInstanceInput, SidePanelDef, RuntimeInfo,
} from '../types';

const SHELL_CAPABILITIES: AdapterCapabilities = {
  terminal:       true,
  fileContext:    false,
  structuredEvents: false,
  approvals:      false,
  modes:          false,
  timeline:       false,
  compact:        false,
  tasks:          false,
};

export class ShellAdapter implements AgentAdapter {
  id = 'shell' as const;
  name = 'shell';
  displayName = 'Shell';
  icon = 'terminal';
  viewId = 'terminal';

  getCapabilities(): AdapterCapabilities {
    return { ...SHELL_CAPABILITIES };
  }

  async detect(_runtime: RuntimeInfo): Promise<boolean> {
    return true;
  }

  async start(input: StartInstanceInput): Promise<InstanceHandle> {
    const { cmd, args, cwd } = this.resolveSpawnCommand(input.config);
    const proc = spawn(cmd, args, {
      cwd: cwd || input.directory,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (chunk: Buffer) => {
      input.onOutput?.(chunk.toString());
    });
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
        label: input.label || 'Shell',
        status: 'running',
        source: 'local',
        createdAt: Date.now(),
        runtime: { type: 'child_process', pid: proc.pid },
      },
      send: async (data: string) => {
        if (proc.stdin?.writable) proc.stdin.write(data);
      },
      sendCommand: async (_cmd: string, _args?: Record<string, unknown>) => {},
      stop: async () => {
        proc.kill();
      },
      onBlock: (_handler: (block: import('../types').OutputBlock) => void) => {
        return () => {};
      },
    };
  }

  getView(): React.ComponentType<AdapterViewProps> {
    const PlaceholderView: React.ComponentType<AdapterViewProps> = () => null;
    return PlaceholderView;
  }

  getSidePanels(): SidePanelDef[] {
    return [];
  }

  resolveSpawnCommand(_config?: Record<string, unknown>): { cmd: string; args: string[]; cwd?: string; env?: Record<string, string> } {
    if (process.platform === 'win32') {
      return { cmd: 'powershell.exe', args: ['-NoLogo', '-NoExit'] };
    }
    return { cmd: 'bash', args: ['--login'] };
  }
}

export const shellAdapter = new ShellAdapter();
