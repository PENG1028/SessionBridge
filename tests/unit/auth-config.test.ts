import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createAuthConfig,
  verifyPassword,
  signSession,
  verifySession,
  createSession,
  isAuthConfigured,
  loadAuthConfig,
  type AppUiAuthConfig,
} from '../../lib/auth/app-ui-auth';
import { unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';

// Use a temp file for tests to avoid polluting real config
const TEST_AUTH_FILE = join(process.cwd(), '.sessionbridge', 'test-auth.json');

describe('App UI Auth Config', () => {
  beforeEach(async () => {
    // Clean up test file
    try { await unlink(TEST_AUTH_FILE); } catch {}
    // Set env to test file
    process.env.SESSIONBRIDGE_APP_UI_AUTH_FILE = TEST_AUTH_FILE;
  });

  afterEach(async () => {
    try { await unlink(TEST_AUTH_FILE); } catch {}
    delete process.env.SESSIONBRIDGE_APP_UI_AUTH_FILE;
  });

  it('isAuthConfigured returns false when no config exists', async () => {
    const result = await isAuthConfigured();
    expect(result).toBe(false);
  });

  it('createAuthConfig creates config with correct schema', async () => {
    const config = await createAuthConfig('testpassword123');
    expect(config.version).toBe(1);
    expect(config.passwordHash).toBeTruthy();
    expect(config.passwordSalt).toBeTruthy();
    expect(config.sessionSecret).toBeTruthy();
    expect(config.sessionTtlSeconds).toBe(86400);
    expect(config.createdAt).toBeTruthy();
    expect(config.updatedAt).toBeTruthy();
    // Hash should be hex (64 bytes = 128 hex chars for scrypt)
    expect(config.passwordHash.length).toBe(128);
  });

  it('isAuthConfigured returns true after create', async () => {
    await createAuthConfig('testpassword123');
    const result = await isAuthConfigured();
    expect(result).toBe(true);
  });

  it('loadAuthConfig returns valid config after create', async () => {
    await createAuthConfig('testpassword123');
    const config = await loadAuthConfig();
    expect(config).not.toBeNull();
    expect(config!.version).toBe(1);
  });

  it('createAuthConfig rejects short password', async () => {
    await expect(createAuthConfig('1234567')).rejects.toThrow('at least 8');
  });

  it('createAuthConfig rejects existing config', async () => {
    await createAuthConfig('testpassword123');
    await expect(createAuthConfig('testpassword456')).rejects.toThrow('already configured');
  });

  it('createAuthConfig overwrites with force=true', async () => {
    await createAuthConfig('testpassword123');
    const config = await createAuthConfig('testpassword456', true);
    expect(config).toBeTruthy();
    // New password should work
    const valid = await verifyPassword('testpassword456');
    expect(valid).toBe(true);
    // Old password should not work
    const oldValid = await verifyPassword('testpassword123');
    expect(oldValid).toBe(false);
  });

  it('verifyPassword succeeds with correct password', async () => {
    await createAuthConfig('mypassword123');
    const result = await verifyPassword('mypassword123');
    expect(result).toBe(true);
  });

  it('verifyPassword fails with wrong password', async () => {
    await createAuthConfig('mypassword123');
    const result = await verifyPassword('wrongpassword');
    expect(result).toBe(false);
  });

  it('verifyPassword fails on empty password', async () => {
    await createAuthConfig('mypassword123');
    const result = await verifyPassword('');
    expect(result).toBe(false);
  });
});

describe('Session token signing and verification', () => {
  const secret = Buffer.from('abcdefghijklmnopqrstuvwxyz0123456789abcdef', 'utf-8').toString('base64');

  it('signSession produces a valid token', () => {
    const payload = { sid: 'test123', iat: Date.now(), exp: Date.now() + 86400000 };
    const token = signSession(payload, secret);
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('verifySession returns correct payload', () => {
    const payload = { sid: 'test123', iat: Date.now(), exp: Date.now() + 86400000 };
    const token = signSession(payload, secret);
    const result = verifySession(token, secret);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.sid).toBe('test123');
    }
  });

  it('verifySession rejects expired token', () => {
    const payload = { sid: 'test123', iat: Date.now() - 100000, exp: Date.now() - 1000 };
    const token = signSession(payload, secret);
    const result = verifySession(token, secret);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('expired');
    }
  });

  it('verifySession rejects tampered token', () => {
    const payload = { sid: 'test123', iat: Date.now(), exp: Date.now() + 86400000 };
    const token = signSession(payload, secret);
    const tampered = token.slice(0, -1) + 'x';
    const result = verifySession(tampered, secret);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid');
  });

  it('verifySession rejects malformed token', () => {
    const result = verifySession('not-a-valid-token', secret);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('malformed');
  });

  it('verifySession rejects missing cookie', () => {
    const result = verifySession(undefined, secret);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing');
  });

  it('verifySession rejects empty cookie', () => {
    const result = verifySession('', secret);
    expect(result.ok).toBe(false);
    // Empty string is falsy, treated as missing
    expect(result.reason).toBe('missing');
  });

  it('verifySession rejects wrong secret', () => {
    const payload = { sid: 'test123', iat: Date.now(), exp: Date.now() + 86400000 };
    const token = signSession(payload, secret);
    const wrongSecret = Buffer.from('0000000000000000000000000000000000000000', 'utf-8').toString('base64');
    const result = verifySession(token, wrongSecret);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid');
  });
});

describe('createSession integration', () => {
  beforeEach(async () => {
    try { await unlink(TEST_AUTH_FILE); } catch {}
    process.env.SESSIONBRIDGE_APP_UI_AUTH_FILE = TEST_AUTH_FILE;
  });

  afterEach(async () => {
    try { await unlink(TEST_AUTH_FILE); } catch {}
    delete process.env.SESSIONBRIDGE_APP_UI_AUTH_FILE;
  });

  it('createSession produces a valid session token from config', async () => {
    const config = await createAuthConfig('testpassword123');
    const token = createSession(config);
    const result = verifySession(token, config.sessionSecret);
    expect(result.ok).toBe(true);
  });
});
