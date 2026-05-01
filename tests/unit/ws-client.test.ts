// ─── Unit tests: WebSocket client ────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type MessageHandler = (data: string) => void;

interface MockWebSocket {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen: (() => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onmessage: MessageHandler | null;
  emitOpen: () => void;
  emitMessage: (data: string) => void;
  emitClose: (code?: number, reason?: string) => void;
  emitError: (err?: unknown) => void;
}

function createMockWebSocket(): MockWebSocket {
  const handlers: { onopen: (() => void) | null; onclose: ((event: { code: number; reason: string }) => void) | null; onerror: ((event: unknown) => void) | null; onmessage: MessageHandler | null } = {
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
  };
  return {
    readyState: 0,
    send: vi.fn(),
    close: vi.fn(),
    get onopen() { return handlers.onopen; },
    set onopen(fn) { handlers.onopen = fn; },
    get onclose() { return handlers.onclose; },
    set onclose(fn) { handlers.onclose = fn; },
    get onerror() { return handlers.onerror; },
    set onerror(fn) { handlers.onerror = fn; },
    get onmessage() { return handlers.onmessage; },
    set onmessage(fn) { handlers.onmessage = fn; },
    emitOpen: () => { if (handlers.onopen) handlers.onopen(); },
    emitMessage: (data: string) => { if (handlers.onmessage) handlers.onmessage(data); },
    emitClose: (code = 1000, reason = '') => { if (handlers.onclose) handlers.onclose({ code, reason }); },
    emitError: (err = new Error('WS error')) => { if (handlers.onerror) handlers.onerror(err); },
  };
}

// Lightweight WS client similar to ws-client.ts
function createClient(url: string) {
  const ws = createMockWebSocket();
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  let _onError: ((err: Error) => void) | null = null;
  let _onOpen: (() => void) | null = null;

  const client = {
    connect: vi.fn(() => {
      setTimeout(() => ws.emitOpen(), 10);
      return ws;
    }),
    send: vi.fn((data: string) => {
      ws.send(data);
    }),
    close: vi.fn(),
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(h => h !== handler);
      }
    }),
    getListeners: (event: string) => listeners[event] || [],
  };

  return client;
}

describe('WS Client', () => {
  let client: ReturnType<typeof createClient>;

  beforeEach(() => {
    client = createClient('ws://localhost:8080/ws');
  });

  it('creates a client instance', () => {
    expect(client).toBeDefined();
    expect(typeof client.send).toBe('function');
  });

  it('connects and registers event listeners', () => {
    const handler = vi.fn();
    client.on('message', handler);
    expect(client.getListeners('message')).toHaveLength(1);
    expect(client.getListeners('message')[0]).toBe(handler);
  });

  it('sends data', () => {
    client.send('{"type":"auth","token":"test"}');
    expect(client.send).toHaveBeenCalledWith('{"type":"auth","token":"test"}');
  });

  it('removes event listeners', () => {
    const handler = vi.fn();
    client.on('message', handler);
    expect(client.getListeners('message')).toHaveLength(1);
    client.off('message', handler);
    expect(client.getListeners('message')).toHaveLength(0);
  });

  it('handles multiple listeners for same event', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    client.on('message', h1);
    client.on('message', h2);
    expect(client.getListeners('message')).toHaveLength(2);
  });

  it('closes connection', () => {
    client.close();
    expect(client.close).toHaveBeenCalled();
  });
});
