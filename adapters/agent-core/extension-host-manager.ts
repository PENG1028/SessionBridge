// ─── Extension Host Manager ──────────────────────────────────────
// Main-process controller for the Extension Host child process.
// Forks extension-host.ts, manages IPC, handles crash detection
// with auto-respawn, and proxies instance operations through the host.
//
// Usage:
//   const mgr = new ExtensionHostManager({ enabled: true });
//   await mgr.start();
//   await mgr.activate({ filter: ['claude-code'] });
//   const handle = await mgr.startInstance('claude-code', { ... });
//   await mgr.shutdown();

import { fork, type ChildProcess } from 'child_process';
import { resolve } from 'path';
import type { InstanceHandle, StartInstanceInput, RuntimeInfo, ExtensionDiagnostic } from '../types';

// ─── Types ──────────────────────────────────────────────────────

export interface ExtensionHostOptions {
  /** Path to extension-host.js (default: adjacent to this file). */
  scriptPath?: string;
  /** Enable extension host process isolation. */
  enabled: boolean;
  /** Development mode (sets --inspect, verbose logging). */
  mode?: 'production' | 'development';
  /** Logger. */
  logger?: (msg: string) => void;
  /** Auto-respawn on crash (default: true). */
  autoRespawn?: boolean;
  /** Maximum consecutive respawns before giving up (default: 5). */
  maxRespawns?: number;
  /** Delay (ms) before respawn after crash (default: 1000). */
  respawnDelay?: number;
}

export interface HostInfo {
  state: 'stopped' | 'starting' | 'running' | 'crashed';
  pid: number | null;
  uptime: number;
  crashCount: number;
  activatedExtensionIds: string[];
  diagnostics: ExtensionDiagnostic[];
  instanceCount: number;
  mode: 'production' | 'development';
  enabled: boolean;
}

// ─── Response matching ──────────────────────────────────────────

const COMPLETION_TYPES = new Set([
  'host.activated',
  'host.started',
  'host.sent',
  'host.command_sent',
  'host.stopped',
  'host.reloaded',
  'host.shutdown_ack',
  'host.error',
]);

// ─── Extension Host Manager ─────────────────────────────────────

export class ExtensionHostManager {
  private options: Required<ExtensionHostOptions>;
  private child: ChildProcess | null = null;
  private state: 'stopped' | 'starting' | 'running' | 'crashed' = 'stopped';
  private requestId = 0;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private instanceCallbacks = new Map<string, {
    onOutput?: (data: string) => void;
    onBlock?: (block: Record<string, unknown>) => void;
    onExit?: (code: number | null) => void;
  }>();
  private crashCount = 0;
  private activatedIds: string[] = [];
  private diagnostics: ExtensionDiagnostic[] = [];
  private startTime = 0;
  private readyResolver: (() => void) | null = null;

  private readonly log: (msg: string) => void;

  constructor(options: ExtensionHostOptions) {
    this.options = {
      scriptPath: options.scriptPath || resolve(__dirname, 'extension-host.js'),
      enabled: options.enabled,
      mode: options.mode || 'production',
      logger: options.logger || ((msg: string) => console.log(`[host-mgr] ${msg}`)),
      autoRespawn: options.autoRespawn !== false,
      maxRespawns: options.maxRespawns || 5,
      respawnDelay: options.respawnDelay || 1000,
    };
    this.log = this.options.logger;
  }

  // ─── Accessors ────────────────────────────────────────────────

  get pid(): number | null { return this.child?.pid ?? null; }
  get status(): HostInfo['state'] { return this.state; }
  get isEnabled(): boolean { return this.options.enabled; }
  get uptime(): number { return this.startTime > 0 ? Date.now() - this.startTime : 0; }

  /** Return a snapshot of host info for dashboard / debugging. */
  getInfo(): HostInfo {
    return {
      state: this.state,
      pid: this.pid,
      uptime: this.uptime,
      crashCount: this.crashCount,
      activatedExtensionIds: [...this.activatedIds],
      diagnostics: [...this.diagnostics],
      instanceCount: this.instanceCallbacks.size,
      mode: this.options.mode,
      enabled: this.options.enabled,
    };
  }

  // ─── Lifecycle ────────────────────────────────────────────────

