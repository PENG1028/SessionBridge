// ─── GET /api/ping ───────────────────────────────────────────
// Ultra-lightweight connectivity test.
// Returns plain text so even the most basic HTTP client can reach it.
// Used to verify basic fetch() works from mobile LAN before trying
// more complex API calls.

export const runtime = 'nodejs';

export async function GET() {
  return new Response('pong', {
    headers: { 'Content-Type': 'text/plain' },
  });
}
