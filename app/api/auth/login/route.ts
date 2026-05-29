// ─── POST /api/auth/login ─────────────────────────────────────
// Validates password and sets a session cookie.
// Returns 401 on invalid credentials.

import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword, loadAuthConfig, createSession } from '../../../../lib/auth/app-ui-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { password } = body || {};

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 });
    }

    const valid = await verifyPassword(password);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    const config = await loadAuthConfig();
    if (!config) {
      return NextResponse.json({ error: 'Auth config not found' }, { status: 500 });
    }

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
    const message = err instanceof Error ? err.message : 'Login failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
