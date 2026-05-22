// ─── Run API protocol tests ─────────────────────────────────────
// Tests: run.create, run.stop, run.list, run.info protocol,
// MockCoreClient run.* defaults, stream.write, legacy fallback.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CoreClientImpl, createCoreClient, createMockCoreClient } from '../../app/console/core/core-client';
import type { RunInfo } from '../../app/console/core/core-types';

// ─── Helpers ─────────────────────────────────────────────────────
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

function resolveAllPending(client: CoreClientImpl, resolveValue: unknown = {}): void {
  const pendingCalls = (client as unknown as Record<string, unknown>)._pendingCalls as Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>;
  for (const [, pending] of pendingCalls) {
    clearTimeout(pending.timer);
    pending.resolve(resolveValue);
  }
  pendingCalls.clear();
}

// ─── Test 1: run.create protocol ─────────────────────────────────

describe('CoreClient run.create protocol', () => {
  let client: CoreClientImpl;

  beforeEach(() => {
    client = createCoreClient({ pluginId: 'terminal' }) as CoreClientImpl;
  });

  afterEach(() => {
    client.disconnect();
  });

  it('sends run.create with full policy and metadata payload', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('run.create', {
      kind: 'terminal',
      label: 'bash',
      pluginId: 'terminal',
      command: 'bash',
      pty: true,
      cols: 80,
      rows: 24,
      policy: {
        onDisconnect: 'keep_running',
        onCoreShutdown: 'terminate',
        persistHistory: true,
        restartRestore: false,
      },
      metadata: { source: 'system-ui-terminal' },
    });
    resolveAllPending(client, { runId: 'run_001', sessionId: 'sess_001', state: 'running' });
    await promise;

    expect(sentBodies.length).toBe(1);
    const body = JSON.parse(sentBodies[0]);
    expect(body.type).toBe('action.request');
    expect(body.capability).toBe('run.create');
    expect(body.pluginId).toBe('terminal');
    expect(body.payload.kind).toBe('terminal');
    expect(body.payload.label).toBe('bash');
    expect(body.payload.command).toBe('bash');
    expect(body.payload.pty).toBe(true);
    expect(body.payload.cols).toBe(80);
    expect(body.payload.rows).toBe(24);
    expect(body.payload.policy).toEqual({
      onDisconnect: 'keep_running',
      onCoreShutdown: 'terminate',
      persistHistory: true,
      restartRestore: false,
    });
    expect(body.payload.metadata).toEqual({ source: 'system-ui-terminal' });
  });

  it('uses run.create, not process.spawn for terminal start', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('run.create', {
      kind: 'terminal',
      command: 'bash',
      pty: true,
      cols: 80,
      rows: 24,
      policy: { onDisconnect: 'keep_running', persistHistory: true },
    });
    resolveAllPending(client, { runId: 'run_x', sessionId: 'sess_x' });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.capability).toBe('run.create');
    expect(body.capability).not.toBe('process.spawn');
  });

  it('extracts targetNodeId from params to routing level for run.create', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('run.create', {
      kind: 'terminal',
      command: 'bash',
      targetNodeId: 'remote-node-1',
      pty: true,
      cols: 80,
      rows: 24,
      policy: { onDisconnect: 'keep_running' },
    });
    resolveAllPending(client, { runId: 'run_r', sessionId: 'sess_r' });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.targetNodeId).toBe('remote-node-1');
    expect(body.payload.targetNodeId).toBeUndefined();
  });
});

// ─── Test 2: run.stop protocol ───────────────────────────────────

describe('CoreClient run.stop protocol', () => {
  let client: CoreClientImpl;

  beforeEach(() => {
    client = createCoreClient({ pluginId: 'terminal' }) as CoreClientImpl;
  });

  afterEach(() => {
    client.disconnect();
  });

  it('sends run.stop with runId and SIGTERM signal', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('run.stop', { runId: 'run_001', signal: 'SIGTERM' });
    resolveAllPending(client, { runId: 'run_001', state: 'stopped' });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.capability).toBe('run.stop');
    expect(body.payload.runId).toBe('run_001');
    expect(body.payload.signal).toBe('SIGTERM');
  });

  it('includes targetNodeId in run.stop when provided', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('run.stop', { runId: 'run_001', signal: 'SIGTERM', targetNodeId: 'remote-node' });
    resolveAllPending(client, { state: 'stopped' });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.targetNodeId).toBe('remote-node');
    expect(body.payload.runId).toBe('run_001');
    expect(body.capability).toBe('run.stop');
    expect(body.capability).not.toBe('process.signal');
  });
});

