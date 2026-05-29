// ─── ProxyCoreClient Realtime Event Tests ─────────────────────────
// Tests the SSE-based event subscription system in ProxyCoreClient.
// EventSource is mocked to simulate Core events without a real server.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProxyCoreClient } from '../../app/console/core/proxy-core-client';
import type { CoreEvent } from '../../app/console/core/core-types';

// ─── Fake EventSource for testing ───────────────────────────────

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;

  static instances: FakeEventSource[] = [];

  readyState: number = FakeEventSource.CONNECTING;
  url: string;
  withCredentials: boolean;

  private _listeners = new Map<string, Set<(event: Event | MessageEvent) => void>>();

  constructor(url: string, opts?: EventSourceInit) {
    this.url = url;
    this.withCredentials = opts?.withCredentials ?? false;
    FakeEventSource.instances.push(this);

    // Simulate immediate HTTP connection — the Core WS bridge may not be open yet
    process.nextTick(() => {
      if (this.readyState !== FakeEventSource.CLOSED) {
        this.readyState = FakeEventSource.OPEN;
        const openEv = new Event('open');
        this._listeners.get('open')?.forEach(h => h(openEv));
      }
    });
  }

  addEventListener(type: string, handler: (event: Event | MessageEvent) => void): void {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, new Set());
    }
    this._listeners.get(type)!.add(handler);
  }

  removeEventListener(type: string, handler: (event: Event | MessageEvent) => void): void {
    const handlers = this._listeners.get(type);
    if (handlers) handlers.delete(handler);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
    this._listeners.clear();
    const idx = FakeEventSource.instances.indexOf(this);
    if (idx >= 0) FakeEventSource.instances.splice(idx, 1);
  }

  /** Test helper: dispatch an SSE 'core' event with given JSON data. */
  dispatchCoreEvent(data: object): void {
    const msgEvent = { data: JSON.stringify(data) } as MessageEvent;
    this._listeners.get('core')?.forEach(h => h(msgEvent));
  }

  /** Test helper: dispatch an SSE 'error' event type. */
  dispatchSSEError(data?: object): void {
    const msgEvent = { data: data ? JSON.stringify(data) : '' } as MessageEvent;
    this._listeners.get('error')?.forEach(h => h(msgEvent));
  }

  /** Test helper: trigger onerror (network error, EventSource auto-reconnects). */
  triggerNetworkError(): void {
    this.readyState = FakeEventSource.CONNECTING;
    const ev = new Event('error');
    // ProxyCoreClient uses addEventListener('error') but also the onerror property
    this._listeners.get('error')?.forEach(h => h(ev));
  }

  static reset(): void {
    FakeEventSource.instances = [];
  }

  static lastInstance(): FakeEventSource | undefined {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }
}

// Patch global EventSource
const OriginalEventSource = globalThis.EventSource;

// ─── Tests ──────────────────────────────────────────────────────

