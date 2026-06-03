/**
 * Safe URL/Token utilities — single source of truth for stripping, extracting,
 * and normalizing WebSocket URLs so no raw token appears in the DOM or logs.
 */

/**
 * Remove the `token` query parameter from a WebSocket URL for safe display.
 * All other query parameters are preserved. Returns empty string for falsy input.
 */
export function sanitizeWsUrlForDisplay(url: string): string {
  if (!url) return '';
  return stripTokenFromWsUrl(url);
}

/**
 * Strip the `token` query parameter from a URL. Same as sanitize but named
 * for use when persisting to localStorage or state.
 *
 * For valid URLs, uses URL API to delete exact `token` param.
 * For malformed input, removes any bare `token=...` fragment (word-boundary
 * guarded so `access_token` / `refresh_token` are NOT affected).
 */
export function stripTokenFromWsUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.searchParams.delete('token');
    return u.toString();
  } catch (_e) {
    // Malformed URL — use word-boundary to only match exact `token`, not
    // access_token/refresh_token. Covers bare `token=secret`, `?token=secret`,
    // `&token=secret`, ` ws token=secret`.
    let result = url.replace(/\btoken=[^&\s#]*/g, '');
    // Clean up artifacts left after removal
    result = result
      .replace(/\?&/g, '?')
      .replace(/&&/g, '&')
      .replace(/[?&]$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return result || '';
  }
}

/**
 * Extract the `token` query parameter from a URL, if present.
 * Returns undefined when no token parameter exists.
 * Does NOT extract from `access_token` / `refresh_token`.
 */
export function extractTokenFromWsUrl(url: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    const tok = u.searchParams.get('token');
    return tok ?? undefined;
  } catch (_e) {
    // Malformed — match exact `token` (word-boundary guarded), not
    // access_token/refresh_token.
    const m = url.match(/\btoken=([^&\s#]*)/);
    if (!m || !m[1]) return undefined;
    const raw = decodeURIComponent(m[1]);
    return raw || undefined;
  }
}

/**
 * Normalize a wsUrl + optional explicit token into a clean split.
 *
 * Rules:
 *   - explicitToken (from user input, query param, or password field) wins
 *   - if inputUrl carries a `token` query param and no explicitToken,
 *     the token is extracted and the URL is cleaned
 *   - the returned wsUrl never contains a token query param
 *   - non-token query params are always preserved
 *   - token is never an empty string; empty/undefined → undefined
 */
export function normalizeWsUrlAndToken(
  inputUrl: string,
  explicitToken?: string,
): { wsUrl: string; token?: string } {
  const urlToken = extractTokenFromWsUrl(inputUrl);

  // explicitToken takes priority over URL-embedded token
  const token = explicitToken ?? urlToken;

  // Strip token from URL regardless
  const wsUrl = stripTokenFromWsUrl(inputUrl);

  return { wsUrl, token: token || undefined };
}

/**
 * Build a WebSocket connect URL with token as query parameter.
 * - If wsUrl already has query params, uses &token=
 * - If wsUrl has no query params, uses ?token=
 * - If no token, returns wsUrl as-is
 * - Hash fragments (if any) are preserved before the token when using URL API
 */
export function buildConnectUrl(wsUrl: string, token?: string): string {
  if (!token) return wsUrl;
  try {
    const u = new URL(wsUrl);
    u.searchParams.set('token', token);
    return u.toString();
  } catch (_e) {
    // Malformed wsUrl — try to do our best
    const sep = wsUrl.includes('?') ? '&' : '?';
    return wsUrl + sep + 'token=' + encodeURIComponent(token);
  }
}
