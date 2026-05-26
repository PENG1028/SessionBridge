'use client';

import type { CoreClient, CoreEvent, CoreConnectionStatus } from './core-types';
import { normalizeWsUrlAndToken, buildConnectUrl } from './core-url';

// ─── CoreClient Config ──────────────────────────────────────────
export interface CoreClientConfig {
  wsUrl?: string;
  /** Authentication token, sent as ?token= query param on WebSocket URL. */
  token?: string;
  pluginId: string;
  /** Timeout for Core calls in ms. Default 10_000. */
  callTimeout?: number;
  /** Reconnect interval in ms. Default 5_000. */
  reconnectInterval?: number;
  /** Maximum reconnect attempts. Default -1 (unlimited). */
  maxReconnectAttempts?: number;
}

// ─── CoreClient Implementation ──────────────────────────────────
export class CoreClientImpl implements CoreClient {
  readonly pluginId: string;
  readonly wsUrl: string;
  readonly hasToken: boolean;
  readonly authMode: 'token' | 'none';
  private _connectUrl: string;
  private _callTimeout: number;
  private _reconnectInterval: number;
  private _maxReconnectAttempts: number;

  private _ws: WebSocket | null = null;
  private _requestIdCounter = 0;
  private _pendingCalls = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private _eventListeners = new Map<string, Set<(data: CoreEvent) => void>>();
  private _reconnectAttempts = 0;
  private _disconnected = false;

  private _connectionStatus: CoreConnectionStatus = 'disconnected';
  private _statusListeners = new Set<(status: CoreConnectionStatus) => void>();
  private _lastError: string | null = null;

  constructor(config: CoreClientConfig) {
    this.pluginId = config.pluginId;

    // Normalise: if config.wsUrl carries a token query param and config.token
    // is not set, extract the token. explicit token always wins.
    const defaultUrl = typeof window !== 'undefined'
      ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
      : 'ws://localhost:8080/ws';
    const rawUrl = config.wsUrl || defaultUrl;
    const normalized = normalizeWsUrlAndToken(rawUrl, config.token);

    this.hasToken = !!normalized.token;
    this.authMode = normalized.token ? 'token' : 'none';
    this.wsUrl = normalized.wsUrl;

    // Build real connect URL with token (never exposed to DOM/logs)
    // buildConnectUrl handles ? vs & and hash preservation correctly
    this._connectUrl = buildConnectUrl(normalized.wsUrl, normalized.token);

    this._callTimeout = config.callTimeout ?? 10_000;
    this._reconnectInterval = config.reconnectInterval ?? 5_000;
    this._maxReconnectAttempts = config.maxReconnectAttempts ?? -1;
  }

  get isConnected(): boolean {
    return this._connectionStatus === 'connected';
  }

  get connectionStatus(): CoreConnectionStatus {
    return this._connectionStatus;
  }

  get lastError(): string | null {
    return this._lastError;
  }

  onStatusChange(handler: (status: CoreConnectionStatus) => void): () => void {
    this._statusListeners.add(handler);
    return () => this._statusListeners.delete(handler);
  }

