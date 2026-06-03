// ─── Auth Route Handler Tests ────────────────────────────
// Tests the App UI auth route handlers (setup, login, logout, status)
// and auth protection on /api/core/call and /api/core/events.
//
// These are unit tests with mocked auth library functions.
// Full E2E with Go Core requires integration test setup.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the auth library before importing routes
const mockVerifySessionFromCookie = vi.fn();
const mockCreateAuthConfig = vi.fn();
const mockCreateSession = vi.fn();
const mockVerifyPassword = vi.fn();
const mockIsAuthConfigured = vi.fn();
const mockGetSessionTtlSeconds = vi.fn();
const mockLoadAuthConfig = vi.fn();

vi.mock('../../lib/auth/app-ui-auth', () => ({
  verifySessionFromCookie: (...args: any[]) => mockVerifySessionFromCookie(...args),
  createAuthConfig: (...args: any[]) => mockCreateAuthConfig(...args),
  createSession: (...args: any[]) => mockCreateSession(...args),
  verifyPassword: (...args: any[]) => mockVerifyPassword(...args),
  isAuthConfigured: (...args: any[]) => mockIsAuthConfigured(...args),
  getSessionTtlSeconds: (...args: any[]) => mockGetSessionTtlSeconds(...args),
  loadAuthConfig: (...args: any[]) => mockLoadAuthConfig(...args),
}));

import { POST as setupPost } from '../../app/api/auth/setup/route';
import { POST as loginPost } from '../../app/api/auth/login/route';
import { POST as logoutPost } from '../../app/api/auth/logout/route';
import { GET as statusGet } from '../../app/api/auth/status/route';
import { POST as coreCallPost } from '../../app/api/core/call/route';
import { GET as coreEventsGet } from '../../app/api/core/events/route';

// ─── Helpers ─────────────────────────────────────────

function mockRequest(body?: unknown, cookieValue?: string): any {
  return {
    json: async () => body,
    url: 'http://localhost:3000/api/auth/setup',
    headers: new Map(),
    cookies: {
      get: (_name: string) =>
        cookieValue ? { value: cookieValue } : undefined,
    },
  };
}

// ─── Tests ───────────────────────────────────────────

describe('GET /api/auth/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns configured=false when no auth config exists', async () => {
    mockIsAuthConfigured.mockResolvedValue(false);
    mockGetSessionTtlSeconds.mockResolvedValue(86400);
    mockVerifySessionFromCookie.mockResolvedValue({ ok: false, reason: 'missing' });

    const res = await statusGet(mockRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.configured).toBe(false);
    expect(json.authenticated).toBe(false);
  });

  it('returns configured=true + authenticated=false when unauthenticated', async () => {
    mockIsAuthConfigured.mockResolvedValue(true);
    mockGetSessionTtlSeconds.mockResolvedValue(86400);
    mockVerifySessionFromCookie.mockResolvedValue({ ok: false, reason: 'expired' });

    const res = await statusGet(mockRequest(undefined, 'expired.session.token'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.configured).toBe(true);
    expect(json.authenticated).toBe(false);
  });

  it('returns authenticated=true with valid session cookie', async () => {
    mockIsAuthConfigured.mockResolvedValue(true);
    mockGetSessionTtlSeconds.mockResolvedValue(86400);
    mockVerifySessionFromCookie.mockResolvedValue({
      ok: true,
      payload: { sid: 'test-sid', iat: Date.now(), exp: Date.now() + 86400000 },
    });

    const res = await statusGet(mockRequest(undefined, 'valid.session.token'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.configured).toBe(true);
    expect(json.authenticated).toBe(true);
  });
});

describe('POST /api/auth/setup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when password is missing', async () => {
    const res = await setupPost(mockRequest({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Password is required');
  });

  it('returns 400 when password is too short', async () => {
    const res = await setupPost(mockRequest({ password: '1234567' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('at least 8');
  });

  it('returns 409 when already configured', async () => {
    mockIsAuthConfigured.mockResolvedValue(true);

    const res = await setupPost(mockRequest({ password: 'testpassword123' }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('already configured');
  });

  it('creates config and sets HttpOnly cookie on success', async () => {
    mockIsAuthConfigured.mockResolvedValue(false);
    const mockConfig = {
      version: 1,
      passwordHash: 'a'.repeat(128),
      passwordSalt: 'salt123',
      sessionSecret: 'secret123',
      sessionTtlSeconds: 86400,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockCreateAuthConfig.mockResolvedValue(mockConfig);
    mockCreateSession.mockReturnValue('v1.abc.def');

    const res = await setupPost(mockRequest({ password: 'testpassword123' }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.sessionTtlSeconds).toBe(86400);

    // Check Set-Cookie header
    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('sessionbridge_view=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('SameSite=');
    expect(setCookie).toContain('Max-Age=86400');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when password is missing', async () => {
    const res = await loginPost(mockRequest({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Password is required');
  });

  it('returns 401 on wrong password', async () => {
    mockVerifyPassword.mockResolvedValue(false);

    const res = await loginPost(mockRequest({ password: 'wrongpassword' }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('Invalid password');
  });

  it('sets HttpOnly cookie on successful login', async () => {
    mockVerifyPassword.mockResolvedValue(true);
    const mockConfig = {
      version: 1,
      passwordHash: 'a'.repeat(128),
      passwordSalt: 'salt123',
      sessionSecret: 'secret123',
      sessionTtlSeconds: 86400,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockLoadAuthConfig.mockResolvedValue(mockConfig);
    mockCreateSession.mockReturnValue('v1.xyz.789');

    const res = await loginPost(mockRequest({ password: 'correctpassword' }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('sessionbridge_view=v1.xyz.789');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Max-Age=86400');
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const res = await logoutPost();
    expect(res.status).toBe(200);

    const setCookie = res.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('sessionbridge_view=');
    expect(setCookie).toContain('Max-Age=0');
    expect(setCookie).toContain('HttpOnly');
  });
});

describe('/api/core/call auth protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without session cookie', async () => {
    mockVerifySessionFromCookie.mockResolvedValue({ ok: false, reason: 'missing' });

    const res = await coreCallPost(mockRequest({ method: 'node.health' }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('Authentication required');
  });

  it('returns 401 with expired session cookie', async () => {
    mockVerifySessionFromCookie.mockResolvedValue({ ok: false, reason: 'expired' });

    const res = await coreCallPost(mockRequest({ method: 'node.health' }, 'expired.token'));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('Authentication required');
  });

  it('returns 400 when method is missing', async () => {
    mockVerifySessionFromCookie.mockResolvedValue({
      ok: true,
      payload: { sid: 's1', iat: Date.now(), exp: Date.now() + 86400000 },
    });

    const res = await coreCallPost(mockRequest({}, 'valid.token'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('method is required');
  });
});

describe('/api/core/events auth protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without session cookie', async () => {
    mockVerifySessionFromCookie.mockResolvedValue({ ok: false, reason: 'missing' });

    const res = await coreEventsGet(mockRequest(undefined));
    expect(res.status).toBe(401);
  });

  it('returns 401 with expired session cookie', async () => {
    mockVerifySessionFromCookie.mockResolvedValue({ ok: false, reason: 'expired' });

    const res = await coreEventsGet(mockRequest(undefined, 'expired.token'));
    expect(res.status).toBe(401);
  });
});
