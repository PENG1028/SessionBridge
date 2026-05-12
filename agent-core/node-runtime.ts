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
import { AgentConfigReceiver } from './config-sync';
import { startDashboard, setDashboardState, setDashboardRelay, setExtensionHost, addDashboardLog, writeToShellByRelayId, restartDashboard } from './dashboard-server';
import { getSystemState } from './introspection';
import { detectNetworkCapability } from '../extensions/system-info';
import { envelope } from '../extensions/protocol';
import { detectNetwork } from '../src/network-detect';
import type { AgentCapabilityHost, NotificationScenario, RuntimeInfo } from '../extensions/types';
import { spawn, type ChildProcess } from 'child_process';
import { watch, type FSWatcher } from 'fs';
import { resolve } from 'path';
import { ExtensionHostManager } from './extension-host-manager';
import { extensionPoints } from './extension-points';
import { adapterRegistry } from '../extensions/registry';

export class NodeRuntime {
  readonly config: NodeConfig;
  readonly permissions: PermissionModel;
  readonly relay: RelayConnection;
  notifications: NotificationModel;
  capabilityHost: AgentCapabilityHost;
  configReceiver: AgentConfigReceiver;

  private startTime = Date.now();
  private shellProc: ChildProcess | null = null;
  private relayServer: import('../src/relay-server').NodeRelayServer | null = null;
  /** Extension host manager (only active in dev mode). */
  readonly hostManager: ExtensionHostManager | null = null;
  private fileWatchers: FSWatcher[] = [];
  resolvedRole: 'relay' | 'leaf' = 'leaf';

  constructor(configOverrides: Partial<NodeConfig> & { relayUrl?: string } = {}) {
    this.config = resolveConfig(configOverrides);
    this.permissions = new PermissionModel(this.config.permissions);
    this.notifications = new NotificationModel(
      [],
      this.config.notificationSettings,
    );
    this.relay = new RelayConnection(this.config);
    this.capabilityHost = createCapabilityHost(this.permissions, this.notifications, this.relay, this.config.ntfyTopic);
    // Config receiver for push updates from relay
    this.configReceiver = new AgentConfigReceiver(
      this.config,
      (key, value) => { addDashboardLog(`[config] Applied: ${key}=${JSON.stringify(value)}`); },
      this.relay as any,
    );

    // Extension host manager (dev mode only)
    if (this.config.devMode) {
      this.hostManager = new ExtensionHostManager({
        enabled: true,
        mode: 'development',
        logger: (msg) => addDashboardLog(msg),
        autoRespawn: true,
        maxRespawns: 3,
        respawnDelay: 2000,
      });
    }
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
      const { NodeRelayServer, setNodeId } = await import('../src/relay-server');
      this.relayServer = new NodeRelayServer(this.config.relayPort, this.config.relayToken);
      const actualPort = await this.relayServer.start();
      // Inject persistent node identity into EventBus (for event routing / mesh / audit)
      if (this.config.nodeId) setNodeId(this.config.nodeId);
      addDashboardLog(`[node] Relay server on port ${actualPort}, nodeId: ${this.config.nodeId ? this.config.nodeId.slice(0, 8) + '…' : 'none'}`);
    }

    // 3. Always start dashboard
    await startDashboard(this.config, this.permissions);
    setDashboardRelay(this.relay);

    // 4. Scan and load extensions dynamically
    const { scanAndActivate } = await import('./extension-loader');
    await scanAndActivate({ log: (msg: string) => addDashboardLog(msg) });

    // 4a. Register host configuration schema into the config registry
    try {
      const { registerHostConfig } = await import('../src/configuration/host-config');
      registerHostConfig();
      addDashboardLog('[config] Host configuration registered');
    } catch (err) {
      addDashboardLog(`[config] Failed to register host config: ${(err as Error).message}`);
    }

    // 4b. Register extension configuration contributions into the config registry
    try {
      const { configRegistry } = await import('../src/configuration/registry');
      const contribs = extensionPoints.getConfigurationContributions();
      for (const contrib of contribs) {
        configRegistry.registerExtension(contrib.extensionId, contrib.title, contrib.properties as any);
        addDashboardLog(`[config] Registered ${Object.keys(contrib.properties).length} key(s) from "${contrib.extensionId}"`);
      }
    } catch (err) {
      addDashboardLog(`[config] Failed to register extensions: ${(err as Error).message}`);
    }

