// ─── Shell Adapter ───────────────────────────────────────────
// Implements AgentAdapter for raw shell (bash/powershell/cmd).
// Simple PTY wrapper — no structured events, just terminal I/O.

import { spawn } from 'child_process';
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
    const proc = input.host
      ? input.host.process.spawn(cmd, args, { cwd: cwd || input.directory })
      : spawn(cmd, args, { cwd: cwd || input.directory, stdio: ['pipe', 'pipe', 'pipe'] });

    // Idle detection — notify when output goes silent
    const idleSeconds = (typeof input.config?.idleSeconds === 'number' ? input.config.idleSeconds : null) ?? 10;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        input.host?.notifications.notify(
          'shell.task.idle',
          'Shell task idle',
          `No output for ${idleSeconds}s (PID ${proc.pid})`,
        );
      }, idleSeconds * 1000);
    };
    if (idleSeconds > 0) resetIdleTimer();

    proc.stdout?.on('data', (chunk: Buffer) => {
      input.onOutput?.(chunk.toString());
      if (idleSeconds > 0) resetIdleTimer();
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      input.onOutput?.(chunk.toString());
      if (idleSeconds > 0) resetIdleTimer();
    });
    proc.on('close', (code) => {
      if (idleTimer) clearTimeout(idleTimer);
      input.host?.notifications.notify(
        'shell.task.ended',
        'Shell task ended',
        `Exit code: ${code} (PID ${proc.pid})`,
      );
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
