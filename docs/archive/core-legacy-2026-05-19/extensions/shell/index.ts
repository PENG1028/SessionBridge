// ─── Shell Adapter ───────────────────────────────────────────
// Implements AgentAdapter for raw shell (bash/powershell/cmd).
// Simple PTY wrapper — no structured events, just terminal I/O.

import { spawn as ptySpawn } from 'node-pty';
import type {
  AgentAdapter, AdapterCapabilities, AdapterViewProps,
  InstanceHandle, StartInstanceInput, SidePanelDef, RuntimeInfo,
  NotificationScenario,
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

    // Create a real PTY so interactive CLI programs (claude, vim, nano, etc.)
    // work correctly — they need isatty() to return true.
    const ptyProcess = ptySpawn(cmd, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: cwd || input.directory,
      env: { ...process.env as Record<string, string> },
    });

    // Idle detection — notify when output goes silent
    const idleSeconds = (typeof input.config?.idleSeconds === 'number' ? input.config.idleSeconds : null) ?? 10;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        input.host?.notifications.notify(
          'shell.task.idle',
          'Shell task idle',
          `No output for ${idleSeconds}s (PID ${ptyProcess.pid})`,
        );
      }, idleSeconds * 1000);
    };
    if (idleSeconds > 0) resetIdleTimer();

    ptyProcess.onData((chunk: string) => {
      input.onOutput?.(chunk);
      if (idleSeconds > 0) resetIdleTimer();
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (idleTimer) clearTimeout(idleTimer);
      input.host?.notifications.notify(
        'shell.task.ended',
        'Shell task ended',
        `Exit code: ${exitCode} (PID ${ptyProcess.pid})`,
      );
      input.onExit?.(exitCode);
    });

    return {
      instance: {
        id: input.workspaceId,
        workspaceId: input.workspaceId,
        adapterId: this.id,
        label: input.label || 'local',
        status: 'running',
        source: 'local',
        createdAt: Date.now(),
        runtime: { type: 'pty', pid: ptyProcess.pid },
      },
      send: async (data: string) => {
        ptyProcess.write(data);
      },
      sendCommand: async (_cmd: string, _args?: Record<string, unknown>) => {},
      stop: async () => {
        ptyProcess.kill();
      },
      onBlock: (_handler: (block: import('../types').OutputBlock) => void) => {
        return () => {};
      },
      resize: (cols: number, rows: number) => {
        ptyProcess.resize(cols, rows);
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
    // If config.command is set, execute it as a raw shell command
    if (_config?.command && typeof _config.command === 'string') {
      if (process.platform === 'win32') {
        return { cmd: 'cmd.exe', args: ['/c', _config.command] };
      }
      return { cmd: 'sh', args: ['-c', _config.command] };
    }
    if (process.platform === 'win32') {
      return { cmd: 'powershell.exe', args: ['-NoLogo', '-NoExit'] };
    }
    return { cmd: 'bash', args: ['--login'] };
  }

  getNotificationScenarios(): NotificationScenario[] {
    return [
      { id: 'shell.task.idle', label: 'Shell 空闲', description: '终端输出静默超过设定秒数时', source: 'shell' },
      { id: 'shell.task.ended', label: 'Shell 结束', description: 'Shell 进程退出时', source: 'shell' },
    ];
  }
}

export const shellAdapter = new ShellAdapter();

/** Extension entry point for dynamic loading. */
export async function activate(): Promise<AgentAdapter> {
  return shellAdapter;
}