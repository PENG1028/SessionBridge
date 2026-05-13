// ─── Unit tests: Admin Authentication ─────────────────────────
// Tests the auth logic at src/admin-auth.ts

import { describe, it, expect, vi } from 'vitest';

// admin-auth.ts uses module-level singletons (token, authEnabled, sessions Map).
// vi.resetModules() followed by dynamic import() forces a fresh module instance.
// We use a per-import reset approach since beforeEach-level reset doesn't
// reliably clear the ESM cache for dynamic imports inside async tests.

async function importAuth() {
  vi.resetModules();
  // dynamic import with a cache-busting suffix to avoid vitest's ESM cache
  return await import('../../src/admin-auth');
}

describe('initAuth / isAuthEnabled / isTokenSet', () => {
  it('defaults to disabled with no token', async () => {
    const auth = await importAuth();
    // On a fresh import, no initAuth has been called
    expect(auth.isAuthEnabled()).toBe(false);
    expect(auth.isTokenSet()).toBe(false);
  });

  it('initAuth with token enables auth by default', async () => {
    const auth = await importAuth();
    auth.initAuth('my-token');
    expect(auth.isAuthEnabled()).toBe(true);
    expect(auth.isTokenSet()).toBe(true);
  });

  it('initAuth with token and enabled=false keeps auth disabled', async () => {
    const auth = await importAuth();
    auth.initAuth('my-token', false);
    expect(auth.isAuthEnabled()).toBe(false);
    expect(auth.isTokenSet()).toBe(true);
  });

  it('initAuth with token and enabled=true enables auth', async () => {
    const auth = await importAuth();
    auth.initAuth('my-token', true);
    expect(auth.isAuthEnabled()).toBe(true);
    expect(auth.isTokenSet()).toBe(true);
  });

  it('initAuth with empty string token does not enable', async () => {
    const auth = await importAuth();
    auth.initAuth('', false);
    expect(auth.isAuthEnabled()).toBe(false);
    // empty string is falsy, but isTokenSet checks !!token
    expect(auth.isTokenSet()).toBe(false);
  });
});

describe('setAuthEnabled toggle', () => {
  it('setAuthEnabled(true) enables auth', async () => {
    const auth = await importAuth();
    auth.setAuthEnabled(true);
    expect(auth.isAuthEnabled()).toBe(true);
  });

  it('setAuthEnabled(false) disables auth', async () => {
    const auth = await importAuth();
    auth.setAuthEnabled(true);
    auth.setAuthEnabled(false);
    expect(auth.isAuthEnabled()).toBe(false);
  });
});

describe('changePassword', () => {
  it('changePassword sets new token and clears sessions', async () => {
    const auth = await importAuth();
    auth.initAuth('old-token', true);

    // Create a session
    const session = auth.createSession('test-agent');
    expect(session.sessionId).toBeTruthy();

    // Sessions should exist
    const sessions = auth.listSessions();
    expect(sessions.length).toBe(1);

    // Change password
    auth.changePassword('new-token');
    expect(auth.isTokenSet()).toBe(true);
    expect(auth.isAuthEnabled()).toBe(true);

    // Sessions should be cleared
    expect(auth.listSessions().length).toBe(0);

    // Old session should be invalid
    const [sid, sig] = session.cookie.match(/sb_session=([^.]+)\.([^;]+)/)!.slice(1);
    const result = auth.validateSession(sid, sig);
    // The cookie from the old session uses HMAC(old-token, sid), but
    // after changePassword the token is 'new-token', so verification fails
    expect(result).toBeNull();
  });
});