describe('ProxyCoreClient realtime events', () => {
  let client: ProxyCoreClient;

  beforeEach(() => {
    FakeEventSource.reset();
    (globalThis as any).EventSource = FakeEventSource as any;
    client = new ProxyCoreClient('test-plugin');
  });

  afterEach(() => {
    client.disconnect();
    FakeEventSource.reset();
    (globalThis as any).EventSource = OriginalEventSource;
  });

  // ── Connection lifecycle ────────────────────────────────

  it('starts as disconnected', () => {
    expect(client.isConnected).toBe(false);
    expect(client.connectionStatus).toBe('disconnected');
  });

  it('transitions to connecting when on() is called', () => {
    client.on('stream.chunk', () => {});
    const instances = FakeEventSource.instances;
    expect(instances.length).toBe(1);
    expect(instances[0].url).toBe('/api/core/events/');
    expect(instances[0].withCredentials).toBe(true);
  });

  it('transitions to connected on connected event', () => {
    const statuses: string[] = [];
    (client as any)._statusListeners.add((s: string) => statuses.push(s));

    client.on('stream.chunk', () => {});
    const es = FakeEventSource.lastInstance()!;

    // Connected event means Core WS bridge is up
    es.dispatchCoreEvent({ type: 'connected', pluginId: 'test-plugin' });

    expect(client.isConnected).toBe(true);
    expect(client.connectionStatus).toBe('connected');
    expect(statuses).toContain('connected');
  });

  it('marks disconnected on transport error', () => {
    client.on('stream.chunk', () => {});
    const es = FakeEventSource.lastInstance()!;
    es.dispatchCoreEvent({ type: 'connected', pluginId: 'test-plugin' });
    expect(client.isConnected).toBe(true);

    // Simulate SSE network loss
    es.triggerNetworkError();

    expect(client.isConnected).toBe(false);
  });

  it('marks error on SSE error event with message', () => {
    client.on('stream.chunk', () => {});
    const es = FakeEventSource.lastInstance()!;
    es.dispatchCoreEvent({ type: 'connected', pluginId: 'test-plugin' });
    expect(client.isConnected).toBe(true);

    // SSE error event with JSON payload
    es.dispatchSSEError({ type: 'error', message: 'Core connection timeout' });

    // Error status should be set
    expect(client.isConnected).toBe(false);
    expect(client.connectionStatus).toBe('error');
  });

  // ── Event subscription ──────────────────────────────────

  it('dispatches stream.chunk to subscribers', () => {
    const chunks: CoreEvent[] = [];
    client.on('stream.chunk', (data) => chunks.push(data));

    const es = FakeEventSource.lastInstance()!;
    es.dispatchCoreEvent({ type: 'connected', pluginId: 'test-plugin' });

    es.dispatchCoreEvent({
      type: 'stream.chunk',
      sessionId: 'sess_001',
      streamType: 'stdout',
      eventSeq: 1,
      data: 'hello\r\n',
    });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('stream.chunk');
    if (chunks[0].type === 'stream.chunk') {
      expect(chunks[0].sessionId).toBe('sess_001');
      expect(chunks[0].data).toBe('hello\r\n');
    }
  });

  it('dispatches notify.approval.request to subscribers', () => {
    const approvals: CoreEvent[] = [];
    client.on('notify.approval.request', (data) => approvals.push(data));

    const es = FakeEventSource.lastInstance()!;
    es.dispatchCoreEvent({ type: 'connected', pluginId: 'test-plugin' });

    es.dispatchCoreEvent({
      type: 'notify.approval.request',
      requestId: 'req_001',
      pluginId: 'test-plugin',
      payload: { action: 'run.create', detail: { command: 'rm -rf /' } },
    });

    expect(approvals).toHaveLength(1);
    if (approvals[0].type === 'notify.approval.request') {
      expect(approvals[0].requestId).toBe('req_001');
    }
  });

  it('dispatches session.created to subscribers', () => {
    const events: CoreEvent[] = [];
    client.on('session.created', (data) => events.push(data));

    const es = FakeEventSource.lastInstance()!;
    es.dispatchCoreEvent({ type: 'connected', pluginId: 'test-plugin' });

    es.dispatchCoreEvent({
      type: 'session.created',
      sessionId: 'sess_002',
      kind: 'terminal',
      nodeId: 'node_01',
    });

    expect(events).toHaveLength(1);
    if (events[0].type === 'session.created') {
      expect(events[0].sessionId).toBe('sess_002');
    }
  });

  it('once() fires only once', () => {
    const calls: CoreEvent[] = [];
    client.once('stream.chunk', (data) => calls.push(data));

    const es = FakeEventSource.lastInstance()!;
    es.dispatchCoreEvent({ type: 'connected', pluginId: 'test-plugin' });

    es.dispatchCoreEvent({ type: 'stream.chunk', sessionId: 's1', streamType: 'stdout', eventSeq: 1, data: 'a' });
    es.dispatchCoreEvent({ type: 'stream.chunk', sessionId: 's1', streamType: 'stdout', eventSeq: 2, data: 'b' });

    expect(calls).toHaveLength(1);
  });

  it('off() removes handler', () => {
    const calls: CoreEvent[] = [];
    const handler = (data: CoreEvent) => calls.push(data);
    client.on('stream.chunk', handler);

    const es = FakeEventSource.lastInstance()!;
    es.dispatchCoreEvent({ type: 'connected', pluginId: 'test-plugin' });

    es.dispatchCoreEvent({ type: 'stream.chunk', sessionId: 's1', streamType: 'stdout', eventSeq: 1, data: 'a' });
    expect(calls).toHaveLength(1);

    client.off('stream.chunk', handler);
    es.dispatchCoreEvent({ type: 'stream.chunk', sessionId: 's1', streamType: 'stdout', eventSeq: 2, data: 'b' });
    expect(calls).toHaveLength(1); // no second call
  });

  // ── Wildcard listener ───────────────────────────────────

  it('supports wildcard (*) listeners', () => {
    const allEvents: CoreEvent[] = [];
    client.on('*', (data) => allEvents.push(data));

    const es = FakeEventSource.lastInstance()!;
    es.dispatchCoreEvent({ type: 'connected', pluginId: 'test-plugin' });
    es.dispatchCoreEvent({ type: 'stream.chunk', sessionId: 's1', streamType: 'stdout', eventSeq: 1, data: 'x' });

    // connected + stream.chunk, plus any connectionStatus events
    expect(allEvents.length).toBeGreaterThanOrEqual(2);
  });

  // ── call() still works independently ─────────────────────

  it('call() throws without a server (no real fetch)', async () => {
    await expect(client.call('node.health', {})).rejects.toThrow();
  });

  it('call() sends actor pluginId separately from payload pluginId', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      expect(body.pluginId).toBe('test-plugin');
      expect(body.params.pluginId).toBe('terminal');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(client.call('plugin.get', { pluginId: 'terminal' })).resolves.toEqual({ ok: true });

    vi.unstubAllGlobals();
  });

  it('scoped call sends scoped actor pluginId without overwriting payload pluginId', async () => {
    const scoped = client.createScopedClient('terminal');
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || '{}'));
      expect(body.pluginId).toBe('terminal');
      expect(body.params.pluginId).toBe('target-plugin');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(scoped.call('plugin.get', { pluginId: 'target-plugin' })).resolves.toEqual({ ok: true });

    vi.unstubAllGlobals();
  });

  // ── Disconnect cleanup ──────────────────────────────────

  it('disconnect() closes EventSource and clears listeners', () => {
    client.on('stream.chunk', () => {});
    const es = FakeEventSource.lastInstance()!;
    expect(es.readyState).toBe(FakeEventSource.CONNECTING);

    client.disconnect();

    expect(client.isConnected).toBe(false);
    expect(client.connectionStatus).toBe('disconnected');
    // After disconnect, calling on() should not reconnect
    client.on('stream.chunk', () => {});
    // No new instances should be created (disconnected flag prevents it)
    expect(FakeEventSource.instances.length).toBe(0);
  });

  // ── Single EventSource for multiple listeners ───────────

  it('creates only one EventSource for multiple on() calls', () => {
    client.on('stream.chunk', () => {});
    client.on('notify.approval.request', () => {});
    client.on('session.created', () => {});

    expect(FakeEventSource.instances.length).toBe(1);
  });

  // ── Token safety ────────────────────────────────────────

  it('EventSource URL does not contain Core token', () => {
    client.on('stream.chunk', () => {});
    const es = FakeEventSource.lastInstance()!;
    expect(es.url).toBe('/api/core/events/');
    expect(es.url).not.toContain('token');
  });

  // ── onStatusChange subscription ─────────────────────────

  it('onStatusChange notifies on status transitions', () => {
    const statuses: string[] = [];
    const unsub = client.onStatusChange((s) => statuses.push(s));

    // First, subscribe to an event to trigger SSE connection
    client.on('stream.chunk', () => {});

    const es = FakeEventSource.lastInstance()!;
    // Should have received 'connecting' status
    expect(statuses).toContain('connecting');

    // Now simulate Core WS bridge connected
    es.dispatchCoreEvent({ type: 'connected', pluginId: 'test-plugin' });
    expect(statuses).toContain('connected');

    unsub();
  });

  // ── createScopedClient ─────────────────────────────────

  it('createScopedClient inherits events and calls', () => {
    const chunks: CoreEvent[] = [];
    const scoped = client.createScopedClient('scoped-plugin');

    scoped.on('stream.chunk', (data) => chunks.push(data));

    const es = FakeEventSource.lastInstance()!;
    es.dispatchCoreEvent({ type: 'connected', pluginId: 'test-plugin' });
    es.dispatchCoreEvent({ type: 'stream.chunk', sessionId: 's1', streamType: 'stdout', eventSeq: 1, data: 'scoped' });

    expect(chunks).toHaveLength(1);
    expect(scoped.pluginId).toBe('scoped-plugin');
  });
});
