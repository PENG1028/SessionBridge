// ─── Rate Limiter (per-IP sliding window) ────────────────────────

const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60;        // 60 requests per minute
const rateLimitMap = new Map<string, number[]>();

// Periodic cleanup every 60s
const CLEANUP_INTERVAL = setInterval(() => {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  for (const [ip, timestamps] of rateLimitMap.entries()) {
    const valid = timestamps.filter(t => t > windowStart);
    if (valid.length === 0) rateLimitMap.delete(ip);
    else rateLimitMap.set(ip, valid);
  }
}, 60_000);
// Allow process to exit even if cleanup interval is active
if (CLEANUP_INTERVAL.unref) CLEANUP_INTERVAL.unref();

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  let timestamps = rateLimitMap.get(ip);
  if (!timestamps) {
    timestamps = [];
    rateLimitMap.set(ip, timestamps);
  }
  // Prune old entries
  while (timestamps.length > 0 && timestamps[0]! <= windowStart) {
    timestamps.shift();
  }
  if (timestamps.length >= RATE_LIMIT_MAX) {
    return false; // rate limited
  }
  timestamps.push(now);
  return true;
}

export function resetRateLimits(): void {
  rateLimitMap.clear();
}

export function getRateLimitCount(ip: string): number {
  return rateLimitMap.get(ip)?.length ?? 0;
}
