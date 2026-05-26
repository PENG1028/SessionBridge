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
 */
export function stripTokenFromWsUrl(url: string): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.searchParams.delete('token');
    const cleaned = u.toString();
    // Restore protocol-relative look for /ws suffix if URL was normalised away
    return cleaned;
  } catch {
    // Malformed URL — conservative: remove any occurrence of `token=` to
    // prevent accidental leaks, even in garbage input.
    return url.replace(/([?&])token=[^&#]*([&#]|$)/g, '$1').replace(/([&?])$/, '');
  }
}

/**
 * Extract the `token` query parameter from a URL, if present.
 * Returns undefined when no token parameter exists.
 */
export function extractTokenFromWsUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const tok = u.searchParams.get('token');
    return tok ?? undefined;
  } catch {
    // Malformed — try regex as fallback
    const m = url.match(/[?&]token=([^&#]+)/);
    return m ? decodeURIComponent(m[1]) : undefined;
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

  return { wsUrl, token };
}
