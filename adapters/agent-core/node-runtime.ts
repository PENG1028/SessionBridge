// ─── Node Runtime ───────────────────────────────────────────────
// Unified node orchestrator. Replaces the old relay/agent split.
// Every installation is a node — it auto-detects its role, starts
// the dashboard, optionally runs a relay server, and connects to
// an upstream relay if configured.
//
// Usage:
//   const node = new NodeRuntime(config);
//   await node.start();
//   // On signal: await node.shutdown();

import { resolveConfig, type NodeConfig } from './config';
import { PermissionModel } from './permissions';
import { NotificationModel } from './notifications';
import { createCapabilityHost } from './capability-host';
import { RelayConnection } from './relay-connection';
import { startDashboard, setDashboardState, setDashboardRelay, addDashboardLog, writeToShellByRelayId } from './dashboard-server';
import { getSystemState } from './introspection';
import { detectNetworkCapability } from '../system-info';
import { adapterRegistry, registerAdapter } from '../registry';
import { shellAdapter } from '../shell';
import { claudeCodeAdapter } from '../claude-code';
import { systemInfoAdapter } from '../system-info';
import type { AgentCapabilityHost, NotificationScenario, RuntimeInfo } from '../types';
import { spawn, type ChildProcess } from 'child_process';

export class NodeRuntime {
  readonly config: NodeConfig;
  readonly permissions: PermissionModel;
  readonly relay: RelayConnection;
  notifications: NotificationModel;
  capabilityHost: AgentCapabilityHost;

  private startTime = Date.now();
  private shellProc: ChildProcess | null = null;
  private relayServer: import('../../src/relay-server').NodeRelayServer | null = null;
  private resolvedRole: 'relay' | 'leaf' = 'leaf';

  constructor(configOverrides: Partial<NodeConfig> & { relayUrl?: string } = {}) {
    this.config = resolveConfig(configOverrides);
    this.permissions = new PermissionModel(this.config.permissions);
    this.notifications = new NotificationModel(
      [],
      this.config.notificationSettings,
    );
    this.relay = new RelayConnection(this.config);
    this.capabilityHost = createCapabilityHost(this.permissions, this.notifications, this.relay, this.config.ntfyTopic);
  }

  async start(): Promise<void> {
    addDashboardLog('[node] Starting...');
    addDashboardLog(`[node] Platform: ${getSystemState().platform} ${getSystemState().arch}`);
    addDashboardLog(`[node] Node: ${getSystemState().nodeVersion}`);

    // 1. Resolve role
    this.resolvedRole = await this.resolveRole();
    addDashboardLog(`[node] Role: ${this.resolvedRole}`);

    // 2. Start relay server if this node can be a relay
    if (this.resolvedRole === 'relay') {
      const { NodeRelayServer } = await import('../../src/relay-server');
      this.relayServer = new NodeRelayServer(this.config.relayPort, this.config.relayToken);
      const actualPort = await this.relayServer.start();
      addDashboardLog(`[node] Relay server on port ${actualPort}`);
    }

    // 3. Always start dashboard
    await startDashboard(this.config, this.permissions);
    setDashboardRelay(this.relay);

    // 4. Register adapters and detect what's available
    registerAdapter(shellAdapter);
    registerAdapter(claudeCodeAdapter);
    registerAdapter(systemInfoAdapter);
    const adapters = await this.detectAdapters();
    const adapterScenarios = await this.collectNotificationScenarios();
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

    // 5. Connect to relay (upstream or loopback)
    if (this.resolvedRole === 'relay' && !this.config.upstreamRelay) {
      addDashboardLog(`[node] Using loopback relay (ws://127.0.0.1:${this.config.relayPort})`);
    } else if (this.config.upstreamRelay) {
      addDashboardLog(`[node] Upstream relay: ${this.config.upstreamRelay}`);
    }
    this.setupRelayHandlers();
    this.relay.connect();
    addDashboardLog('[node] Relay connection initiated');
  }

  async shutdown(): Promise<void> {
    addDashboardLog('[node] Shutting down...');
    this.killShell();
    await this.relay.shutdown();
    if (this.relayServer) {
      await this.relayServer.stop();
      addDashboardLog('[node] Relay server stopped');
    }
    addDashboardLog('[node] Shutdown complete');
  }

  private async resolveRole(): Promise<'relay' | 'leaf'> {
    if (this.config.role === 'relay') return 'relay';
    if (this.config.role === 'leaf') return 'leaf';
    // Auto-detect
    const detected = await detectNetworkCapability();
    return detected;
  }