  /**
   * Start the extension host process. Resolves when the host sends
   * `host.ready`. If the host is disabled, resolves immediately.
   */
  async start(): Promise<void> {
    if (!this.options.enabled) {
      this.log('Extension host disabled — skipping start');
      this.state = 'running';
      return;
    }
    if (this.state === 'running') return;

    this.spawn();
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.readyResolver = null;
        reject(new Error('Extension host did not become ready within 15s'));
      }, 15000);

      this.readyResolver = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
  }

  /**
   * Activate extensions in the host process.
   * Returns the list of activated extension IDs.
   */
  async activate(opts: {
    extraPaths?: string[];
    filter?: string[];
    mode?: string;
  } = {}): Promise<string[]> {
    if (!this.isRunning()) throw new Error('Extension host not running');
    const result = await this.sendRequest('host.activate', opts);
    this.activatedIds = (result as any).ids || [];
    this.diagnostics = (result as any).diagnostics || [];
    this.log(`Activated ${this.activatedIds.length} extension(s): ${this.activatedIds.join(', ')}`);
    return this.activatedIds;
  }

  /**
   * Start an adapter instance inside the extension host.
   * Returns a proxy handle that sends IPC messages to the host.
   */
  async startInstance(adapterId: string, input: StartInstanceInput): Promise<InstanceHandle> {
    if (!this.isRunning()) throw new Error('Extension host not running');

    const instanceId = input.workspaceId;

    // Store callbacks for forwarding host events
    this.instanceCallbacks.set(instanceId, {
      onOutput: input.onOutput,
      onBlock: input.onBlock,
      onExit: input.onExit,
    });

    // Strip non-serializable fields (functions, host object)
    const serializableInput = {
      workspaceId: input.workspaceId,
      directory: input.directory,
      label: input.label,
      adapterId: input.adapterId,
      config: input.config,
    };

    await this.sendRequest('host.start', { adapterId, instanceId, input: serializableInput });

    const runtime: RuntimeInfo = {
      type: 'child_process',
      pid: this.child?.pid,
    };

    return {
      instance: {
        id: instanceId,
        workspaceId: instanceId,
        adapterId,
        label: input.label || adapterId,
        status: 'running' as const,
        source: 'local' as const,
        createdAt: Date.now(),
        runtime,
      },
      send: async (data: string) => {
        await this.sendRequest('host.send', { adapterId, instanceId, data });
      },
      sendCommand: async (cmd: string, args?: Record<string, unknown>) => {
        await this.sendRequest('host.command', { adapterId, instanceId, command: cmd, args });
      },
      stop: async () => {
        await this.sendRequest('host.stop', { adapterId, instanceId });
        this.instanceCallbacks.delete(instanceId);
      },
      onBlock: () => () => {}, // blocks forwarded via host.block → instanceCallbacks
    };
  }

  /**
   * Send raw input data to a running instance inside the host.
   */
  async sendInput(instanceId: string, data: string): Promise<void> {
    if (!this.isRunning()) throw new Error('Extension host not running');
    await this.sendRequest('host.send', { instanceId, data });
  }

  /**
   * Send a control command to an instance inside the host.
   */
  async sendCommand(instanceId: string, command: string, args?: Record<string, unknown>): Promise<void> {
    if (!this.isRunning()) throw new Error('Extension host not running');
    await this.sendRequest('host.command', { instanceId, command, args });
  }

  /**
   * Stop a running instance inside the host.
   */
  async stopInstance(instanceId: string): Promise<void> {
    if (!this.isRunning()) throw new Error('Extension host not running');
    await this.sendRequest('host.stop', { instanceId });
    this.instanceCallbacks.delete(instanceId);
  }

  /**
   * Reload all extensions: deactivate, re-scan, re-activate.
   */
  async reload(opts: {
    extraPaths?: string[];
    mode?: string;
  } = {}): Promise<string[]> {
    if (!this.isRunning()) throw new Error('Extension host not running');
    this.log('Reloading extensions...');
    this.instanceCallbacks.clear();
    const result = await this.sendRequest('host.reload', opts);
    this.activatedIds = (result as any).ids || [];
    this.diagnostics = (result as any).diagnostics || [];
    this.log(`Reloaded ${this.activatedIds.length} extension(s)`);
    return this.activatedIds;
  }

  /**
   * Gracefully shut down the extension host process.
   */
  async shutdown(): Promise<void> {
    if (!this.child || !this.child.connected) {
      this.cleanup();
      this.state = 'stopped';
      return;
    }

    try {
      await this.sendRequest('host.shutdown', {}, 5000);
    } catch {
      this.log('Shutdown request failed or timed out — killing host');
    }

    // Give it a moment to exit cleanly, then force kill
    if (this.child?.connected) {
      await new Promise<void>((resolve) => {
        const killTimer = setTimeout(() => {
          try { this.child?.kill('SIGKILL'); } catch { /* ignore */ }
          resolve();
        }, 2000);

        this.child?.once('exit', () => {
          clearTimeout(killTimer);
          resolve();
        });

        try { this.child?.send({ type: 'host.shutdown' }); } catch { /* ignore */ }
      });
    }

    this.cleanup();
    this.state = 'stopped';
    this.log('Extension host shut down');
  }

  // ─── Internal: Process Management ─────────────────────────────

  private spawn(): void {
    if (this.child) this.killChild();

    this.state = 'starting';
    this.log('Spawning extension host...');

    const forkArgs: string[] = [];
    const forkOpts: Record<string, unknown> = {};

    // In development mode, pass --inspect for debugger attachment
    if (this.options.mode === 'development') {
      forkArgs.push('--inspect=0.0.0.0:9229');
    }

    try {
      this.child = fork(this.options.scriptPath, forkArgs, {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        ...forkOpts,
      } as any);
    } catch (err) {
      this.state = 'crashed';
      this.log(`Failed to spawn extension host: ${(err as Error).message}`);
      return;
    }

    const child = this.child;

    child.on('message', (msg: any) => {
      try { this.onMessage(msg); } catch (err) {
        this.log(`Error handling host message: ${(err as Error).message}`);
      }
    });

    child.on('exit', (code, signal) => {
      this.log(`Extension host exited (code: ${code}, signal: ${signal})`);
      this.onChildExit(code, signal);
    });

    child.on('error', (err) => {
      this.log(`Extension host error: ${err.message}`);
    });

    // Pipe host stdout/stderr to our logger in dev mode
    if (this.options.mode === 'development') {
      child.stdout?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n').filter(Boolean)) {
          this.log(`[host:stdout] ${line}`);
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n').filter(Boolean)) {
          this.log(`[host:stderr] ${line}`);
        }
      });
    } else {
      // In production, only log stderr
      child.stderr?.on('data', (chunk: Buffer) => {
        this.log(`[host:stderr] ${chunk.toString().trim()}`);
      });
    }
  }

  private killChild(): void {
    if (!this.child) return;
    try {
      this.child.kill('SIGKILL');
    } catch { /* ignore */ }
    this.child = null;
  }

  private cleanup(): void {
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Extension host shut down'));
    }
    this.pendingRequests.clear();
    this.instanceCallbacks.clear();
    this.activatedIds = [];
  }

  // ─── Internal: IPC ────────────────────────────────────────────

  /**
   * Send an IPC request to the host and wait for its completion response.
   * The host echoes our `requestId` so we can match responses to requests.
   */
  private async sendRequest(
    type: string,
    payload: Record<string, unknown>,
    timeoutMs = 30000,
  ): Promise<unknown> {
    if (!this.child?.connected) {
      throw new Error('Extension host not connected');
    }

    return new Promise<unknown>((resolve, reject) => {
      const id = `req_${++this.requestId}`;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Host request "${type}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timer });

      try {
        this.child!.send({ type, requestId: id, ...payload });
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new Error(`Failed to send "${type}": ${(err as Error).message}`));
      }
    });
  }

  private onMessage(msg: any): void {
    const { type, requestId } = msg;

    // Completion response — resolve the pending request
    if (requestId && this.pendingRequests.has(requestId) && COMPLETION_TYPES.has(type)) {
      const pending = this.pendingRequests.get(requestId)!;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(requestId);

      if (type === 'host.error') {
        pending.reject(new Error(String(msg.error || 'Unknown host error')));
      } else {
        pending.resolve(msg);
      }
      return;
    }

    // Unsolicited events — forward to callbacks
    switch (type) {
      case 'host.ready': {
        this.state = 'running';
        this.startTime = Date.now();
        this.crashCount = 0;
        this.log(`Extension host ready (pid ${msg.pid}, node ${msg.nodeVersion})`);
        this.readyResolver?.();
        this.readyResolver = null;
        break;
      }

      case 'host.activated': {
        this.activatedIds = msg.ids || [];
        this.diagnostics = msg.diagnostics || [];
        this.log(`Activated ${this.activatedIds.length} extension(s)`);
        break;
      }

      case 'host.output': {
        const cb = this.instanceCallbacks.get(msg.instanceId);
        cb?.onOutput?.(msg.data);
        break;
      }

      case 'host.block': {
        const cb = this.instanceCallbacks.get(msg.instanceId);
        cb?.onBlock?.(msg.block);
        break;
      }

      case 'host.exit': {
        const cb = this.instanceCallbacks.get(msg.instanceId);
        cb?.onExit?.(msg.code ?? null);
        this.instanceCallbacks.delete(msg.instanceId);
        break;
      }

      case 'host.error': {
        // Async error (not tied to a pending request)
        this.log(`Host error: ${msg.error}`);
        break;
      }

      default: {
        this.log(`Unknown message from host: ${type}`);
      }
    }
  }

  // ─── Internal: Crash handling ─────────────────────────────────

  private onChildExit(_code: number | null, _signal: string | null): void {
    const wasRunning = this.state === 'running' || this.state === 'starting';

    this.state = 'crashed';
    this.child = null;

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Extension host process exited unexpectedly'));
    }
    this.pendingRequests.clear();

    // Schedule respawn
    if (wasRunning && this.options.autoRespawn) {
      this.crashCount++;
      if (this.crashCount <= this.options.maxRespawns) {
        const delay = this.options.respawnDelay;
        this.log(`Will respawn in ${delay}ms (attempt ${this.crashCount}/${this.options.maxRespawns})`);
        setTimeout(() => {
          if (this.state === 'crashed') {
            this.spawn();
          }
        }, delay);
      } else {
        this.log(`Max respawns (${this.options.maxRespawns}) exceeded — giving up`);
      }
    }
  }

  private isRunning(): boolean {
    return this.state === 'running' && this.child !== null && this.child.connected;
  }
}
