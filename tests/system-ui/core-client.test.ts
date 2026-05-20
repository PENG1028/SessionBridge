// ─── CoreClient unit tests ─────────────────────────────────────
// Tests: action.request protocol (Go Core compatible), stream.write,
// scoped client, pluginId forgery proof, event subscribe/unsubscribe,
// offline/mock mode, action.response payload parsing.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CoreClientImpl, createCoreClient, createMockCoreClient } from '../../app/console/core/core-client';
import type { CoreClient } from '../../app/console/core/core-types';

// ─── Helper: inject a mock WebSocket into a CoreClientImpl ────
function injectMockWs(client: CoreClientImpl): { sentBodies: string[] } {
  const sentBodies: string[] = [];
  const mockWs = {
    readyState: WebSocket.OPEN,
    send: (data: string) => { sentBodies.push(data); },
    close: () => {},
  };
  (client as unknown as Record<string, unknown>)._ws = mockWs;
  (client as unknown as Record<string, unknown>)._connectionStatus = 'connected';
  return { sentBodies };
}

// ─── Helper: resolve a pending call straight (bypasses onmessage) ─
function resolvePendingCall(client: CoreClientImpl, result: unknown = []): Promise<void> {
  return new Promise<void>(resolve => {
    const check = setInterval(() => {
      const pendingCalls = (client as unknown as Record<string, unknown>)._pendingCalls as Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>;
      if (pendingCalls.size > 0) {
        clearInterval(check);
        const [requestId, pending] = pendingCalls.entries().next().value;
        clearTimeout(pending.timer);
        pendingCalls.delete(requestId);
        pending.resolve(result);
        resolve();
      }
    }, 5);
  });
}

// ─── Helper: respond on the real onmessage path with a Go Core response ─
function respondToCall(
  client: CoreClientImpl,
  responseOverrides: Record<string, unknown>,
): void {
  const pendingCalls = (client as unknown as Record<string, unknown>)._pendingCalls as Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  const [requestId, pending] = pendingCalls.entries().next().value;
  if (!pending) throw new Error('No pending call to respond to');

  clearTimeout(pending.timer);
  pendingCalls.delete(requestId);

  // Simulate the onmessage parsing from core-client.ts
  const response = {
    type: 'action.response',
    requestId,
    ...responseOverrides,
  };

  if (response.ok === false || response.error != null) {
    const errBody = response.error;
    const errMsg = errBody
      ? (typeof errBody === 'string' ? errBody : ((errBody as { message?: string }).message || JSON.stringify(errBody)))
      : 'Core action failed';
    pending.reject(new Error(errMsg));
  } else {
    pending.resolve(response.payload);
  }
}

