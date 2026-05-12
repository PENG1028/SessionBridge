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
  private cachedAdapters: { id: string; available: boolean }[] = [];
  private shellProc: ChildProcess | null = null;
  private relayServer: import('../src/relay-server').NodeRelayServer | null = null;
  /** Extension host manager (only active in dev mode). */
  readonly hostManager: ExtensionHostManager | null = null;
  private fileWatchers: FSWatcher[] = [];
  resolvedRole: 'relay' | 'leaf' = 'leaf';
  /** Internal log buffer. */
  private logBuffer: string[] = [];
  /** Reference to relay's admin log function (set after dynamic import). */
  private appendRelayLog: ((msg: string) => void) | null = null;
  /** Reference to relay's writeToShellByRelayId (set after dynamic import). */
  private _writeToShellByRelayId: ((relayId: string, data: string) => boolean) | null = null;

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
      (key, value) => { this.addLog(`[config] Applied: ${key}=${JSON.stringify(value)}`); },
      this.relay as any,
    );

    // Extension host manager (dev mode only)
    if (this.config.devMode) {
      this.hostManager = new ExtensionHostManager({
        enabled: true,
        mode: 'development',
        logger: (msg) => this.addLog(msg),
        autoRespawn: true,
        maxRespawns: 3,
        respawnDelay: 2000,
      });
    }
  }

  /** Append a timestamped log to the local buffer (and console). */
  private addLog(msg: string): void {
    const line = `[${new Date().toISOString()}] ${msg}`;
    this.logBuffer.push(line);
    if (this.logBuffer.length > 500) this.logBuffer.shift();
    console.log(msg);
    // Also forward to relay's admin log buffer if available
    this.appendRelayLog?.(line);
  }

  async start(): Promise<void> {
    this.addLog('[node] Starting...');
    this.addLog(`[node] Platform: ${getSystemState().platform} ${getSystemState().arch}`);
    this.addLog(`[node] Node: ${getSystemState().nodeVersion}`);

    // 1. Resolve role
    this.resolvedRole = await this.resolveRole();
    this.addLog(`[node] Role: ${this.resolvedRole}`);

    // 2. Start relay server if this node can be a relay
    if (this.resolvedRole === 'relay') {
      const { NodeRelayServer, setNodeId, appendAdminLog, writeToShellByRelayId } = await import('../src/relay-server');
      this.appendRelayLog = appendAdminLog;
      this._writeToShellByRelayId = writeToShellByRelayId;
      this.relayServer = new NodeRelayServer(this.config.relayPort, this.config.relayToken);

      // Initialize admin auth before relay listens (so remote login sessions work)
      if (this.config.dashboardToken) {
        const { initAuth } = await import('../src/admin-auth');
        initAuth(this.config.dashboardToken, this.config.dashboardAuthEnabled, this.config.dashboardSessionTtl);
        this.addLog(`[auth] Admin authentication initialized (enabled=${this.config.dashboardAuthEnabled})`);
      }

      const actualPort = await this.relayServer.start();
      // Inject persistent node identity into EventBus (for event routing / mesh / audit)
      if (this.config.nodeId) setNodeId(this.config.nodeId);
      this.addLog(`[node] Relay server on port ${actualPort}, nodeId: ${this.config.nodeId ? this.config.nodeId.slice(0, 8) + '…' : 'none'}`);
    }

    // 3. (Dashboard server removed — all admin routes now handled by relay)

    // 4. Scan and load extensions dynamically
    const { scanAndActivate } = await import('./extension-loader');
    await scanAndActivate({ log: (msg: string) => this.addLog(msg) });

    // 4a. Register host configuration schema into the config registry
    try {
      const { registerHostConfig } = await import('../src/configuration/host-config');
      registerHostConfig();
      this.addLog('[config] Host configuration registered');
    } catch (err) {
      this.addLog(`[config] Failed to register host config: ${(err as Error).message}`);
    }

    // 4b. Register extension configuration contributions into the config registry
    try {
      const { configRegistry } = await import('../src/configuration/registry');
      const contribs = extensionPoints.getConfigurationContributions();
      for (const contrib of contribs) {
        configRegistry.registerExtension(contrib.extensionId, contrib.title, contrib.properties as any);
        this.addLog(`[config] Registered ${Object.keys(contrib.properties).length} key(s) from "${contrib.extensionId}"`);
      }
    } catch (err) {
      this.addLog(`[config] Failed to register extensions: ${(err as Error).message}`);
    }

    // 4b. Start extension host manager (dev mode)
    if (this.hostManager) {
      this.addLog('[node] Dev mode: starting extension host...');
      await this.hostManager.start();
      const activated = await this.hostManager.activate({
        extraPaths: this.config.extensionPaths,
        mode: 'development',
      });
      this.addLog(`[node] Extension host activated ${activated.length} extension(s)`);
      this.startFileWatcher();
    }
    this.cachedAdapters = await this.detectAdapters();
    const adapterScenarios = await this.collectNotificationScenarios();
    const savedSettings = this.notifications.settings;
    this.notifications = new NotificationModel(adapterScenarios, savedSettings);
    this.capabilityHost = createCapabilityHost(this.permissions, this.notifications, this.relay, this.config.ntfyTopic);

    // 5. Connect to relay (upstream or loopback)
    if (this.resolvedRole === 'relay' && !this.config.upstreamRelay) {
      this.addLog(`[node] Using loopback relay (ws://127.0.0.1:${this.config.relayPort})`);
    } else if (this.config.upstreamRelay) {
      this.addLog(`[node] Upstream relay: ${this.config.upstreamRelay}`);
    }
    this.setupRelayHandlers();
    this.relay.connect();
    this.addLog('[node] Relay connection initiated');
  }

  async shutdown(): Promise<void> {
    this.addLog('[node] Shutting down...');
    this.killShell();
    this.killFileWatchers();
    if (this.hostManager) {
      await this.hostManager.shutdown();
      this.addLog('[node] Extension host shut down');
    }
    await this.relay.shutdown();
    if (this.relayServer) {
      await this.relayServer.stop();
      this.addLog('[node] Relay server stopped');
    }
    this.addLog('[node] Shutdown complete');
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
        this.addLog(`[watcher] Watching ${dir}`);
      } catch (err) {
        this.addLog(`[watcher] Cannot watch ${dir}: ${(err as Error).message}`);
      }
    }
  }

  private debouncedReload: (() => void) = (() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        this.addLog('[watcher] File change detected — reloading extensions...');
        this.hostManager?.reload({ extraPaths: this.config.extensionPaths, mode: 'development' })
          .then(() => this.addLog('[watcher] Extensions reloaded'))
          .catch((err) => this.addLog(`[watcher] Reload failed: ${err.message}`));
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
      this.addLog(`[node] Registered as instance: ${instanceId}`);
      this.capabilityHost.notifications.notify(
        'agent.connected',
        'Agent connected',
        `Instance: ${instanceId}`,
      );
      this.spawnShell();
    });

    this.relay.on('stdin', (relayInstanceId, data) => {
      if (!this._writeToShellByRelayId?.(relayInstanceId, data)) {
        if (this.shellProc?.stdin?.writable) {
          this.shellProc.stdin.write(data);
        }
      }
    });

    this.relay.on('close', () => {
      this.capabilityHost.notifications.notify(
        'agent.disconnected',
        'Agent disconnected',
        'Connection to relay lost',
      );
      this.killShell();
    });

    this.relay.on('notification', (type, title, detail) => {
      this.addLog(`[node] Relay notification [${type}]: ${title} — ${detail}`);
    });

    this.relay.on('error', (code, message) => {
      this.addLog(`[node] Relay error [${code}]: ${message}`);
    });

    // Config push handler: receive config from relay, validate & apply, send ack
    this.relay.on('configPush', (entries: { key: string; value: unknown }[], requestId: string) => {
      this.addLog(`[config] Received push from relay: ${entries.length} key(s)`);
      const push = { entries, requestId };
      const result = this.configReceiver.apply(push);
      this.configReceiver.sendAck(this.relay as any, requestId, result);
      if (result.applied.length > 0) {
        this.addLog(`[config] Applied: ${result.applied.join(', ')}`);
        // Re-create capability host with updated config
        this.capabilityHost = createCapabilityHost(this.permissions, this.notifications, this.relay, this.config.ntfyTopic);
      }
      if (result.rejected.length > 0) {
        this.addLog(`[config] Rejected: ${result.rejected.map(r => `${r.key} (${r.reason})`).join(', ')}`);
      }
    });

    // External access: network inspect → run detection → send result back
    this.relay.on('nodeExternalInspect', (requestId: string) => {
      const hasToken = !!this.config.relayToken;
      const result = detectNetwork(this.config.relayPort, hasToken);
      (this.relay as any).sendRaw(JSON.stringify(envelope('node.external.inspected', { requestId, result })));
    });

    // External access: toggle dashboard bind on/off
    this.relay.on('nodeExternalSet', async (requestId: string, enable: boolean) => {
      const bind = enable ? '0.0.0.0' : '127.0.0.1';
      this.addLog(`[external] Toggling external access: dashboardBind → ${bind}`);
      this.config.dashboardBind = bind;
      // Relay server already listens on all interfaces; no separate dashboard to restart
      this.addLog(`[external] External access ${enable ? 'enabled' : 'disabled'} (bind=${bind})`);
      (this.relay as any).sendRaw(JSON.stringify(envelope('node.external.status', {
        requestId,
        enabled: enable,
        url: enable ? `http://${bind}:${this.config.relayPort}` : '',
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
          this.addLog(`[node] Killing orphan shell (pid ${oldPid})`);
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
      this.addLog(`[node] Shell spawn blocked: ${permCheck.reason}`);
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
    this.addLog(`[node] Shell spawned: ${cmd} (pid ${this.shellProc.pid})`);

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
      this.addLog(`[node] Shell exited: ${code}`);
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

}

// Backward compat re-export
export { NodeRuntime as AgentRuntime };
