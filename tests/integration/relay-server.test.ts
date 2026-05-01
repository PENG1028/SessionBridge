// ─── Integration tests: relay server endpoints ───────────────

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, type TestServer } from '../helpers/test-server';

describe('Relay Server HTTP API', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(() => {
    server.close();
  });

  describe('GET /api/health', () => {
    it('returns status ok', async () => {
      const res = await server.fetch('/api/health');
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string; uptime: number };
      expect(body.status).toBe('ok');
      expect(typeof body.uptime).toBe('number');
    });
  });

  describe('GET /api/info', () => {
    it('returns project info', async () => {
      const res = await server.fetch('/api/info');
      expect(res.status).toBe(200);
      const body = await res.json() as { cwd: string; projectName: string; pid: number; mode: string; claudeVersion: string };
      expect(body.cwd).toBe('/test/project');
      expect(body.projectName).toBe('test-project');
      expect(typeof body.pid).toBe('number');
    });

    it('returns expected mode field', async () => {
      const res = await server.fetch('/api/info');
      const body = await res.json() as { mode: string };
      expect(body.mode).toBe('default');
    });
  });

  describe('GET /api/checkpoints', () => {
    it('returns checkpoint list', async () => {
      const res = await server.fetch('/api/checkpoints');
      expect(res.status).toBe(200);
      const body = await res.json() as { checkpoints: unknown[]; count: number };
      expect(Array.isArray(body.checkpoints)).toBe(true);
      expect(typeof body.count).toBe('number');
    });
  });

  describe('POST /api/session/switch', () => {
    it('returns ok for valid request', async () => {
      const res = await server.fetch('/api/session/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: '/new/path' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string };
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /api/processes', () => {
    it('returns process list', async () => {
      const res = await server.fetch('/api/processes');
      expect(res.status).toBe(200);
      const body = await res.json() as { processes: unknown[] };
      expect(Array.isArray(body.processes)).toBe(true);
    });
  });

  describe('POST /api/processes/kill', () => {
    it('returns ok', async () => {
      const res = await server.fetch('/api/processes/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid: 9999 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string };
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /api/active-session', () => {
    it('returns session ID', async () => {
      const res = await server.fetch('/api/active-session');
      expect(res.status).toBe(200);
      const body = await res.json() as { sessionId: string };
      expect(typeof body.sessionId).toBe('string');
      expect(body.sessionId).toBe('default');
    });
  });

  describe('404 handling', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await server.fetch('/api/unknown');
      expect(res.status).toBe(404);
    });
  });
});

describe('Relay Server WebSocket', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(() => {
    server.close();
  });

  it('establishes WebSocket connection', async () => {
    const ws = await server.wsConnect();
    expect(ws).toBeDefined();
    expect(ws.readyState).toBe(0); // WebSocket.CONNECTING or OPEN
    ws.close();
  });

  it('receives auth challenge on connect', async () => {
    const ws = await server.wsConnect();
    // Send auth
    ws.send(JSON.stringify({ type: 'auth', token: 'test-token' }));
    const msg = await ws.waitForMessage((m: string) => m.includes('auth_result'), 3000);
    expect(msg).toContain('auth_result');
    ws.close();
  });

  it('handles multiple messages', async () => {
    const ws = await server.wsConnect();
    ws.send(JSON.stringify({ type: 'auth', token: 'test-token' }));
    await ws.waitForMessage((m: string) => m.includes('auth_result'), 3000);

    // Exchange multiple messages
    ws.send(JSON.stringify({ type: 'ping' }));
    const responses = await ws.collectMessages(2, 3000);
    expect(responses.length).toBe(2);
    ws.close();
  });

  it('handles concurrent connections', async () => {
    const ws1 = await server.wsConnect();
    const ws2 = await server.wsConnect();
    expect(ws1).toBeDefined();
    expect(ws2).toBeDefined();
    ws1.close();
    ws2.close();
  });
});
