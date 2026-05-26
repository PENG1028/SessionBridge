// ─── GET /api/auth/status ─────────────────────────────────────
// Returns the current auth configuration and session state.
// This endpoint is NOT protected by middleware (it's in the whitelist).

import { NextRequest, NextResponse } from 'next/server';
import { isAuthConfigured, getSessionTtlSeconds, verifySessionFromCookie } from '../../../../lib/auth/app-ui-auth';

export async function GET(request: NextRequest) {
  const configured = await isAuthConfigured();
  const sessionTtlSeconds = await getSessionTtlSeconds();

  // Check if the request has a valid session cookie
  const cookie = request.cookies.get('sessionbridge_view')?.value;
  const session = cookie ? await verifySessionFromCookie(cookie) : null;
  const authenticated = session?.ok === true;

  return NextResponse.json({
    configured,
    authenticated,
    sessionTtlSeconds,
  });
}
