// ─── Shell Adapter ───────────────────────────────────────────
// Implements AgentAdapter for raw shell (bash/powershell/cmd).
// Simple PTY wrapper — no structured events, just terminal I/O.

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

  getCapabilities(): AdapterCapabilities {
    return { ...SHELL_CAPABILITIES };
  }

  /** Always available on any machine with a shell */
  async detect(_runtime: RuntimeInfo): Promise<boolean> {
    // Shell is a fallback: always available
    return true;
  }

  /**
   * Start a shell instance.
   * Delegates to the relay server's PTY spawning logic.
   */
  async start(_input: StartInstanceInput): Promise<InstanceHandle> {
    throw new Error(
      'ShellAdapter.start() requires integration with relay-server.\n' +
      'This will be refactored in Step 5.'
    );
  }

  /** Raw terminal view (reuses existing ShellTerminal component) */
  getView(): React.ComponentType<AdapterViewProps> {
    const PlaceholderView: React.ComponentType<AdapterViewProps> = () => null;
    return PlaceholderView;
  }

  /** Shell has no side panels */
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

/** Singleton adapter instance */
export const shellAdapter = new ShellAdapter();
