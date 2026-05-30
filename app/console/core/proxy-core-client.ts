'use client';

// ─── Proxy-backed CoreClient with SSE events ────────────────
// Implements the CoreClient interface using:
//   - POST /api/core/call  for core.call(method, params)
//   - SSE /api/core/events  for on/once/off event subscriptions
//
// The browser never holds a Core token. All capability calls are
// proxied through the Next.js server. Real-time events (stream.chunk,
// notify.approval.request, session.event, etc.) arrive via SSE.
//
// Components that use core.on('stream.chunk', handler) work in
// proxy mode.

import type { CoreClient, CoreEvent, CoreConnectionStatus } from './core-types';

export class ProxyCoreClient implements CoreClient {
  readonly pluginId: string;
  readonly wsUrl: string = '/api/core/call';
  readonly hasToken: boolean = false;
  readonly authMode: 'token' | 'none' = 'none';

  // ── SSE event source ──────────────────────────────────────
  private _eventSource: EventSource | null = null;

  // ── Event listeners (same pattern as CoreClientImpl) ──────
  private _eventListeners = new Map<string, Set<(data: CoreEvent) => void>>();
  private _statusListeners = new Set<(status: CoreConnectionStatus) => void>();

  // ── Connection state ──────────────────────────────────────
  private _connectionStatus: CoreConnectionStatus = 'disconnected';
  private _isConnected = false;
  private _lastError: string | null = null;
  private _disconnected = false;

  constructor(pluginId = 'sessionnode-core') {
    this.pluginId = pluginId;
  }

  // ── Public accessors ──────────────────────────────────────

  get isConnected(): boolean {
    return this._isConnected;
  }

  get lastError(): string | null {
    return this._lastError;
  }

  get connectionStatus(): CoreConnectionStatus {
    return this._connectionStatus;
  }

  // ── Status change subscription (for provider integration) ─
  onStatusChange(handler: (status: CoreConnectionStatus) => void): () => void {
    this._statusListeners.add(handler);
    return () => this._statusListeners.delete(handler);
  }

  // ── Target node (for mesh routing) ────────────────────────
  private _targetNodeId: string | null = null;

  /** Set the target node ID for mesh routing. Subsequent core.call()
   *  requests will include targetNodeId so the local Core forwards
   *  the capability call to the remote peer via the mesh. */
  setTargetNodeId(nodeId: string | null): void {
    this._targetNodeId = nodeId;
  }

  get targetNodeId(): string | null {
    return this._targetNodeId;
  }

  // ── Core call via HTTP proxy ──────────────────────────────

  async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const body: Record<string, unknown> = { method, params, pluginId: this.pluginId };
    if (this._targetNodeId) {
      const merged = params || {};
      if (!merged.targetNodeId) {
        merged.targetNodeId = this._targetNodeId;
      }
      body.params = merged;
    }
    const res = await fetch('/api/core/call/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });

    if (res.status === 401) {
      this._setStatus('disconnected');
      throw new Error('Authentication required — session expired?');
    }

    const data = await res.json();

    if (!res.ok) {
      const msg = data?.error || `Core call failed (${res.status})`;
      this._lastError = msg;
      throw new Error(msg);
    }

    return data as T;
  }

  // ── Event subscription via SSE ────────────────────────────