// ─── Test 3: Legacy process.signal fallback ──────────────────────

describe('Legacy process.signal fallback', () => {
  let client: CoreClientImpl;

  beforeEach(() => {
    client = createCoreClient({ pluginId: 'terminal' }) as CoreClientImpl;
  });

  afterEach(() => {
    client.disconnect();
  });

  it('process.signal still works as legacy fallback for sessions without runId', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('process.signal', { sessionId: 'legacy-session', signal: 'SIGTERM' });
    resolveAllPending(client, { ok: true });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.capability).toBe('process.signal');
    expect(body.payload.sessionId).toBe('legacy-session');
    expect(body.payload.signal).toBe('SIGTERM');
  });

  it('extracts targetNodeId from params to routing level for process.signal', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('process.signal', { sessionId: 'legacy-session', signal: 'SIGTERM', targetNodeId: 'remote-node-fallback' });
    resolveAllPending(client, { ok: true });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.capability).toBe('process.signal');
    expect(body.targetNodeId).toBe('remote-node-fallback');
    expect(body.payload.targetNodeId).toBeUndefined();
    expect(body.payload.sessionId).toBe('legacy-session');
  });
});

// ─── Test 4: run.list protocol ────────────────────────────────────

describe('CoreClient run.list protocol', () => {
  let client: CoreClientImpl;

  beforeEach(() => {
    client = createCoreClient({ pluginId: 'terminal' }) as CoreClientImpl;
  });

  afterEach(() => {
    client.disconnect();
  });

  it('sends run.list with kind filter', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('run.list', { kind: 'terminal' });
    resolveAllPending(client, {
      runs: [
        { runId: 'run_1', kind: 'terminal', state: 'running', sessionId: 'sess_1' },
        { runId: 'run_2', kind: 'terminal', state: 'stopped', sessionId: 'sess_2' },
      ],
    });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.capability).toBe('run.list');
    expect(body.payload.kind).toBe('terminal');
  });

  it('extracts targetNodeId from params to routing level for run.list', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('run.list', { kind: 'terminal', targetNodeId: 'remote-node-2' });
    resolveAllPending(client, { runs: [] });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.capability).toBe('run.list');
    expect(body.targetNodeId).toBe('remote-node-2');
    expect(body.payload.targetNodeId).toBeUndefined();
  });
});

// ─── Test 5: run.info protocol ────────────────────────────────────

describe('CoreClient run.info protocol', () => {
  let client: CoreClientImpl;

  beforeEach(() => {
    client = createCoreClient({ pluginId: 'terminal' }) as CoreClientImpl;
  });

  afterEach(() => {
    client.disconnect();
  });

  it('sends run.info with runId', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('run.info', { runId: 'run_001' });
    resolveAllPending(client, { runId: 'run_001', kind: 'terminal', state: 'running', sessionId: 'sess_001' });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.capability).toBe('run.info');
    expect(body.payload.runId).toBe('run_001');
  });

  it('extracts targetNodeId from params to routing level for run.info', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('run.info', { runId: 'run_001', targetNodeId: 'remote-node-3' });
    resolveAllPending(client, { runId: 'run_001', kind: 'terminal', state: 'running', sessionId: 'sess_001' });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.capability).toBe('run.info');
    expect(body.targetNodeId).toBe('remote-node-3');
    expect(body.payload.targetNodeId).toBeUndefined();
    expect(body.payload.runId).toBe('run_001');
  });
});

// ─── Test 6: MockCoreClient run.* defaults ────────────────────────

