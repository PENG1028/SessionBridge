// ─── core-url.ts unit tests ────────────────────────────────────
// Tests: stripTokenFromWsUrl, extractTokenFromWsUrl, normalizeWsUrlAndToken,
// buildConnectUrl, sanitizeWsUrlForDisplay

import { describe, it, expect } from 'vitest';
import {
  sanitizeWsUrlForDisplay,
  stripTokenFromWsUrl,
  extractTokenFromWsUrl,
  normalizeWsUrlAndToken,
  buildConnectUrl,
} from '../../app/console/core/core-url';
import { CoreClientImpl } from '../../app/console/core/core-client';

describe('stripTokenFromWsUrl', () => {
  it('strips token from valid URL with only ?token=', () => {
    expect(stripTokenFromWsUrl('ws://host:8080/ws?token=abc')).toBe('ws://host:8080/ws');
  });

  it('strips token from valid URL with preceding params', () => {
    expect(stripTokenFromWsUrl('wss://host/ws?foo=1&token=abc&bar=2')).toBe('wss://host/ws?foo=1&bar=2');
  });

  it('strips token from malformed bare token=secret', () => {
    expect(stripTokenFromWsUrl('token=secret')).toBe('');
  });

  it('handles ws://host/ws token=secret — space is encoded in pathname, not a query param', () => {
    // URL API encodes the space in pathname; no query param `token` exists.
    // This is correct — the "token" text is part of the path, not a ?token= query.
    expect(stripTokenFromWsUrl('ws://host/ws token=secret')).toBe('ws://host/ws%20token=secret');
  });

  it('strips token from malformed ws://host/ws?token=secret#hash', () => {
    // URL API handles hash correctly
    expect(stripTokenFromWsUrl('ws://host/ws?token=secret#hash')).toBe('ws://host/ws#hash');
  });

  it('does NOT strip access_token or refresh_token', () => {
    expect(stripTokenFromWsUrl('ws://host/ws?access_token=abc')).toBe('ws://host/ws?access_token=abc');
    expect(stripTokenFromWsUrl('ws://host/ws?refresh_token=abc')).toBe('ws://host/ws?refresh_token=abc');
  });

  it('returns empty string for falsy input', () => {
    expect(stripTokenFromWsUrl('')).toBe('');
    expect(stripTokenFromWsUrl(null as unknown as string)).toBe('');
    expect(stripTokenFromWsUrl(undefined as unknown as string)).toBe('');
  });

  it('returns original URL when no token present', () => {
    expect(stripTokenFromWsUrl('ws://host/ws')).toBe('ws://host/ws');
    expect(stripTokenFromWsUrl('ws://host/ws?foo=1&bar=2')).toBe('ws://host/ws?foo=1&bar=2');
  });

  it('strips token in middle of multiple tokens (last position)', () => {
    expect(stripTokenFromWsUrl('ws://host/ws?token=abc&other=1')).toBe('ws://host/ws?other=1');
  });

  it('handles double token param (strip both via URL API)', () => {
    const result = stripTokenFromWsUrl('ws://host/ws?token=first&token=second');
    expect(result).not.toContain('token=');
  });

  it('strips token from ws+space pattern without protocol', () => {
    expect(stripTokenFromWsUrl('somehost token=secret')).toBe('somehost');
  });

  it('preserves other params when token is alone', () => {
    const url = new URL('ws://host/ws');
    url.searchParams.set('foo', '1');
    url.searchParams.set('token', 'abc');
    const result = stripTokenFromWsUrl(url.toString());
    expect(result).toContain('foo=1');
    expect(result).not.toContain('token=');
  });
});

describe('extractTokenFromWsUrl', () => {
  it('extracts token from valid URL', () => {
    expect(extractTokenFromWsUrl('ws://host:8080/ws?token=abc')).toBe('abc');
  });

  it('extracts token with special chars (URI-encoded)', () => {
    expect(extractTokenFromWsUrl('ws://host/ws?token=abc%2Fdef')).toBe('abc/def');
  });

  it('extracts token from malformed bare token=secret', () => {
    expect(extractTokenFromWsUrl('token=secret')).toBe('secret');
  });

  it('handles ws://host/ws token=secret — space is encoded in pathname, not a query param', () => {
    // URL API encodes the space in pathname; no query param `token` exists.
    // This is correct — the "token" text is part of the path, not a ?token= query.
    expect(extractTokenFromWsUrl('ws://host/ws token=secret')).toBeUndefined();
  });

  it('does NOT extract from access_token or refresh_token', () => {
    expect(extractTokenFromWsUrl('ws://host/ws?access_token=abc')).toBeUndefined();
    expect(extractTokenFromWsUrl('ws://host/ws?refresh_token=abc')).toBeUndefined();
  });

  it('returns undefined for falsy input', () => {
    expect(extractTokenFromWsUrl('')).toBeUndefined();
    expect(extractTokenFromWsUrl(null as unknown as string)).toBeUndefined();
    expect(extractTokenFromWsUrl(undefined as unknown as string)).toBeUndefined();
  });

  it('extracts token from URL with preceding params', () => {
    expect(extractTokenFromWsUrl('wss://host/ws?foo=1&token=abc&bar=2')).toBe('abc');
  });

  it('extracts token from URL with hash', () => {
    expect(extractTokenFromWsUrl('ws://host/ws?token=secret#hash')).toBe('secret');
  });

  it('returns undefined when no token param', () => {
    expect(extractTokenFromWsUrl('ws://host/ws')).toBeUndefined();
    expect(extractTokenFromWsUrl('ws://host/ws?foo=1')).toBeUndefined();
  });

  it('extracts from malformed inline with other params', () => {
    expect(extractTokenFromWsUrl('foo=1 token=secret bar=2')).toBe('secret');
  });

  it('extracts first token when duplicate params exist (URL API behavior)', () => {
    const tok = extractTokenFromWsUrl('ws://host/ws?token=first&token=second');
    // URL API returns first value for get()
    expect(tok).toBe('first');
  });
});

