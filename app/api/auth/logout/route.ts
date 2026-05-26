// ─── POST /api/auth/logout ────────────────────────────────────
// Clears the session cookie.

import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('sessionbridge_view', '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
