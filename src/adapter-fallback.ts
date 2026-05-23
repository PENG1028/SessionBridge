// ─── Adapter Fallback Utilities ──────────────────────────
// Minimal replacements for extensions/registry functions.
// The relay no longer loads extension adapters from sb-extension.json
// manifests. A minimal shell adapter is provided so that shell.spawn
// and terminal sessions continue to work without the old extension runtime.

import { spawn as ptySpawn } from 'node-pty';
import type { AgentAdapter, AdapterCapabilities, InstanceHandle } from './relay-types';

// ─── Minimal shell adapter ──────────────────────────────

const SHELL_CAPABILITIES: AdapterCapabilities = {
  terminal: true,
  structuredEvents: false,
};

function resolveSpawnCommand(_config?: Record<string, unknown>): { cmd: string; args: string[] } {
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

const shellAdapter: AgentAdapter = {
  id: 'shell',
  displayName: 'Shell',

  getCapabilities(): AdapterCapabilities {
    return { ...SHELL_CAPABILITIES };
  },

  async start(input): Promise<InstanceHandle> {
    const { cmd, args } = resolveSpawnCommand(input.config);

    const ptyProcess = ptySpawn(cmd, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: input.directory,
      env: { ...process.env as Record<string, string> },
    });

    ptyProcess.onData((chunk: string) => {
      input.onOutput?.(chunk);
    });

    ptyProcess.onExit(({ exitCode }) => {
      input.onExit?.(exitCode);
    });

    return {
      instance: {
        id: input.workspaceId,
        workspaceId: input.workspaceId,
        adapterId: 'shell',
        label: input.label || 'local',
        status: 'running',
        source: 'local',
        createdAt: Date.now(),
      },
      send: async (data: string) => {
        ptyProcess.write(data);
      },
      sendCommand: async (_cmd: string, _args?: Record<string, unknown>) => {},
      stop: async () => {
        ptyProcess.kill();
      },
      onBlock: (_handler: (block: any) => void) => {
        return () => {};
      },
      resize: (cols: number, rows: number) => {
        ptyProcess.resize(cols, rows);
      },
    };
  },
};

// ─── Adapter map ────────────────────────────────────────

const adapterMap = new Map<string, AgentAdapter>([
  ['shell', shellAdapter],
]);

// ─── Public API ─────────────────────────────────────────

export function getDefaultAdapterId(): string {
  return 'shell';
}

export function getTerminalAdapterId(): string | undefined {
  return 'shell';
}

export function resolveAdapter(adapterId?: string): AgentAdapter | undefined {
  if (!adapterId) return undefined;
  return adapterMap.get(adapterId);
}

export function resolveAdapterByCapability<K extends string, V>(
  key: K,
  value: V,
): AgentAdapter | undefined {
  for (const adapter of adapterMap.values()) {
    const caps = adapter.getCapabilities();
    if ((caps as Record<string, unknown>)[key] === value) return adapter;
  }
  return undefined;
}

export function getAdapter(id?: string): AgentAdapter | undefined {
  if (!id) return undefined;
  return adapterMap.get(id);
}

export function listAdapters(): AgentAdapter[] {
  return Array.from(adapterMap.values());
}