  on(event: string, handler: (data: CoreEvent) => void): () => void {
    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Set());
    }
    this._eventListeners.get(event)!.add(handler);

    // Auto-connect SSE on first listener if not already connected
    if (!this._eventSource || this._eventSource.readyState === EventSource.CLOSED) {
      if (!this._disconnected) {
        this._connectSSE();
      }
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
    // Don't close SSE — other handlers may still be subscribed
  }

  // ── Connection management ─────────────────────────────────

  disconnect(): void {
    this._disconnected = true;
    this._closeSSE();
    this._isConnected = false;
    this._connectionStatus = 'disconnected';
    this._eventListeners.clear();
    this._statusListeners.clear();
    this._lastError = null;
  }

  // ── SSE lifecycle ─────────────────────────────────────────

  private _connectSSE(): void {
    if (this._eventSource && this._eventSource.readyState !== EventSource.CLOSED) {
      return; // already connected or connecting
    }

    this._setStatus('connecting');

    try {
      const es = new EventSource('/api/core/events/', { withCredentials: true });

      es.addEventListener('core', (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data);

          // The 'connected' event means the server-side Core WS is open
          if (msg.type === 'connected') {
            this._isConnected = true;
            this._lastError = null;
            this._setStatus('connected');
            this._emit('connected', msg);
            return;
          }

          // Forward all other Core messages to subscribers
          if (msg.type) {
            this._emit(msg.type, msg);
          }
        } catch {
          // Ignore parse errors on individual SSE events
        }
      });

      es.addEventListener('error', (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data);
          this._lastError = msg.message || 'SSE error';
          this._isConnected = false;
          this._setStatus('error');
        } catch {
          // Parse failure in error event — just mark disconnected
          this._lastError = 'SSE connection error';
          this._isConnected = false;
          this._setStatus('disconnected');
        }
      });

      es.onerror = () => {
        // EventSource auto-reconnects on network loss.
        // Mark disconnected so UI can show the transient state.
        this._isConnected = false;
        this._lastError = 'SSE connection lost — auto-reconnecting';
        this._setStatus('disconnected');
      };

      // EventSource 'open' fires when the HTTP connection establishes,
      // but the Core WS bridge may not be open yet.
      // The 'connected' event from SSE tells us the bridge is ready.

      this._eventSource = es;
    } catch (err) {
      this._lastError = err instanceof Error ? err.message : 'Failed to create EventSource';
      this._setStatus('error');
    }
  }

  private _closeSSE(): void {
    if (this._eventSource) {
      this._eventSource.close();
      this._eventSource = null;
    }
  }

  // ── Force-connected (called by CoreClientProvider when probe confirms) ──
  /** Called by CoreClientProvider when the HTTP probe confirms the Core is
   *  reachable, even if SSE hasn't yet delivered the 'connected' event. */
  setConnected(): void {
    this._isConnected = true;
    this._lastError = null;
    this._setStatus('connected');
  }

  // ── Status notification ───────────────────────────────────

  private _setStatus(status: CoreConnectionStatus): void {
    this._connectionStatus = status;
    this._statusListeners.forEach(fn => {
      try { fn(status); } catch { /* listener error */ }
    });
    this._emit('connectionStatus', { type: 'connectionStatus', status, pluginId: this.pluginId });
  }

  // ── Event emission ────────────────────────────────────────

  private _emit(event: string, data: CoreEvent): void {
    const handlers = this._eventListeners.get(event);
    if (handlers) {
      handlers.forEach(fn => {
        try { fn(data); } catch { /* handler error */ }
      });
    }
    // Wildcard listeners
    const allHandlers = this._eventListeners.get('*');
    if (allHandlers) {
      allHandlers.forEach(fn => {
        try { fn(data); } catch { /* handler error */ }
      });
    }
  }

  // ── Scoped client ─────────────────────────────────────────

  createScopedClient(pluginId: string): CoreClient {
    const host = this;
    return {
      pluginId,
      get isConnected() { return host.isConnected; },
      get wsUrl() { return host.wsUrl; },
      get lastError() { return host.lastError; },
      get hasToken() { return host.hasToken; },
      get authMode() { return host.authMode; },
      call: <T>(method: string, params?: Record<string, unknown>) => {
        // Inherit targetNodeId from the host client
        const merged = host._targetNodeId ? { ...params, targetNodeId: host._targetNodeId } : params;
        return host.call<T>(method, merged);
      },
      on: (event: string, handler: (data: CoreEvent) => void) => host.on(event, handler),
      once: (event: string, handler: (data: CoreEvent) => void) => host.once(event, handler),
      off: (event: string, handler: (data: CoreEvent) => void) => host.off(event, handler),
      disconnect: () => {},
    };
  }
}
