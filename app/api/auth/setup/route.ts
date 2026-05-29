// ─── POST /api/auth/setup ─────────────────────────────────────
// First-use password setup. Creates the auth config and sets a session cookie.
// Returns 409 if auth is already configured (use force = true to overwrite).

import { NextRequest, NextResponse } from 'next/server';
import { createAuthConfig, createSession, isAuthConfigured } from '../../../../lib/auth/app-ui-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { password } = body || {};

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // Check if already configured (race-condition-safe at file level)
    if (await isAuthConfigured()) {
      return NextResponse.json({ error: 'Auth already configured' }, { status: 409 });
    }

    const config = await createAuthConfig(password, false);
    const sessionToken = createSession(config);

    const isSecure =
      process.env.SESSIONBRIDGE_COOKIE_SECURE === '0'
        ? false
        : request.url.startsWith('https://') || request.headers.get('x-forwarded-proto') === 'https';

    const response = NextResponse.json({ ok: true, sessionTtlSeconds: config.sessionTtlSeconds });
    response.cookies.set('sessionbridge_view', sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: config.sessionTtlSeconds,
      secure: isSecure,
    });

    return response;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Setup failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