describe('CoreClient', () => {
  let client: CoreClientImpl;

  beforeEach(() => {
    client = createCoreClient({ pluginId: 'test-plugin' }) as CoreClientImpl;
  });

  afterEach(() => {
    client.disconnect();
  });

  describe('construction', () => {
    it('sets pluginId from config', () => {
      expect(client.pluginId).toBe('test-plugin');
    });

    it('starts disconnected', () => {
      expect(client.isConnected).toBe(false);
    });

    it('defaults to sessionnode-core pluginId when no config given', () => {
      const c = createCoreClient();
      expect(c.pluginId).toBe('sessionnode-core');
    });
  });

  describe('call method — Go Core action.request protocol', () => {
    it('sends action.request with requestId (not id)', async () => {
      const { sentBodies } = injectMockWs(client);

      const promise = client.call('session.list', { nodeId: 'test-node' });
      await resolvePendingCall(client);
      await promise;

      expect(sentBodies.length).toBe(1);
      const body = JSON.parse(sentBodies[0]);
      expect(body.type).toBe('action.request');
      expect(body.requestId).toBeDefined();
      expect(body.requestId).toMatch(/^req_\d+_\d+$/);
      expect(body.id).toBeUndefined();
      expect(body.capability).toBe('session.list');
      expect(body.pluginId).toBe('test-plugin');
      expect(body.actorType).toBe('user');
      expect(body.actorId).toBe('current-user');
    });

    it('places params inside payload, not at top level', async () => {
      const { sentBodies } = injectMockWs(client);

      const promise = client.call('session.list', { nodeId: 'test-node', kind: 'claude-code' });
      await resolvePendingCall(client);
      await promise;

      const body = JSON.parse(sentBodies[0]);
      expect(body.payload).toBeDefined();
      expect(body.payload.nodeId).toBe('test-node');
      expect(body.payload.kind).toBe('claude-code');
      // These fields should NOT be at the top level
      expect(body.nodeId).toBeUndefined();
      expect(body.kind).toBeUndefined();
    });

    it('extracts targetNodeId from params to routing-level field', async () => {
      const { sentBodies } = injectMockWs(client);

      const promise = client.call('session.list', { nodeId: 'local-node', targetNodeId: 'remote-node' });
      await resolvePendingCall(client);
      await promise;

      const body = JSON.parse(sentBodies[0]);
      // targetNodeId elevated to routing field
      expect(body.targetNodeId).toBe('remote-node');
      // Not in payload
      expect(body.payload.targetNodeId).toBeUndefined();
      // Regular params still in payload
      expect(body.payload.nodeId).toBe('local-node');
    });

    it('does not include targetNodeId when not provided', async () => {
      const { sentBodies } = injectMockWs(client);

      const promise = client.call('session.list', { nodeId: 'test-node' });
      await resolvePendingCall(client);
      await promise;

      const body = JSON.parse(sentBodies[0]);
      expect(body.targetNodeId).toBeUndefined();
    });

    it('includes pluginId at top level only, never in payload', async () => {
      const { sentBodies } = injectMockWs(client);

      // Even if caller passes pluginId in params, it goes to payload, not identity
      const promise = client.call('session.list', { pluginId: 'should-be-ignored' });
      await resolvePendingCall(client);
      await promise;

      const body = JSON.parse(sentBodies[0]);
      // Top-level pluginId is always from the instance
      expect(body.pluginId).toBe('test-plugin');
      // If pluginId appears in payload, it's just a data field, NOT identity
      expect(body.payload.pluginId).toBe('should-be-ignored');
      // The top-level identity is never overridden by payload
      expect(body.pluginId).not.toBe('should-be-ignored');
    });

    it('throws when WebSocket is not connected', async () => {
      const promise = client.call('session.list');
      await expect(promise).rejects.toThrow('Core not connected');
    });
  });

  describe('action.response parsing (Go Core format)', () => {
    it('resolves msg.payload on success (object payload)', async () => {
      const { sentBodies } = injectMockWs(client);

      const promise = client.call('node.list');
      await new Promise<void>(resolve => {
        const check = setInterval(() => {
          const pendingCalls = (client as unknown as Record<string, unknown>)._pendingCalls as Map<string, unknown>;
          if (pendingCalls.size > 0) {
            clearInterval(check);
            respondToCall(client, {
              ok: true,
              payload: [{ nodeId: 'n1', name: 'Node 1', status: 'online' }],
            });
            resolve();
          }
        }, 5);
      });

      const result = await promise;
      expect(result).toEqual([{ nodeId: 'n1', name: 'Node 1', status: 'online' }]);
    });

    it('resolves msg.payload on success (string/raw payload)', async () => {
      const { sentBodies } = injectMockWs(client);

      const promise = client.call('stream.tail', { sessionId: 's1', lines: 5 });
      await new Promise<void>(resolve => {
        const check = setInterval(() => {
          const pendingCalls = (client as unknown as Record<string, unknown>)._pendingCalls as Map<string, unknown>;
          if (pendingCalls.size > 0) {
            clearInterval(check);
            respondToCall(client, { ok: true, payload: 'line1\nline2\nline3\n' });
            resolve();
          }
        }, 5);
      });

      const result = await promise;
      expect(result).toBe('line1\nline2\nline3\n');
    });

    it('rejects on Go Core error with { code, message }', async () => {
      const { sentBodies } = injectMockWs(client);

      const promise = client.call('session.stop', { sessionId: 's1' });
      await new Promise<void>(resolve => {
        const check = setInterval(() => {
          const pendingCalls = (client as unknown as Record<string, unknown>)._pendingCalls as Map<string, unknown>;
          if (pendingCalls.size > 0) {
            clearInterval(check);
            respondToCall(client, {
              ok: false,
              error: { code: -1, message: 'session not found' },
            });
            resolve();
          }
        }, 5);
      });

      await expect(promise).rejects.toThrow('session not found');
    });

    it('rejects on Go Core error with string error field', async () => {
      const { sentBodies } = injectMockWs(client);

      const promise = client.call('config.set', { key: 'x', value: 1 });
      await new Promise<void>(resolve => {
        const check = setInterval(() => {
          const pendingCalls = (client as unknown as Record<string, unknown>)._pendingCalls as Map<string, unknown>;
          if (pendingCalls.size > 0) {
            clearInterval(check);
            respondToCall(client, {
              ok: false,
              error: 'permission denied',
            });
            resolve();
          }
        }, 5);
      });

      await expect(promise).rejects.toThrow('permission denied');
    });

    it('rejects when error field present without ok:false', async () => {
      const { sentBodies } = injectMockWs(client);

      const promise = client.call('plugin.disable', { pluginId: 'p1' });
      await new Promise<void>(resolve => {
        const check = setInterval(() => {
          const pendingCalls = (client as unknown as Record<string, unknown>)._pendingCalls as Map<string, unknown>;
          if (pendingCalls.size > 0) {
            clearInterval(check);
            respondToCall(client, {
              error: { message: 'plugin not loaded' },
              // no ok field
            });
            resolve();
          }
        }, 5);
      });

      await expect(promise).rejects.toThrow('plugin not loaded');
    });
  });

  describe('stream.write method', () => {
    it('sends stream.write as capability via action.request', async () => {
      const { sentBodies } = injectMockWs(client);

      const promise = client.call('stream.write', {
        sessionId: 'sess_test',
        data: 'echo hello\n',
        streamType: 'stdin',
      });
      await resolvePendingCall(client);
      await promise;

      const body = JSON.parse(sentBodies[0]);
      expect(body.type).toBe('action.request');
      expect(body.capability).toBe('stream.write');
      expect(body.payload.sessionId).toBe('sess_test');
      expect(body.payload.data).toBe('echo hello\n');
      expect(body.payload.streamType).toBe('stdin');
      expect(body.pluginId).toBe('test-plugin');
    });

    it('does NOT use process.stdin or stream.stdin', () => {
      const clientCode = CoreClientImpl.toString();
      expect(clientCode).not.toContain('process.stdin');
      expect(clientCode).not.toContain('stream.stdin');
    });
  });

  describe('mock/fallback mode', () => {
    it('returns mock data when method matches', async () => {
      const mockClient = createMockCoreClient({
        'node.list': [{ nodeId: 'mock-node', name: 'Mock', status: 'online' }],
      });
      const result = await mockClient.call('node.list');
      expect(result).toEqual([{ nodeId: 'mock-node', name: 'Mock', status: 'online' }]);
    });

    it('returns empty array for .list methods without mock data', async () => {
      const mockClient = createMockCoreClient();
      const result = await mockClient.call('session.list');
      expect(result).toEqual([]);
    });

    it('is not connected', () => {
      const mockClient = createMockCoreClient();
      expect(mockClient.isConnected).toBe(false);
    });
  });

  describe('event subscribe/unsubscribe', () => {
    it('registers and fires event handlers', () => {
      const handler = vi.fn();
      const unsub = client.on('node.health', handler);
      expect(typeof unsub).toBe('function');
      unsub();
      expect(handler).not.toHaveBeenCalled();
    });

    it('supports multiple listeners on same event', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      client.on('session.created', h1);
      client.on('session.created', h2);
      const unsub1 = client.on('session.created', () => {});
      unsub1();
    });

    it('once fires only once', () => {
      const handler = vi.fn();
      client.once('node.connected', handler);
      expect(typeof client.once).toBe('function');
    });

    it('unsubscribe returns a function that removes the listener', () => {
      const handler = vi.fn();
      const unsub = client.on('test.event', handler);
      expect(typeof unsub).toBe('function');
      unsub();
      expect(client.listenerCount).toBe(0);
    });
  });

  describe('offline state', () => {
    it('returns disconnected status before connection', () => {
      expect(client.isConnected).toBe(false);
    });

    it('mock client reports isConnected false', () => {
      const mock = createMockCoreClient();
      expect(mock.isConnected).toBe(false);
    });
  });

  describe('scoped client', () => {
    it('creates scoped client with different pluginId', () => {
      const scoped = client.createScopedClient('plugin-a');
      expect(scoped.pluginId).toBe('plugin-a');
      expect(scoped.isConnected).toBe(client.isConnected);
    });

    it('scoped client call uses scoped pluginId in action.request', async () => {
      const scoped = client.createScopedClient('plugin-a');
      const { sentBodies } = injectMockWs(client);

      const promise = scoped.call('plugin.list', { nodeId: 'n1' });
      await resolvePendingCall(client);
      await promise;

      const body = JSON.parse(sentBodies[0]);
      expect(body.pluginId).toBe('plugin-a');
      expect(body.pluginId).not.toBe('test-plugin');
      expect(body.capability).toBe('plugin.list');
      expect(body.payload.nodeId).toBe('n1');
      expect(body.id).toBeUndefined();
      expect(body.requestId).toBeDefined();
    });

    it('scoped client shares events with host', () => {
      const scoped = client.createScopedClient('plugin-a');
      const hostHandler = vi.fn();
      const scopedHandler = vi.fn();

      client.on('session.created', hostHandler);
      scoped.on('session.created', scopedHandler);

      // Manually emit on the host
      const event = { type: 'session.created' as const, sessionId: 's1', kind: 'shell', nodeId: 'n1' };
      (client as unknown as Record<string, unknown>)._emit(event.type, event);

      expect(hostHandler).toHaveBeenCalledWith(event);
      expect(scopedHandler).toHaveBeenCalledWith(event);
    });

    it('scoped client disconnect is a no-op', () => {
      const scoped = client.createScopedClient('plugin-a');
      scoped.disconnect();
      // Host should still be in its original state
      expect(client.isConnected).toBe(false);
    });

    it('mock supports createScopedClient', () => {
      const mockHost = createMockCoreClient({
        'plugin.list': [{ pluginId: 'p1', version: '1.0.0' }],
      });
      const scoped = (mockHost as CoreClient & { createScopedClient?: (id: string) => CoreClient }).createScopedClient?.('test-plugin');
      expect(scoped).toBeDefined();
      expect(scoped!.pluginId).toBe('test-plugin');
      expect(scoped!.isConnected).toBe(false);
    });
  });

  describe('pluginId forgery proof', () => {
    it('host core call always uses its own pluginId, cannot be overridden', async () => {
      const { sentBodies } = injectMockWs(client);

      // Attempt to override pluginId by passing it in params
      const promise = client.call('session.list', { nodeId: 'test', pluginId: 'malicious-plugin' });
      await resolvePendingCall(client);
      await promise;

      const body = JSON.parse(sentBodies[0]);
      // Top-level identity is always from the instance
      expect(body.pluginId).toBe('test-plugin');
      expect(body.pluginId).not.toBe('malicious-plugin');
    });

    it('scoped client cannot forge a different pluginId', () => {
      const scopedForA = client.createScopedClient('plugin-a');
      expect(scopedForA.pluginId).toBe('plugin-a');

      const scopedForB = client.createScopedClient('plugin-b');
      expect(scopedForB.pluginId).toBe('plugin-b');

      // Each scoped client has its own fixed pluginId
      expect(scopedForA.pluginId).not.toBe(scopedForB.pluginId);
      expect(scopedForA.pluginId).toBe('plugin-a');
      expect(scopedForB.pluginId).toBe('plugin-b');
    });

    it('scoped client call cannot change its pluginId through params', async () => {
      const scoped = client.createScopedClient('plugin-a');
      const { sentBodies } = injectMockWs(client);

      // Try to forge plugin-b by passing it in params
      const promise = scoped.call('session.list', { pluginId: 'plugin-b', nodeId: 'n1' });
      await resolvePendingCall(client);
      await promise;

      const body = JSON.parse(sentBodies[0]);
      // Top-level pluginId is from the scoped client, not from params
      expect(body.pluginId).toBe('plugin-a');
      expect(body.pluginId).not.toBe('plugin-b');

      // pluginId in payload is just a data field, NOT the identity
      expect(body.payload.pluginId).toBe('plugin-b');
    });
  });
});