describe('normalizeWsUrlAndToken', () => {
  it('extracts token from URL when no explicit token', () => {
    const result = normalizeWsUrlAndToken('ws://host/ws?token=abc');
    expect(result.wsUrl).not.toContain('token=');
    expect(result.token).toBe('abc');
  });

  it('explicitToken takes priority over URL token', () => {
    const result = normalizeWsUrlAndToken('ws://host/ws?token=url_token', 'explicit_token');
    expect(result.wsUrl).not.toContain('token=');
    expect(result.token).toBe('explicit_token');
  });

  it('returns undefined token when neither source has token', () => {
    const result = normalizeWsUrlAndToken('ws://host/ws');
    expect(result.wsUrl).toBe('ws://host/ws');
    expect(result.token).toBeUndefined();
  });

  it('preserves non-token query params', () => {
    const result = normalizeWsUrlAndToken('ws://host/ws?foo=1&token=abc&bar=2');
    expect(result.wsUrl).toContain('foo=1');
    expect(result.wsUrl).toContain('bar=2');
    expect(result.wsUrl).not.toContain('token=');
    expect(result.token).toBe('abc');
  });

  it('does not return empty string for token', () => {
    const result = normalizeWsUrlAndToken('ws://host/ws?token=');
    expect(result.token).toBeUndefined();
  });

  it('explicitToken empty string treated as undefined', () => {
    const result = normalizeWsUrlAndToken('ws://host/ws?token=abc', '');
    expect(result.token).toBeUndefined();
    // url token is still stripped
    expect(result.wsUrl).not.toContain('token=');
  });
});

describe('buildConnectUrl', () => {
  it('appends ?token= when wsUrl has no query params', () => {
    const url = buildConnectUrl('ws://host/ws', 'abc');
    expect(url).toContain('?token=');
    expect(url).toBe('ws://host/ws?token=abc');
  });

  it('appends &token= when wsUrl already has query params', () => {
    const url = buildConnectUrl('ws://host/ws?foo=1', 'abc');
    expect(url).toContain('&token=');
    expect(url).toBe('ws://host/ws?foo=1&token=abc');
  });

  it('returns wsUrl as-is when no token', () => {
    expect(buildConnectUrl('ws://host/ws')).toBe('ws://host/ws');
    expect(buildConnectUrl('ws://host/ws?foo=1')).toBe('ws://host/ws?foo=1');
  });

  it('preserves hash when using URL API', () => {
    const url = buildConnectUrl('ws://host/ws?foo=1#heading', 'abc');
    expect(url).toBe('ws://host/ws?foo=1&token=abc#heading');
  });

  it('handles malformed URL without crashing', () => {
    const url = buildConnectUrl('ws://host/ws token=oldtok', 'abc');
    // Fallback should still attempt to work
    expect(url).toContain('token=abc');
  });

  it('filters explicitToken undefined gracefully', () => {
    expect(buildConnectUrl('ws://host/ws', undefined)).toBe('ws://host/ws');
  });

  it('encodes special characters in token', () => {
    const url = buildConnectUrl('ws://host/ws', 'abc+def/g');
    expect(url).toBe('ws://host/ws?token=abc%2Bdef%2Fg');
  });
});

describe('sanitizeWsUrlForDisplay', () => {
  it('strips token for display', () => {
    expect(sanitizeWsUrlForDisplay('ws://host/ws?token=secret')).toBe('ws://host/ws');
  });

  it('returns empty string for falsy input', () => {
    expect(sanitizeWsUrlForDisplay('')).toBe('');
    expect(sanitizeWsUrlForDisplay(null as unknown as string)).toBe('');
    expect(sanitizeWsUrlForDisplay(undefined as unknown as string)).toBe('');
  });

  it('preserves non-token params', () => {
    expect(sanitizeWsUrlForDisplay('ws://host/ws?foo=1&token=secret')).toBe('ws://host/ws?foo=1');
  });
});

describe('CoreClient URL construction', () => {
  it('extracts token from config.wsUrl when no config.token', () => {
    const client = new CoreClientImpl({ pluginId: 'test', wsUrl: 'ws://host/ws?token=url_token' });
    expect(client.hasToken).toBe(true);
    expect(client.authMode).toBe('token');
    expect(client.wsUrl).not.toContain('token=');
  });

  it('config.token takes priority over wsUrl token', () => {
    const client = new CoreClientImpl({ pluginId: 'test', wsUrl: 'ws://host/ws?token=url_token', token: 'explicit' });
    expect(client.hasToken).toBe(true);
    expect(client.authMode).toBe('token');
    expect(client.wsUrl).not.toContain('token=');
  });

  it('hasToken=false when no token provided', () => {
    const client = new CoreClientImpl({ pluginId: 'test', wsUrl: 'ws://host/ws' });
    expect(client.hasToken).toBe(false);
    expect(client.authMode).toBe('none');
  });
});