    // 4b. Start extension host manager (dev mode)
    if (this.hostManager) {
      addDashboardLog('[node] Dev mode: starting extension host...');
      await this.hostManager.start();
      const activated = await this.hostManager.activate({
        extraPaths: this.config.extensionPaths,
        mode: 'development',
      });
      addDashboardLog(`[node] Extension host activated ${activated.length} extension(s)`);
      setExtensionHost(this.hostManager);
      this.startFileWatcher();
    }
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
    this.killFileWatchers();
    if (this.hostManager) {
      await this.hostManager.shutdown();
      addDashboardLog('[node] Extension host shut down');
    }
    await this.relay.shutdown();
    if (this.relayServer) {
      await this.relayServer.stop();
      addDashboardLog('[node] Relay server stopped');
    }
    addDashboardLog('[node] Shutdown complete');
  }

  // ─── File Watcher (dev mode hot-reload) ─────────────────────

  private startFileWatcher(): void {
    const paths: string[] = [];

    // Watch built-in adapters
    const builtIn = resolve(__dirname, '..');
    if (builtIn) paths.push(builtIn);

    // Watch user extension paths
    if (this.config.extensionPaths) paths.push(...this.config.extensionPaths);

    // Also watch home extensions dir
    const homeDir = resolve(require('os').homedir(), '.sessionbridge', 'extensions');
    try { if (require('fs').existsSync(homeDir)) paths.push(homeDir); } catch { /* ignore */ }

    for (const dir of [...new Set(paths)]) {
      try {
        const watcher = watch(dir, { recursive: true }, (_eventType: string, filename: string | null) => {
          if (!filename) return;
          // Only watch .ts, .js, .json files
          if (!/\.(ts|js|json)$/i.test(filename)) return;
          // Debounce: ignore rapid changes
          this.debouncedReload();
        });
        this.fileWatchers.push(watcher);
        addDashboardLog(`[watcher] Watching ${dir}`);
      } catch (err) {
        addDashboardLog(`[watcher] Cannot watch ${dir}: ${(err as Error).message}`);
      }
    }
  }

  private debouncedReload: (() => void) = (() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        addDashboardLog('[watcher] File change detected — reloading extensions...');
        this.hostManager?.reload({ extraPaths: this.config.extensionPaths, mode: 'development' })
          .then(() => addDashboardLog('[watcher] Extensions reloaded'))
          .catch((err) => addDashboardLog(`[watcher] Reload failed: ${err.message}`));
      }, 500);
    };
  })();

  private killFileWatchers(): void {
    for (const w of this.fileWatchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    this.fileWatchers = [];
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

    // Config push handler: receive config from relay, validate & apply, send ack
    this.relay.on('configPush', (entries: { key: string; value: unknown }[], requestId: string) => {
      addDashboardLog(`[config] Received push from relay: ${entries.length} key(s)`);
      const push = { entries, requestId };
      const result = this.configReceiver.apply(push);
      this.configReceiver.sendAck(this.relay as any, requestId, result);
      if (result.applied.length > 0) {
        addDashboardLog(`[config] Applied: ${result.applied.join(', ')}`);
        // Re-create capability host with updated config
        this.capabilityHost = createCapabilityHost(this.permissions, this.notifications, this.relay, this.config.ntfyTopic);
      }
      if (result.rejected.length > 0) {
        addDashboardLog(`[config] Rejected: ${result.rejected.map(r => `${r.key} (${r.reason})`).join(', ')}`);
      }
    });

    // External access: network inspect → run detection → send result back
    this.relay.on('nodeExternalInspect', (requestId: string) => {
      const hasToken = !!this.config.relayToken;
      const result = detectNetwork(this.config.dashboardPort, hasToken);
      (this.relay as any).sendRaw(JSON.stringify(envelope('node.external.inspected', { requestId, result })));
    });

    // External access: toggle dashboard bind on/off
    this.relay.on('nodeExternalSet', async (requestId: string, enable: boolean) => {
      const bind = enable ? '0.0.0.0' : '127.0.0.1';
      addDashboardLog(`[external] Toggling external access: dashboardBind → ${bind}`);
      this.config.dashboardBind = bind;
      try {
        await restartDashboard();
        addDashboardLog(`[external] Dashboard restarted on ${bind}:${this.config.dashboardPort}`);
      } catch (err: any) {
        addDashboardLog(`[external] Restart failed: ${err.message}`);
      }
      (this.relay as any).sendRaw(JSON.stringify(envelope('node.external.status', {
        requestId,
        enabled: enable,
        url: enable ? `http://${bind}:${this.config.dashboardPort}` : '',
      })));
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
    const permCheck = this.permissions.check('shellAccess');
    if (!permCheck.allowed) {
      addDashboardLog(`[node] Shell spawn blocked: ${permCheck.reason}`);
      return;
    }
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
    for (const adapter of adapterRegistry.list()) {
      try {
        if (adapter.getNotificationScenarios) {
          scenarios.push(...adapter.getNotificationScenarios());
        }
      } catch { /* ignore adapter errors */ }
    }
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