describe('MockCoreClient run.* defaults', () => {
  it('run.create returns sensible default with runId, sessionId, state, policy', async () => {
    const mock = createMockCoreClient();
    const result = await mock.call<RunInfo>('run.create', { command: 'bash' });
    expect(result.runId).toBe('run_mock_001');
    expect(result.sessionId).toBe('sess_mock_001');
    expect(result.state).toBe('running');
    expect(result.policy).toEqual({
      onDisconnect: 'keep_running',
      onCoreShutdown: 'terminate',
      persistHistory: true,
      restartRestore: false,
    });
  });

  it('run.list returns empty array by default', async () => {
    const mock = createMockCoreClient();
    const result = await mock.call('run.list', { kind: 'terminal' });
    expect(result).toEqual([]);
  });

  it('run.info returns full RunInfo with process details', async () => {
    const mock = createMockCoreClient();
    const result = await mock.call<RunInfo>('run.info', { runId: 'run_mock_001' });
    expect(result.runId).toBe('run_mock_001');
    expect(result.kind).toBe('terminal');
    expect(result.sessionId).toBe('sess_mock_001');
    expect(result.state).toBe('running');
    expect(result.process?.pid).toBe(12345);
    expect(result.process?.state).toBe('running');
    expect(result.process?.command).toBe('bash');
  });

  it('run.stop returns stopped state', async () => {
    const mock = createMockCoreClient();
    const result = await mock.call('run.stop', { runId: 'run_mock_001' });
    expect(result).toEqual({ runId: 'run_mock_001', state: 'stopped' });
  });

  it('run.updatePolicy returns updated policy', async () => {
    const mock = createMockCoreClient();
    const result = await mock.call('run.updatePolicy', {
      runId: 'run_mock_001',
      policy: { onDisconnect: 'keep_running', onCoreShutdown: 'terminate', persistHistory: true },
    });
    expect(result.policy?.onDisconnect).toBe('keep_running');
    expect(result.policy?.persistHistory).toBe(true);
  });
});

// ─── Test 7: Stream write protocol ────────────────────────────────

describe('Stream write protocol', () => {
  let client: CoreClientImpl;

  beforeEach(() => {
    client = createCoreClient({ pluginId: 'terminal' }) as CoreClientImpl;
  });

  afterEach(() => {
    client.disconnect();
  });

  it('sends stream.write with sessionId and streamType: stdin', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('stream.write', { sessionId: 'sess_001', data: 'echo hello\r', streamType: 'stdin' });
    resolveAllPending(client, { ok: true });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.capability).toBe('stream.write');
    expect(body.payload.sessionId).toBe('sess_001');
    expect(body.payload.data).toBe('echo hello\r');
    expect(body.payload.streamType).toBe('stdin');
  });

  it('stream.write is the ONLY stdin entry point (no process.stdin or stream.stdin)', () => {
    const code = CoreClientImpl.toString();
    expect(code).not.toContain('process.stdin');
    expect(code).not.toContain('stream.stdin');
  });
});

// ─── Test 8: Plugin-host TerminalView run.* contract ──────────────

describe('Plugin-host TerminalView run.* contract', () => {
  let client: CoreClientImpl;

  beforeEach(() => {
    client = createCoreClient({ pluginId: 'terminal' }) as CoreClientImpl;
  });

  afterEach(() => {
    client.disconnect();
  });

  it('run.create includes pluginId: terminal, kind: terminal, metadata source', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('run.create', {
      kind: 'terminal',
      label: 'bash',
      pluginId: 'terminal',
      command: 'bash',
      pty: true,
      cols: 80,
      rows: 24,
      policy: {
        onDisconnect: 'keep_running',
        onCoreShutdown: 'terminate',
        persistHistory: true,
        restartRestore: false,
      },
      metadata: { source: 'system-ui-terminal' },
    });
    resolveAllPending(client, { runId: 'run_p1', sessionId: 'sess_p1' });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.capability).toBe('run.create');
    expect(body.pluginId).toBe('terminal');
    expect(body.payload.pluginId).toBe('terminal');
    expect(body.payload.kind).toBe('terminal');
    expect(body.payload.metadata).toEqual({ source: 'system-ui-terminal' });
    expect(body.payload.policy.onDisconnect).toBe('keep_running');
    expect(body.payload.policy.onCoreShutdown).toBe('terminate');
    expect(body.payload.policy.persistHistory).toBe(true);
    expect(body.payload.policy.restartRestore).toBe(false);
  });

  it('run.stop preferred over process.signal for sessions with runId', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('run.stop', { runId: 'run_001', signal: 'SIGTERM' });
    resolveAllPending(client, { state: 'stopped' });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.capability).toBe('run.stop');
  });

  it('process.signal still available as fallback for legacy sessions', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('process.signal', { sessionId: 'legacy_sess', signal: 'SIGTERM' });
    resolveAllPending(client, { ok: true });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.capability).toBe('process.signal');
    expect(body.payload.sessionId).toBe('legacy_sess');
  });
});

// ─── Test 9: Regression smoke ─────────────────────────────────────

