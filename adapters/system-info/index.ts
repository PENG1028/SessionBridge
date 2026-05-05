// ─── System Info Adapter ───────────────────────────────────────
// Read-only adapter that reports OS, hardware, and process state.
// No spawned process — queries system on-demand via capability host.

import type {
  AgentAdapter, AdapterCapabilities, AdapterViewProps,
  InstanceHandle, StartInstanceInput, SidePanelDef, RuntimeInfo,
} from '../types';

const SYSTEM_INFO_CAPABILITIES: AdapterCapabilities = {
  terminal: false,
  fileContext: false,
  structuredEvents: true,
  approvals: false,
  modes: false,
  timeline: false,
  compact: false,
  tasks: false,
};

export class SystemInfoAdapter implements AgentAdapter {
  id = 'system-info' as const;
  name = 'system-info';
  displayName = 'System Info';
  icon = 'cpu';
  viewId = 'system-info';

  getCapabilities(): AdapterCapabilities {
    return { ...SYSTEM_INFO_CAPABILITIES };
  }

  async detect(_runtime: RuntimeInfo): Promise<boolean> {
    return true;
  }

  async start(input: StartInstanceInput): Promise<InstanceHandle> {
    // System info is read-only — collect and report immediately
    const lines: string[] = [];
    const add = (label: string, value: unknown) => lines.push(`${label}: ${String(value)}`);

    try {
      const os = await import('os');
      add('platform', os.platform());
      add('arch', os.arch());
      add('hostname', os.hostname());
      add('cpus', os.cpus().length);
      add('memory total', formatBytes(os.totalmem()));
      add('memory free', formatBytes(os.freemem()));
      add('loadavg', os.loadavg().map(n => n.toFixed(2)).join(', '));
      add('uptime', formatUptime(os.uptime()));
      add('home', os.homedir());
      add('node', process.version);
      add('pid', process.pid);

      if (input.host) {
        add('capability-host', 'available');
        add('permissions', JSON.stringify(input.host.permissions.grants));
      }

      if (input.host?.process) {
        try {
          const procs = await input.host.process.list();
          add('process count', procs.length);
        } catch { /* permission denied */ }
      }
    } catch (err) {
      lines.push(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    const output = lines.join('\n');
    input.onOutput?.(output);
    input.onExit?.(0);

    return {
      instance: {
        id: input.workspaceId,
        workspaceId: input.workspaceId,
        adapterId: this.id,
        label: input.label || 'System Info',
        status: 'stopped',
        source: 'local',
        createdAt: Date.now(),
        runtime: { type: 'child_process', pid: process.pid },
      },
      send: async (_data: string) => {},
      sendCommand: async (_cmd: string, _args?: Record<string, unknown>) => {},
      stop: async () => {},
      onBlock: (_handler) => () => {},
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
    return { cmd: 'echo', args: [] };
  }
}

export const systemInfoAdapter = new SystemInfoAdapter();

function formatBytes(b: number): string {
  const gb = b / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(b / 1e6).toFixed(0)} MB`;
}

function formatUptime(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}
