// ─── Test helper: lightweight mock HTTP+WS server ────────────

import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { AddressInfo } from 'net';

export interface TestServer {
  port: number;
  url: string;
  wsUrl: string;
  fetch: (path: string, init?: RequestInit) => Promise<Response>;
  wsConnect: () => Promise<TestWebSocket>;
  close: () => void;
}

interface PendingResponse {
  resolve: (body: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Wraps a raw WebSocket and buffers all incoming messages from
 * the moment of construction (before onopen fires).
 */
export class TestWebSocket {
  private ws: WebSocket;
  private messageBuffer: string[] = [];
  private listeners: Map<string, ((data: string) => void)[]> = new Map();
  private _onOpen: (() => void) | null = null;
  private _onClose: ((code: number, reason: Buffer) => void) | null = null;
  private _onError: ((err: Error) => void) | null = null;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data: Buffer) => {
      const str = data.toString();
      this.messageBuffer.push(str);
      const cls = this.listeners.get('message');
      if (cls) cls.forEach(fn => fn(str));
    });
    this.ws.on('open', () => {
      if (this._onOpen) this._onOpen();
    });
    this.ws.on('close', (code: number, reason: Buffer) => {
      if (this._onClose) this._onClose(code, reason);
    });
    this.ws.on('error', (err: Error) => {
      if (this._onError) this._onError(err);
    });
  }

  get readyState() { return this.ws.readyState; }

  set onopen(fn: (() => void) | null) { this._onOpen = fn; }
  set onclose(fn: ((code: number, reason: Buffer) => void) | null) { this._onClose = fn; }
  set onerror(fn: ((err: Error) => void) | null) { this._onError = fn; }

  send(data: string) { this.ws.send(data); }
  close() { this.ws.close(); }

  /** Return all buffered messages and clear the buffer. */
  getMessages(): string[] {
    const msgs = [...this.messageBuffer];
    this.messageBuffer = [];
    return msgs;
  }

  /**
   * Wait for a message matching predicate. Checks buffer first,
   * then waits for incoming messages.
   */
  waitForMessage(
    predicate: (msg: string) => boolean,
    timeout = 5000
  ): Promise<string> {
    // Check buffer first
    const bufIdx = this.messageBuffer.findIndex(predicate);
    if (bufIdx >= 0) {
      const msg = this.messageBuffer.splice(bufIdx, 1)[0];
      return Promise.resolve(msg);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('waitForMessage timed out'));
      }, timeout);
      const handler = (data: string) => {
        if (predicate(data)) {
          cleanup();
          resolve(data);
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        const cls = this.listeners.get('message');
        if (cls) {
          const idx = cls.indexOf(handler);
          if (idx >= 0) cls.splice(idx, 1);
        }
      };
      const cls = this.listeners.get('message') || [];
      cls.push(handler);
      this.listeners.set('message', cls);
    });
  }

  /**
   * Collect exactly `count` messages within timeout.
   */
  collectMessages(count: number, timeout = 5000): Promise<string[]> {
    const collected: string[] = [];
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`collectMessages: got ${collected.length}/${count} within ${timeout}ms`));
      }, timeout);
      const handler = (data: string) => {
        collected.push(data);
        if (collected.length >= count) {
          cleanup();
          resolve(collected);
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        const cls = this.listeners.get('message');
        if (cls) {
          const idx = cls.indexOf(handler);
          if (idx >= 0) cls.splice(idx, 1);
        }
      };
      const cls = this.listeners.get('message') || [];
      cls.push(handler);
      this.listeners.set('message', cls);
    });
  }
}

/**
 * Create a lightweight mock HTTP+WS server for testing.
 * Does NOT import or use the real relay-server.
 */
export async function startTestServer(): Promise<TestServer> {
  const httpServer = createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');

    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const path = url.pathname;

    // Health check
    if (path === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: 123 }));
      return;
    }

    // Info endpoint
    if (path === '/api/info') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        cwd: '/test/project',
        projectName: 'test-project',
        pid: 12345,
        mode: 'default',
        claudeVersion: '0.5.0-test',
        uptime: 123,
      }));
      return;
    }

    // Checkpoints endpoint
    if (path === '/api/checkpoints') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ checkpoints: [], count: 0 }));
      return;
    }

    // Session switch
    if (path === '/api/session/switch' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', directory: url.searchParams.get('dir') || '' }));
      return;
    }

    // Process list
    if (path === '/api/processes') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ processes: [] }));
      return;
    }

    // Process kill
    if (path === '/api/processes/kill' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // Active session
    if (path === '/api/active-session') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessionId: 'default' }));
      return;
    }

    // 404
    res.writeHead(404);
    res.end('Not found');
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws, req) => {
    // Auto-respond to auth challenge
    ws.on('message', (data: Buffer) => {
      const msg = data.toString();
      try {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'auth') {
          ws.send(JSON.stringify({ type: 'auth_result', success: true }));
        }
      } catch { /* ignore non-JSON messages */ }
    });
  });

  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      const addr = httpServer.address() as AddressInfo;
      const port = addr.port;
      const host = `http://127.0.0.1:${port}`;
      const wsHost = `ws://127.0.0.1:${port}`;

      resolve({
        port,
        url: host,
        wsUrl: wsHost,
        fetch: async (path: string, init?: RequestInit) => {
          return fetch(`${host}${path}`, init);
        },
        wsConnect: () => {
          const tws = new TestWebSocket(`${wsHost}/ws`);
          return Promise.resolve(tws);
        },
        close: () => {
          wss.close();
          httpServer.close();
        },
      });
    });
  });
}
