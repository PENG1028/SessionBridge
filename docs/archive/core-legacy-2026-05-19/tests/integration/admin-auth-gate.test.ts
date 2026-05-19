// ─── Integration tests: Auth Gate HTTP behavior ──────────────
// Each scenario gets its own server + fresh auth module via vi.resetModules().
// Note: all requests come from 127.0.0.1 (local), so isLocal is always true.
// The "remote no-token → /setup redirect" scenario is pure boolean logic
// tested in the unit tests (admin-auth.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, Server } from 'http';

let server: Server | null = null;

async function startServer(token?: string, authEnabled?: boolean): Promise<number> {
  // Fresh module for each server
  vi.resetModules();
  const auth = await import('../../src/admin-auth');
  if (token) auth.initAuth(token, authEnabled);
  else auth.setAuthEnabled(!!authEnabled);

  server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/api/auth/toggle' && req.method === 'POST') {
      let body = '';
      req.on('data', (c: string) => body += c);
      req.on('end', () => {
        const { enabled } = JSON.parse(body);
        if (enabled && !auth.isTokenSet()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Set a password first' }));
          return;
        }
        auth.setAuthEnabled(enabled);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authEnabled: enabled }));
      });
      return;
    }

    if (pathname === '/api/test/set-password' && req.method === 'POST') {
      let body = '';
      req.on('data', (c: string) => body += c);
      req.on('end', () => {
        const { password } = JSON.parse(body);
        auth.changePassword(password);
        auth.setAuthEnabled(true);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    // Auth gate (same logic as admin-routes.ts)
    const clientAddr = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const isLocal = clientAddr === '127.0.0.1' || clientAddr === '::1' || clientAddr === 'localhost';
    const hasToken = auth.isTokenSet();
    const isPublic =
      pathname === '/api/auth/check' ||
      isLocal ||
      (!hasToken && (pathname === '/setup' || pathname === '/api/auth/setup')) ||
      (hasToken && (pathname === '/login' || pathname === '/api/auth/login'));

    if (!isPublic && (auth.isAuthEnabled() || (!hasToken && !isLocal))) {
      if (!hasToken) {
        if (pathname.startsWith('/api/')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Setup required' }));
        } else {
          res.writeHead(302, { 'Location': '/setup' });
          res.end();
        }
        return;
      }
      const checkResult = auth.checkAuth(req);
      if (!checkResult.authenticated) {
        if (pathname.startsWith('/api/')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized' }));
        } else {
          res.writeHead(302, { 'Location': '/login' });
          res.end();
        }
        return;
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  return new Promise((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const addr = server!.address() as import('net').AddressInfo;
      resolve(addr.port);
    });
  });
}

afterEach(() => {
  if (server) { server.close(); server = null; }
});

async function fetchText(url: string, opts?: RequestInit): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

// ── Tests ─────────────────────────────────────────────────────

describe('auth disabled, no token', () => {
  let port: number;
  beforeEach(async () => { port = await startServer(); });

  it('GET / returns 200', async () => {
    const { status } = await fetchText(`http://127.0.0.1:${port}/`);
    expect(status).toBe(200);
  });

  it('/api/auth/toggle ON returns 400 (no token)', async () => {
    const { status, body } = await fetchText(`http://127.0.0.1:${port}/api/auth/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(status).toBe(400);
    expect(body.error).toBe('Set a password first');
  });
});

describe('auth disabled, with token', () => {
  let port: number;
  beforeEach(async () => { port = await startServer('mypassword', false); });

  it('GET / returns 200 (no login required)', async () => {
    const { status } = await fetchText(`http://127.0.0.1:${port}/`);
    expect(status).toBe(200);
  });
});

describe('auth enabled, with token', () => {
  let port: number;
  beforeEach(async () => { port = await startServer('mypassword', true); });

  // Note: localhost always bypasses the auth gate (isLocal → isPublic).
  // These tests verify that behavior. Remote-access redirect logic is
  // covered by the unit tests (admin-auth.test.ts) which test checkAuth,
  // isAuthEnabled, and isTokenSet in isolation.

  it('localhost access bypasses auth gate (200)', async () => {
    const { status } = await fetchText(`http://127.0.0.1:${port}/`);
    expect(status).toBe(200);
  });

  it('localhost api access bypasses auth gate (200)', async () => {
    const { status } = await fetchText(`http://127.0.0.1:${port}/api/instances`);
    expect(status).toBe(200);
  });

  it('public paths work regardless of auth state', async () => {
    const { status } = await fetchText(`http://127.0.0.1:${port}/api/auth/check`);
    expect(status).toBe(200);
  });

  it('/login page is always public', async () => {
    const { status } = await fetchText(`http://127.0.0.1:${port}/login`);
    expect(status).toBe(200);
  });
});

describe('toggle then set password flow', () => {
  let port: number;
  beforeEach(async () => { port = await startServer(); });

  it('set password via /api/test/set-password then toggle ON works', async () => {
    // Set password
    const r1 = await fetchText(`http://127.0.0.1:${port}/api/test/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'new-password' }),
    });
    expect(r1.status).toBe(200);

    // Now toggle ON should work (was failing with 400 before password set)
    const r2 = await fetchText(`http://127.0.0.1:${port}/api/auth/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(r2.status).toBe(200);
    expect(r2.body.authEnabled).toBe(true);

    // Localhost still bypasses auth gate (by design), so / returns 200
    const r3 = await fetchText(`http://127.0.0.1:${port}/`);
    expect(r3.status).toBe(200);
  });

  it('toggle OFF then ON works after password is set', async () => {
    // First set password
    await fetchText(`http://127.0.0.1:${port}/api/test/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test-pass' }),
    });

    // Toggle OFF
    const r1 = await fetchText(`http://127.0.0.1:${port}/api/auth/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(r1.body.authEnabled).toBe(false);

    // / should be accessible
    const r2 = await fetchText(`http://127.0.0.1:${port}/`);
    expect(r2.status).toBe(200);
  });
});