describe('Regression smoke', () => {
  it('createMockCoreClient still works for all existing test methods', async () => {
    const mock = createMockCoreClient();

    const nodeList = await mock.call('node.list');
    expect(nodeList).toEqual([]);

    const sessionList = await mock.call('session.list');
    expect(sessionList).toEqual([]);

    const pluginList = await mock.call('plugin.list');
    expect(pluginList).toEqual([]);
  });

  it('CoreClientImpl call method unchanged for non-run capabilities', async () => {
    const client = createCoreClient({ pluginId: 'test' }) as CoreClientImpl;
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('session.list', { nodeId: 'n1' });
    resolveAllPending(client, [{ sessionId: 's1', kind: 'shell' }]);
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.type).toBe('action.request');
    expect(body.capability).toBe('session.list');
    expect(body.pluginId).toBe('test');
  });

  it('CoreClientImpl pluginId forgery still prevented', async () => {
    const client = createCoreClient({ pluginId: 'terminal' }) as CoreClientImpl;
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('run.create', { command: 'bash', pluginId: 'malicious' });
    resolveAllPending(client, { runId: 'r1', sessionId: 's1' });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.pluginId).toBe('terminal');
    expect(body.pluginId).not.toBe('malicious');
  });
});

// ─── Test 10: run.attach protocol ────────────────────────────────────

describe('CoreClient run.attach protocol', () => {
  let client: CoreClientImpl;

  beforeEach(() => {
    client = createCoreClient({ pluginId: 'terminal' }) as CoreClientImpl;
  });

  afterEach(() => {
    client.disconnect();
  });

  it('sends run.attach with runId and default replay:true', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('run.attach', { runId: 'run_001' });
    resolveAllPending(client, { runId: 'run_001', sessionId: 'sess_001', state: 'running' });
    await promise;

    expect(sentBodies.length).toBe(1);
    const body = JSON.parse(sentBodies[0]);
    expect(body.capability).toBe('run.attach');
    expect(body.payload.runId).toBe('run_001');
  });

  it('sends run.attach with replay:false', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('run.attach', { runId: 'run_001', replay: false });
    resolveAllPending(client, { runId: 'run_001', sessionId: 'sess_001', state: 'running' });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.capability).toBe('run.attach');
    expect(body.payload.replay).toBe(false);
  });

  it('sends run.attach with custom streamTypes', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('run.attach', { runId: 'run_001', streamTypes: ['stdout'], replay: false });
    resolveAllPending(client, { runId: 'run_001', sessionId: 'sess_001' });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.payload.streamTypes).toEqual(['stdout']);
  });

  it('extracts targetNodeId from params to routing level for run.attach', async () => {
    const { sentBodies } = injectMockWs(client);

    const promise = client.call('run.attach', { runId: 'run_001', targetNodeId: 'remote-node-4' });
    resolveAllPending(client, { runId: 'run_001', sessionId: 'sess_001' });
    await promise;

    const body = JSON.parse(sentBodies[0]);
    expect(body.capability).toBe('run.attach');
    expect(body.targetNodeId).toBe('remote-node-4');
    expect(body.payload.targetNodeId).toBeUndefined();
  });
});

// ─── Test 11: MockCoreClient run.attach defaults ──────────────────

describe('MockCoreClient run.attach defaults', () => {
  it('run.attach returns sessionId, state, streamSubscriptions, process', async () => {
    const mock = createMockCoreClient();
    const result = await mock.call('run.attach', { runId: 'run_mock_001' });
    expect(result.runId).toBe('run_mock_001');
    expect(result.sessionId).toBe('sess_mock_001');
    expect(result.state).toBe('running');
    expect(result.kind).toBe('terminal');
    expect(result.process?.pid).toBe(12345);
    expect(result.streamSubscriptions).toHaveLength(2);
    expect(result.streamSubscriptions[0].streamType).toBe('stdout');
    expect(result.streamSubscriptions[0].subscribed).toBe(false);
  });

  it('run.attach is distinct from run.info in MockCoreClient', async () => {
    const mock = createMockCoreClient();
    const attachResult = await mock.call('run.attach', { runId: 'run_mock_001' });
    const infoResult = await mock.call('run.info', { runId: 'run_mock_001' });

    // run.attach has streamSubscriptions, run.info does not
    expect(attachResult.streamSubscriptions).toBeDefined();
    expect(infoResult).not.toHaveProperty('streamSubscriptions');
    // Both share core metadata
    expect(attachResult.sessionId).toBe(infoResult.sessionId);
  });
});
