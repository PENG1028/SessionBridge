'use client';

// ─── Proxy-backed CoreClient ─────────────────────────────────
// Implements the CoreClient interface using POST /api/core/call
// instead of a direct WebSocket connection.
//
// The browser never holds a Core token. All capability calls
// are proxied through the Next.js server.
//
// Event subscriptions (on/once/off) are not supported in proxy
// mode for real-time streaming. They return no-op cleanup functions.
// Components that need real-time events (terminal output, etc.)
// should use direct CoreClient mode.

import type { CoreClient, CoreEvent, CoreConnectionStatus } from './core-types';

export class ProxyCoreClient implements CoreClient {
  readonly pluginId: string;
  readonly wsUrl: string = '/api/core/call';
  readonly hasToken: boolean = false;
  readonly authMode: 'token' | 'none' = 'none';
  readonly _statusListeners = new Set<(status: CoreConnectionStatus) => void>();
  readonly _eventListeners = new Map<string, Set<(data: CoreEvent) => void>>();

  private _isConnected = false;
  private _lastError: string | null = null;

  constructor(pluginId = 'sessionnode-core') {
    this.pluginId = pluginId;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  get lastError(): string | null {
    return this._lastError;
  }

  setConnected(value: boolean): void {
    if (this._isConnected !== value) {
      this._isConnected = value;
      const status: CoreConnectionStatus = value ? 'connected' : 'disconnected';
      this._statusListeners.forEach(fn => fn(status));
    }
  }

  setError(err: string | null): void {
    this._lastError = err;
  }

  // ─── Core call via server proxy ─────────────────────────────

  async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const res = await fetch('/api/core/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ method, params }),
    });

    if (res.status === 401) {
      this.setConnected(false);
      throw new Error('Authentication required — session expired?');
    }

    const data = await res.json();

    if (!res.ok) {
      const msg = data?.error || `Core call failed (${res.status})`;
      this.setError(msg);
      throw new Error(msg);
    }

    // Success: mark proxy as reachable
    this.setConnected(true);
    this.setError(null);
    return data as T;
  }

  // ─── Event subscription (no-op in proxy mode) ───────────────

  on(_event: string, _handler: (data: CoreEvent) => void): () => void {
    // No-op: real-time events require direct WebSocket to Core.
    // Returns a no-op cleanup function for interface compatibility.
    return () => {};
  }

  once(_event: string, _handler: (data: CoreEvent) => void): void {
    // No-op
  }

  off(_event: string, _handler: (data: CoreEvent) => void): void {
    // No-op
  }

  // ─── Connection management ──────────────────────────────────

  disconnect(): void {
    this.setConnected(false);
    this._eventListeners.clear();
    this._statusListeners.clear();
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
      call: <T>(method: string, params?: Record<string, unknown>) => host.call(method, params),
      on: (event: string, handler: (data: CoreEvent) => void) => host.on(event, handler),
      once: (event: string, handler: (data: CoreEvent) => void) => host.once(event, handler),
      off: (event: string, handler: (data: CoreEvent) => void) => host.off(event, handler),
      disconnect: () => {},
    };
  }
}