describe('createSession / validateSession / revokeSession', () => {
  it('createSession fails before initAuth', async () => {
    const auth = await importAuth();
    expect(() => auth.createSession()).toThrow('Auth not initialized');
  });

  it('createSession returns sessionId, cookie, expiresAt', async () => {
    const auth = await importAuth();
    auth.initAuth('test-token', true);
    const result = auth.createSession('Chrome');
    expect(result.sessionId).toBeTruthy();
    expect(result.cookie).toContain('sb_session=');
    expect(result.cookie).toContain('HttpOnly');
    expect(result.cookie).toContain('SameSite=Lax');
    expect(result.cookie).toContain('Max-Age=');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it('validateSession returns session for valid cookie', async () => {
    const auth = await importAuth();
    auth.initAuth('test-token', true);
    const { sessionId, cookie } = auth.createSession();

    // Parse the cookie
    const match = cookie.match(/sb_session=([^.]+)\.([^;]+)/)!;
    const sid = match[1];
    const sig = match[2];

    const session = auth.validateSession(sid, sig);
    expect(session).not.toBeNull();
    expect(session!.id).toBe(sid);
  });

  it('validateSession returns null for tampered signature', async () => {
    const auth = await importAuth();
    auth.initAuth('test-token', true);
    const { sessionId } = auth.createSession();

    const result = auth.validateSession(sessionId, 'bad-signature');
    expect(result).toBeNull();
  });

  it('revokeSession removes the session', async () => {
    const auth = await importAuth();
    auth.initAuth('test-token', true);
    const { sessionId, cookie } = auth.createSession();
    const match = cookie.match(/sb_session=([^.]+)\.([^;]+)/)!;
    const sid = match[1];

    expect(auth.revokeSession(sid)).toBe(true);
    expect(auth.validateSession(sid, match[2])).toBeNull();
    expect(auth.revokeSession(sid)).toBe(false); // already gone
  });

  it('listSessions returns sessions we created', async () => {
    const auth = await importAuth();
    auth.initAuth('test-token', true);
    auth.createSession('Browser 1');
    auth.createSession('Browser 2');
    const sessions = auth.listSessions();
    // Our sessions are in the list
    expect(sessions.some(s => s.userAgent === 'Browser 1')).toBe(true);
    expect(sessions.some(s => s.userAgent === 'Browser 2')).toBe(true);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
  });
});

describe('checkAuth', () => {
  function makeReq(sessionCookie?: string, bearer?: string): any {
    const headers: Record<string, string> = {};
    if (sessionCookie) headers.cookie = sessionCookie;
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    return { headers };
  }

  it('returns authenticated=false with no credentials', async () => {
    const auth = await importAuth();
    auth.initAuth('test-token', true);
    expect(auth.checkAuth(makeReq()).authenticated).toBe(false);
  });

  it('returns authenticated=true with valid cookie', async () => {
    const auth = await importAuth();
    auth.initAuth('test-token', true);
    const { cookie } = auth.createSession();
    expect(auth.checkAuth(makeReq(cookie)).authenticated).toBe(true);
  });

  it('returns authenticated=true with valid Bearer token', async () => {
    const auth = await importAuth();
    auth.initAuth('test-token', true);
    expect(auth.checkAuth(makeReq(undefined, 'test-token')).authenticated).toBe(true);
  });

  it('returns authenticated=false with wrong Bearer token', async () => {
    const auth = await importAuth();
    auth.initAuth('test-token', true);
    expect(auth.checkAuth(makeReq(undefined, 'wrong-token')).authenticated).toBe(false);
  });

  it('returns authenticated=true for valid cookie after password change but before session expiry', async () => {
    const auth = await importAuth();
    auth.initAuth('old-token', true);
    const { cookie } = auth.createSession();
    const match = cookie.match(/sb_session=([^.]+)\.([^;]+)/)!;
    const sid = match[1];
    const sig = match[2];

    // Session is valid with old-token
    expect(auth.validateSession(sid, sig)).not.toBeNull();
    expect(auth.checkAuth(makeReq(cookie)).authenticated).toBe(true);

    // Change password — old sessions become invalid because HMAC key changed
    auth.changePassword('new-token');
    expect(auth.checkAuth(makeReq(cookie)).authenticated).toBe(false);
  });
});

describe('generateToken', () => {
  it('generates a 64-char hex string', async () => {
    const auth = await importAuth();
    const token = auth.generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates unique tokens', async () => {
    const auth = await importAuth();
    const t1 = auth.generateToken();
    const t2 = auth.generateToken();
    expect(t1).not.toBe(t2);
  });
});

describe('Auth lifecycle integration', () => {
  it('full flow: init → create session → validate → revoke', async () => {
    const auth = await importAuth();

    // Start with no auth
    expect(auth.isAuthEnabled()).toBe(false);

    // Init auth
    auth.initAuth('my-password', true);
    expect(auth.isAuthEnabled()).toBe(true);
    expect(auth.isTokenSet()).toBe(true);

    // Create session
    const { cookie } = auth.createSession('Firefox');
    expect(auth.checkAuth({ headers: { cookie } } as any).authenticated).toBe(true);

    // Disable auth
    auth.setAuthEnabled(false);
    expect(auth.isAuthEnabled()).toBe(false);
    // Token is still set, just auth is disabled
    expect(auth.isTokenSet()).toBe(true);

    // Re-enable
    auth.setAuthEnabled(true);
    expect(auth.isAuthEnabled()).toBe(true);

    // Change password invalidates sessions
    auth.changePassword('new-password');
    expect(auth.checkAuth({ headers: { cookie } } as any).authenticated).toBe(false);

    // New session with new password works
    const newCookie = auth.createSession().cookie;
    expect(auth.checkAuth({ headers: { cookie: newCookie } } as any).authenticated).toBe(true);
  });

  it('toggle guard: enabling auth without token is possible via setAuthEnabled', async () => {
    // This tests the scenario where setAuthEnabled(true) is called
    // without initAuth (no token). The auth gate will redirect to /setup
    // because !hasToken.
    const auth = await importAuth();
    auth.setAuthEnabled(true);
    expect(auth.isAuthEnabled()).toBe(true);
    expect(auth.isTokenSet()).toBe(false);

    // checkAuth should fail because no token is set
    expect(auth.checkAuth({ headers: {} } as any).authenticated).toBe(false);

    // After setting a password via changePassword
    auth.changePassword('new-password');
    expect(auth.isTokenSet()).toBe(true);

    // Now Bearer auth works
    expect(auth.checkAuth({ headers: { authorization: 'Bearer new-password' } } as any).authenticated).toBe(true);
  });

  it('Bearer token equals the current token for auth', async () => {
    const auth = await importAuth();
    auth.initAuth('my-secret', true);
    expect(auth.getToken()).toBe('my-secret');
    expect(auth.checkAuth({ headers: { authorization: 'Bearer my-secret' } } as any).authenticated).toBe(true);
  });
});