  // ─── Core call (Go Core action.request protocol) ───────────────
  async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this._callAs(this.pluginId, method, params);
  }

  private async _callAs<T>(pluginId: string, method: string, params?: Record<string, unknown>): Promise<T> {
    const requestId = `req_${++this._requestIdCounter}_${Date.now()}`;

    // Extract targetNodeId from params — it's a routing-level field, not payload
    const { targetNodeId, ...payload } = params || {};

    const body = JSON.stringify({
      type: 'action.request',
      requestId,
      capability: method,
      payload,
      pluginId,
      actorType: 'user',
      actorId: 'current-user',
      ...(targetNodeId ? { targetNodeId: targetNodeId as string } : {}),
    });

    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Core not connected (${this._connectionStatus})`);
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingCalls.delete(requestId);
        reject(new Error(`Core call timeout: ${method}`));
      }, this._callTimeout);

      this._pendingCalls.set(requestId, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      this._ws!.send(body);
    });
  }

  createScopedClient(pluginId: string): CoreClient {
    const host = this;
    return {
      pluginId,
      get isConnected() { return host.isConnected; },
      get wsUrl() { return host.wsUrl; },
      get lastError() { return host.lastError; },
      get hasToken() { return host.hasToken; },
      get authMode() { return host.authMode; },
      call: <T>(method: string, params?: Record<string, unknown>) => host._callAs(pluginId, method, params),
      on: (event: string, handler: (data: CoreEvent) => void) => host.on(event, handler),
      once: (event: string, handler: (data: CoreEvent) => void) => host.once(event, handler),
      off: (event: string, handler: (data: CoreEvent) => void) => host.off(event, handler),
      disconnect: () => { /* plugin does not own the connection */ },
    };
  }

  // ─── WebSocket event subscription ──────────────────────────────
  on(event: string, handler: (data: CoreEvent) => void): () => void {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Set());
    }
    this._eventListeners.get(event)!.add(handler);

    // Auto-connect on first listener
    if (!this._ws || this._ws.readyState === WebSocket.CLOSED) {
      this._connect();
    }

    return () => this.off(event, handler);
  }

  once(event: string, handler: (data: CoreEvent) => void): void {
    const wrapper = (data: CoreEvent) => {
      handler(data);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }

  off(event: string, handler: (data: CoreEvent) => void): void {
    const handlers = this._eventListeners.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this._eventListeners.delete(event);
      }
    }
  }

  // ─── Connection management ─────────────────────────────────────
  private _setStatus(status: CoreConnectionStatus): void {
    this._connectionStatus = status;
    this._statusListeners.forEach(fn => fn(status));
    this._emit('connectionStatus', { type: 'connectionStatus', status, pluginId: this.pluginId });
  }

  private _connect(): void {
    if (this._disconnected) return;
    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this._setStatus('connecting');

    try {
      const ws = new WebSocket(this._connectUrl);
      ws.onopen = () => {
        this._reconnectAttempts = 0;
        this._lastError = null;
        this._setStatus('connected');
        this._emit("connected", { type: "connected", pluginId: this.pluginId });
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === 'action.response' && msg.requestId && this._pendingCalls.has(msg.requestId)) {
            const pending = this._pendingCalls.get(msg.requestId)!;
            clearTimeout(pending.timer);
            this._pendingCalls.delete(msg.requestId);
            if (msg.ok === false || msg.error != null) {
              const errMsg = msg.error
                ? (typeof msg.error === 'string' ? msg.error : (msg.error.message || JSON.stringify(msg.error)))
                : 'Core action failed';
              pending.reject(new Error(errMsg));
            } else {
              pending.resolve(msg.payload);
            }
            return;
          }
          if (msg.type) {
            this._emit(msg.type as string, msg as CoreEvent);
          }
        } catch {
          // Ignore parse errors on individual messages
        }
      };

      ws.onclose = (ev: CloseEvent) => {
        if (!ev.wasClean) {
          this._lastError = `Connection closed unexpectedly (code=${ev.code}${ev.reason ? ': ' + ev.reason : ''})`;
        }
        this._setStatus('disconnected');
        this._ws = null;
        for (const [id, pending] of this._pendingCalls) {
          clearTimeout(pending.timer);
          pending.reject(new Error('WebSocket disconnected'));
          this._pendingCalls.delete(id);
        }
        if (!this._disconnected) {
          if (this._maxReconnectAttempts < 0 || this._reconnectAttempts < this._maxReconnectAttempts) {
            this._reconnectAttempts++;
            setTimeout(() => this._connect(), this._reconnectInterval);
          } else {
            this._lastError = `Failed to connect after ${this._maxReconnectAttempts} attempts`;
            this._setStatus('error');
          }
        }
      };

      ws.onerror = () => {
        this._lastError = 'WebSocket connection error — check that the Go Core server is running and the port is not occupied';
      };

      this._ws = ws;
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : 'Failed to create WebSocket';
      this._setStatus('error');
      if (!this._disconnected) {
        if (this._maxReconnectAttempts < 0 || this._reconnectAttempts < this._maxReconnectAttempts) {
          this._reconnectAttempts++;
          setTimeout(() => this._connect(), this._reconnectInterval);
        }
      }
    }
  }

  connect(): void {
    this._disconnected = false;
    this._connect();
  }

  disconnect(): void {
    this._disconnected = true;
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._setStatus('disconnected');
  }

  private _emit(event: string, data: CoreEvent): void {
    const handlers = this._eventListeners.get(event);
    if (handlers) {
      handlers.forEach(fn => {
        try { fn(data); } catch { /* handler error */ }
      });
    }
    const allHandlers = this._eventListeners.get('*');
    if (allHandlers) {
      allHandlers.forEach(fn => {
        try { fn(data); } catch { /* handler error */ }
      });
    }
  }

  get listenerCount(): number {
    let count = 0;
    this._eventListeners.forEach(s => count += s.size);
    return count;
  }
}

// ─── Factory ─────────────────────────────────────────────────────
export function createCoreClient(config?: Partial<CoreClientConfig>): CoreClientImpl {
  return new CoreClientImpl({
    pluginId: 'sessionnode-core',
    ...config,
  });
}

// ─── Mock CoreClient (offline/fallback mode) ────────────────────
export function createMockCoreClient(mockData?: Record<string, unknown>, pluginId?: string, connected?: boolean): CoreClient {
  return new MockCoreClient(mockData, pluginId, connected);
}

class MockCoreClient implements CoreClient {
  readonly pluginId: string;
  readonly isConnected: boolean;
  readonly wsUrl: string = 'ws://localhost:8080/ws';
  readonly lastError: string | null = null;
  readonly hasToken: boolean = false;
  readonly authMode: 'token' | 'none' = 'none';
  private _listeners = new Map<string, Set<(data: CoreEvent) => void>>();

  constructor(mockData?: Record<string, unknown>, pluginId = 'sessionnode-core', connected = false) {
    this.pluginId = pluginId;
    this.isConnected = connected;
    if (mockData) {
      (this as unknown as Record<string, unknown>).__mockData = mockData;
    }
  }

  async call<T = unknown>(method: string, _params?: Record<string, unknown>): Promise<T> {
    const mockStore = (this as unknown as Record<string, unknown>).__mockData as Record<string, unknown> | undefined;
    const mockResult = mockStore?.[method];

    if (mockResult !== undefined) {
      return mockResult as T;
    }

    if (method.endsWith('.list')) return [] as T;
    if (method.endsWith('.get')) return null as T;
    if (method.includes('check')) return { checks: [] } as T;
    if (method === 'run.create') return { runId: 'run_mock_001', sessionId: 'sess_mock_001', processId: 'sess_mock_001', state: 'running', policy: { onDisconnect: 'keep_running', onCoreShutdown: 'terminate', persistHistory: true, restartRestore: false } } as T;
    if (method === 'run.info') return { runId: 'run_mock_001', kind: 'terminal', label: 'mock-run', pluginId: 'terminal', state: 'running', sessionId: 'sess_mock_001', processId: 'sess_mock_001', process: { sessionId: 'sess_mock_001', pid: 12345, state: 'running', exitCode: 0, command: 'bash' } } as T;
    if (method === 'run.stop') return { runId: 'run_mock_001', state: 'stopped' } as T;
    if (method === 'run.updatePolicy') return { runId: 'run_mock_001', policy: { onDisconnect: 'keep_running', onCoreShutdown: 'terminate', persistHistory: true } } as T;
    if (method === 'run.attach') return { runId: 'run_mock_001', sessionId: 'sess_mock_001', kind: 'terminal', pluginId: 'terminal', state: 'running', processId: 'sess_mock_001', streamSubscriptions: [{ streamType: 'stdout', subscribed: false, reason: 'call stream.subscribe after attach' }, { streamType: 'stderr', subscribed: false, reason: 'call stream.subscribe after attach' }], process: { sessionId: 'sess_mock_001', pid: 12345, state: 'running', exitCode: 0, command: 'bash' } } as T;

    if (method === 'update.status') return { status: 'unknown', currentCommit: '', remoteCommit: '', behindBy: 0, dirty: false, source: { type: 'git', remote: 'origin', branch: 'main', repoUrl: '', mode: 'manual' }, lastCheckedAt: 0, lastCheckError: '', requiresRestart: false } as T;
    if (method === 'update.source.get') return { type: 'git', remote: 'origin', branch: 'main', repoUrl: '', mode: 'manual' } as T;
    if (method === 'update.source.set') return { type: 'git', remote: 'origin', branch: 'main', repoUrl: '', mode: 'manual' } as T;
    if (method === 'update.policy.get') return { autoCheck: false, autoApply: false, checkIntervalSeconds: 86400, allowDirtyWorktree: false, allowWhenRunsActive: false, ignoredVersions: [] } as T;
    if (method === 'update.policy.set') return { autoCheck: false, autoApply: false, checkIntervalSeconds: 86400, allowDirtyWorktree: false, allowWhenRunsActive: false, ignoredVersions: [] } as T;
    if (method === 'update.check') return { status: 'up-to-date', currentCommit: 'abc123', remoteCommit: 'abc123', behindBy: 0, dirty: false, source: { type: 'git', remote: 'origin', branch: 'main', repoUrl: '', mode: 'manual' }, lastCheckedAt: Date.now(), lastCheckError: '', requiresRestart: false } as T;
    if (method === 'update.plan') return { canUpdate: false, status: 'up-to-date', currentCommit: 'abc123', remoteCommit: 'abc123', behindBy: 0, dirty: false, blockers: [], steps: [] } as T;
    if (method === 'update.ignore') return { ignoredVersions: ['abc123'], ignoredVersion: 'abc123' } as T;

    return undefined as T;
  }

  createScopedClient(pluginId: string): CoreClient {
    const mockStore = (this as unknown as Record<string, unknown>).__mockData as Record<string, unknown> | undefined;
    return createMockCoreClient(mockStore, pluginId);
  }

  on(event: string, handler: (data: CoreEvent) => void): () => void {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  once(event: string, handler: (data: CoreEvent) => void): void {
    const wrapper = (data: CoreEvent) => {
      handler(data);
      this.off(event, wrapper);
    };
    this.on(event, wrapper);
  }

  off(event: string, handler: (data: CoreEvent) => void): void {
    const handlers = this._listeners.get(event);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) this._listeners.delete(event);
    }
  }

  disconnect(): void {
    this._listeners.clear();
  }
}
