// ─── Integration tests: agent registration over WebSocket ─────

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';

function connect(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
  });
}

function waitForMessage(ws: WebSocket, predicate: (msg: any) => boolean, timeout = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for message')), timeout);
    const handler = (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (predicate(msg)) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(msg);
        }
      } catch {}
    };
    ws.on('message', handler);
  });
}

describe('Agent Registration', () => {
  let server: { close: () => void; port: number };

  beforeAll(async () => {
    process.env.SB_TEST_MODE = '1';
    const { startRelayServer } = await import('../../src/relay-server');
    server = await startRelayServer(0);
  });

  afterAll(() => {
    process.env.SB_TEST_MODE = '';
    server.close();
  });

/**
 * Normalize a parsed message: if it's a v1 envelope, extract the body fields
 * to top level so tests can access msg.instanceId etc. regardless of format.
 */
function normalize(msg: any): any {
  if (msg && msg.v === 1 && msg.body) {
    return { ...msg.body, type: msg.type, _raw: msg };
  }
  return msg;
}

  it('registers a remote agent via WebSocket', async () => {
    const ws = await connect(server.port);
    ws.send(JSON.stringify({ type: 'agent_register', dir: '/test/agent', label: 'test-agent' }));

    const response = normalize(await waitForMessage(ws, (m: any) => {
      const n = normalize(m);
      return n.type === 'agent.registered' || n.type === 'agent_registered';
    }));
    expect(response.instanceId).toBeTruthy();
    expect(typeof response.instanceId).toBe('string');
    ws.close();
  });

  it('forwards agent_stdout to stream parser and broadcasts blocks', async () => {
    // Connect an observer WS (receives broadcasts) and an agent WS
    const observer = await connect(server.port);
    const agent = await connect(server.port);

    // Register agent (need hello first for new protocol)
    agent.send(JSON.stringify({ type: 'agent_register', dir: '/test/agent', label: 'stdout-test' }));
    const regMsg = normalize(await waitForMessage(agent, (m: any) => {
      const n = normalize(m);
      return n.type === 'agent.registered' || n.type === 'agent_registered';
    }));
    const instanceId = regMsg.instanceId;

    // Send agent_stdout from the agent WS (old type still works)
    agent.send(JSON.stringify({
      type: 'agent_stdout',
      instanceId,
      line: JSON.stringify({ type: 'result', subtype: 'success', model: 'parse-test', tokens: 50 }),
    }));

    // Observer should receive the parsed blocks via broadcast (new format)
    const output = normalize(await waitForMessage(observer, (m: any) => {
      const n = normalize(m);
      return n.type === 'instance.block' && n.blockType === 'token_usage';
    }));
    expect(output.model).toBe('parse-test');
    expect(output.tokens).toBe(50);

    agent.close();
    observer.close();
  });

  it('unregisters a remote agent', async () => {
    const ws = await connect(server.port);
    ws.send(JSON.stringify({ type: 'agent_register', dir: '/test/agent', label: 'unreg-test' }));
    const regMsg = normalize(await waitForMessage(ws, (m: any) => {
      const n = normalize(m);
      return n.type === 'agent.registered' || n.type === 'agent_registered';
    }));
    expect(regMsg.instanceId).toBeTruthy();

    ws.send(JSON.stringify({ type: 'agent_unregister', instanceId: regMsg.instanceId }));
    await new Promise(r => setTimeout(r, 300));
    ws.close();
  });

  it('auto-unregisters agent on WebSocket close', async () => {
    const ws = await connect(server.port);
    ws.send(JSON.stringify({ type: 'agent_register', dir: '/test/agent', label: 'auto-unreg' }));
    const regMsg = normalize(await waitForMessage(ws, (m: any) => {
      const n = normalize(m);
      return n.type === 'agent.registered' || n.type === 'agent_registered';
    }));
    expect(regMsg.instanceId).toBeTruthy();

    ws.close();
    await new Promise(r => setTimeout(r, 500));
  });
});
