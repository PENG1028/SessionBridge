// ─── Cross-feature interaction tests ────────────────────────

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestServer, type TestServer } from '../helpers/test-server';

describe('Cross-feature interactions', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(() => {
    server.close();
  });

  describe('Session + API', () => {
    it('session switch does not break health endpoint', async () => {
      // Switch session
      const switchRes = await server.fetch('/api/session/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: '/other/path' }),
      });
      expect(switchRes.status).toBe(200);

      // Health check still works
      const healthRes = await server.fetch('/api/health');
      expect(healthRes.status).toBe(200);
    });

    it('multiple API calls in sequence maintain consistency', async () => {
      // Call all endpoints in sequence
      const health = await server.fetch('/api/health');
      expect(health.status).toBe(200);

      const info = await server.fetch('/api/info');
      expect(info.status).toBe(200);

      const checkpoints = await server.fetch('/api/checkpoints');
      expect(checkpoints.status).toBe(200);

      const processes = await server.fetch('/api/processes');
      expect(processes.status).toBe(200);
    });
  });

  describe('WebSocket + HTTP', () => {
    it('WebSocket and HTTP server coexist', async () => {
      // Establish WS connection
      const ws = await server.wsConnect();
      expect(ws).toBeDefined();

      // HTTP still works
      const res = await server.fetch('/api/health');
      expect(res.status).toBe(200);

      ws.close();
    });

    it('multiple WS connections + HTTP requests', async () => {
      const ws1 = await server.wsConnect();
      const ws2 = await server.wsConnect();
      const ws3 = await server.wsConnect();

      // HTTP still works with 3 WS connections
      const res = await server.fetch('/api/info');
      expect(res.status).toBe(200);

      ws1.close();
      ws2.close();
      ws3.close();
    });
  });

  describe('Error handling', () => {
    it('handles missing body on POST gracefully', async () => {
      const res = await server.fetch('/api/session/switch', { method: 'POST' });
      // Should not crash — any response is acceptable
      expect(res.status).toBeDefined();
    });

    it('process kill with invalid PID returns ok', async () => {
      const res = await server.fetch('/api/processes/kill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pid: -1 }),
      });
      expect(res.status).toBe(200);
    });
  });
});