  private setupRelayHandlers(): void {
    this.relay.on('registered', (instanceId) => {
      addDashboardLog(`[node] Registered as instance: ${instanceId}`);
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
      this.spawnShell();
    });

    this.relay.on('stdin', (relayInstanceId, data) => {
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
      this.killShell();
    });

    this.relay.on('notification', (type, title, detail) => {
      addDashboardLog(`[node] Relay notification [${type}]: ${title} — ${detail}`);
    });

    this.relay.on('error', (code, message) => {
      addDashboardLog(`[node] Relay error [${code}]: ${message}`);
    });
  }

  private shellPidFile = '';

  private cleanupOrphanShell(): void {
    const { existsSync, readFileSync, unlinkSync } = require('fs');
    const { join } = require('path');
    const runDir = join(this.config.workingDirectory, '.sessionbridge');
    this.shellPidFile = join(runDir, 'shell.pid');

    if (!existsSync(this.shellPidFile)) return;

    try {
      const oldPid = parseInt(readFileSync(this.shellPidFile, 'utf8').trim(), 10);
      if (oldPid && isFinite(oldPid)) {
        try {
          process.kill(oldPid, 0); // Check if alive
          addDashboardLog(`[node] Killing orphan shell (pid ${oldPid})`);
          process.kill(oldPid, 'SIGKILL');
        } catch {
          // Process doesn't exist — stale PID file
        }
      }
    } catch {
      // Corrupt PID file
    }
    try { unlinkSync(this.shellPidFile); } catch { /* ignore */ }
  }

  private spawnShell(): void {
    if (this.shellProc) this.killShell();
    this.cleanupOrphanShell();

    const [cmd, ...args] = process.platform === 'win32'
      ? ['powershell.exe', '-NoLogo', '-NoExit']
      : ['bash', '--login'];
    this.shellProc = spawn(cmd, args, {
      cwd: this.config.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    addDashboardLog(`[node] Shell spawned: ${cmd} (pid ${this.shellProc.pid})`);

    // Persist PID for orphan cleanup on next startup
    try {
      const { mkdirSync, writeFileSync } = require('fs');
      const { dirname } = require('path');
      mkdirSync(dirname(this.shellPidFile), { recursive: true });
      writeFileSync(this.shellPidFile, String(this.shellProc.pid), 'utf8');
    } catch { /* best effort */ }

    const BACKPRESSURE_HIGH = 256 * 1024; // 256KB — pause stdout above this
    const BACKPRESSURE_LOW = 64 * 1024;   // 64KB — resume below this
    let stdoutPaused = false;
    let backpressureTimer: ReturnType<typeof setInterval> | null = null;

    const resumeStdout = () => {
      if (stdoutPaused && this.relay.bufferedAmount < BACKPRESSURE_LOW) {
        this.shellProc?.stdout?.resume();
        stdoutPaused = false;
        if (backpressureTimer) { clearInterval(backpressureTimer); backpressureTimer = null; }
      }
    };

    this.shellProc.stdout?.on('data', (chunk: Buffer) => {
      this.relay.sendStdout(chunk.toString());
      if (!stdoutPaused && this.relay.bufferedAmount > BACKPRESSURE_HIGH) {
        this.shellProc?.stdout?.pause();
        stdoutPaused = true;
        backpressureTimer = setInterval(resumeStdout, 200);
      }
    });
    this.shellProc.stderr?.on('data', (chunk: Buffer) => {
      this.relay.sendStderr(chunk.toString());
    });
    this.shellProc.on('close', (code) => {
      addDashboardLog(`[node] Shell exited: ${code}`);
      this.shellProc = null;
      if (backpressureTimer) { clearInterval(backpressureTimer); backpressureTimer = null; }
      try { require('fs').unlinkSync(this.shellPidFile); } catch { /* ignore */ }
    });
  }

  private killShell(): void {
    if (this.shellProc) {
      this.shellProc.kill();
      this.shellProc = null;
      try { require('fs').unlinkSync(this.shellPidFile); } catch { /* ignore */ }
    }
  }

  private async detectAdapters(): Promise<{ id: string; available: boolean }[]> {
    const runtime: RuntimeInfo = { type: 'child_process', pid: process.pid };
    const detected = await adapterRegistry.detectForRuntime(runtime);
    const detectedIds = new Set(detected.map(a => a.id));
    return adapterRegistry.list().map(a => ({
      id: a.id,
      available: detectedIds.has(a.id),
    }));
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

// Backward compat re-export
export { NodeRuntime as AgentRuntime };
