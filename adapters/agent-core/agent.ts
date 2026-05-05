// ─── Agent Runtime ─────────────────────────────────────────────
// Main orchestrator. Assembles capability host, relay connection,
// and dashboard server. This is the agent entry point.
//
// Usage:
//   const rt = new AgentRuntime(config);
//   await rt.start();
//   // On signal: await rt.shutdown();

import { resolveConfig, type AgentConfig } from './config';
import { PermissionModel, type PermissionConfig } from './permissions';
import { NotificationModel } from './notifications';
import { createCapabilityHost } from './capability-host';
import { RelayConnection } from './relay-connection';
import { startDashboard, setDashboardState, setDashboardRelay, addDashboardLog, writeToShellByRelayId } from './dashboard-server';
import { getSystemState } from './introspection';
import type { AgentCapabilityHost, NotificationScenario } from '../types';
import { spawn, type ChildProcess } from 'child_process';

export class AgentRuntime {
  readonly config: AgentConfig;
  readonly permissions: PermissionModel;
  readonly relay: RelayConnection;
  notifications: NotificationModel;
  capabilityHost: AgentCapabilityHost;

  private startTime = Date.now();
  private shellProc: ChildProcess | null = null;

  constructor(configOverrides: Partial<AgentConfig> = {}) {
    this.config = resolveConfig(configOverrides);
    this.permissions = new PermissionModel(this.config.permissions);
    this.notifications = new NotificationModel(
      [], // adapter scenarios collected in start()
      this.config.notificationSettings,
    );
    this.relay = new RelayConnection(this.config);
    this.capabilityHost = createCapabilityHost(this.permissions, this.notifications, this.relay, this.config.ntfyTopic);
  }

  async start(): Promise<void> {
    addDashboardLog('[agent] Starting...');
    addDashboardLog(`[agent] Platform: ${getSystemState().platform} ${getSystemState().arch}`);
    addDashboardLog(`[agent] Node: ${getSystemState().nodeVersion}`);
    addDashboardLog(`[agent] Relay: ${this.config.relayUrl}`);

    // Start dashboard
    await startDashboard(this.config, this.permissions);
    setDashboardRelay(this.relay);

    // Set up dashboard state
    const adapters = await this.detectAdapters();
    const adapterScenarios = await this.collectNotificationScenarios();
    // Rebuild notification model with adapter scenarios included
    const savedSettings = this.notifications.settings;
    this.notifications = new NotificationModel(adapterScenarios, savedSettings);
    this.capabilityHost = createCapabilityHost(this.permissions, this.notifications, this.relay, this.config.ntfyTopic);
    setDashboardState({
      config: this.config,
      permissions: this.permissions,
      notifications: this.notifications,
      relayConnected: false,
      instanceId: null,
      adapters,
      startTime: this.startTime,
    });

    // Connect to relay
    this.relay.on('registered', (instanceId) => {
      addDashboardLog(`[agent] Registered as instance: ${instanceId}`);
      setDashboardState({
        ...this.getDashboardState(),
        relayConnected: true,
        instanceId,
      });
      this.capabilityHost.notifications.notify(
        'agent.connected',
        'Agent connected',
        `Instance: ${instanceId}`,
      );
      // Spawn a default shell so browser terminals can interact
      this.spawnAgentShell();
    });

    this.relay.on('stdin', (relayInstanceId, data) => {
      // Try dashboard shell instance first (bridge run), then agent shell
      if (!writeToShellByRelayId(relayInstanceId, data)) {
        if (this.shellProc?.stdin?.writable) {
          this.shellProc.stdin.write(data);
        }
      }
    });

    this.relay.on('close', () => {
      setDashboardState({
        ...this.getDashboardState(),
        relayConnected: false,
        instanceId: null,
      });
      this.capabilityHost.notifications.notify(
        'agent.disconnected',
        'Agent disconnected',
        'Connection to relay lost',
      );
      this.killAgentShell();
    });

    this.relay.on('error', (code, message) => {
      addDashboardLog(`[relay] Error [${code}]: ${message}`);
    });

    this.relay.connect();
    addDashboardLog('[agent] Relay connection initiated');
  }

  async shutdown(): Promise<void> {
    addDashboardLog('[agent] Shutting down...');
    this.killAgentShell();
    await this.relay.shutdown();
    addDashboardLog('[agent] Shutdown complete');
  }

  private spawnAgentShell(): void {
    if (this.shellProc) this.killAgentShell();
    const [cmd, ...args] = process.platform === 'win32'
      ? ['powershell.exe', '-NoLogo', '-NoExit']
      : ['bash', '--login'];
    this.shellProc = spawn(cmd, args, {
      cwd: this.config.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    addDashboardLog(`[agent] Shell spawned: ${cmd} (pid ${this.shellProc.pid})`);
    this.shellProc.stdout?.on('data', (chunk: Buffer) => {
      this.relay.sendStdout(chunk.toString());
    });
    this.shellProc.stderr?.on('data', (chunk: Buffer) => {
      this.relay.sendStderr(chunk.toString());
    });
    this.shellProc.on('close', (code) => {
      addDashboardLog(`[agent] Shell exited: ${code}`);
      this.shellProc = null;
    });
  }

  private killAgentShell(): void {
    if (this.shellProc) {
      this.shellProc.kill();
      this.shellProc = null;
    }
  }

  private async detectAdapters(): Promise<{ id: string; available: boolean }[]> {
    // Detect available adapters on this machine
    const results: { id: string; available: boolean }[] = [];
    try {
      // Shell adapter — always available
      results.push({ id: 'shell', available: true });
      // Claude Code adapter — check if claude binary exists
      try {
        const { execSync } = await import('child_process');
        execSync(
          process.platform === 'win32' ? 'where claude' : 'which claude',
          { encoding: 'utf8', timeout: 5000 },
        );
        results.push({ id: 'claude-code', available: true });
      } catch {
        results.push({ id: 'claude-code', available: false });
      }
      // System info — always available
      results.push({ id: 'system-info', available: true });
    } catch { /* ignore */ }
    return results;
  }

  private async collectNotificationScenarios(): Promise<NotificationScenario[]> {
    const scenarios: NotificationScenario[] = [];
    try {
      const { claudeCodeAdapter } = await import('../claude-code');
      if (claudeCodeAdapter.getNotificationScenarios) {
        scenarios.push(...claudeCodeAdapter.getNotificationScenarios());
      }
    } catch { /* adapter not available */ }
    try {
      const { shellAdapter } = await import('../shell');
      if (shellAdapter.getNotificationScenarios) {
        scenarios.push(...shellAdapter.getNotificationScenarios());
      }
    } catch { /* ignore */ }
    return scenarios;
  }

  private getDashboardState() {
    return {
      config: this.config,
      permissions: this.permissions,
      notifications: this.notifications,
      relayConnected: this.relay.instanceId !== null,
      instanceId: this.relay.instanceId,
      adapters: [] as { id: string; available: boolean }[],
      startTime: this.startTime,
    };
  }
}

// Re-export for backward compat with the old startAgent() API
export function startAgent(opts: {
  relay: string;
  dir: string;
  label?: string;
  logFile?: string;
  pidFile?: string;
}) {
  const runtime = new AgentRuntime({
    relayUrl: opts.relay,
    workingDirectory: opts.dir,
    label: opts.label ?? `agent-${Date.now().toString(36)}`,
    logFile: opts.logFile,
    pidFile: opts.pidFile,
  });
  runtime.start();
  return { shutdown: () => runtime.shutdown() };
}
