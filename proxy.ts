// ─── App UI Route Protection Proxy (Next 16 convention) ───────
// Protects all App UI pages and /api/core/* endpoints.
// Whitelisted paths: auth routes, setup, login, static assets.
//
// Dev bypass: SESSIONBRIDGE_AUTH_BYPASS=1 disables all checks.
// IMPORTANT: Never use NODE_ENV=development as a bypass — that
// would defeat public-facing security.
//
// Proxy runs on Edge Runtime — no fs/crypto access.
// Auth verification (HMAC) is deferred to route handlers.
// This proxy only checks cookie presence as a fast gate.

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ─── Whitelist: paths that don't require auth ────────────────
const PUBLIC_PATHS = [
  '/_next/',
  '/favicon.ico',
  '/api/auth/status',
  '/api/auth/setup',
  '/api/auth/login',
  '/api/auth/logout',
  '/setup',
  '/login',
  '/api/health',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p));
}

function isApiCoreCall(pathname: string): boolean {
  return pathname.startsWith('/api/core/');
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Dev bypass: SESSIONBRIDGE_AUTH_BYPASS=1
  if (process.env.SESSIONBRIDGE_AUTH_BYPASS === '1') {
    if (isApiCoreCall(pathname)) {
      // Verify Core token is configured — without it, API calls will fail
      // or expose unauthenticated endpoints.
      if (!process.env.SESSIONNODE_TOKEN) {
        return NextResponse.json(
          { error: 'Core token not configured — set SESSIONNODE_TOKEN' },
          { status: 401 },
        );
      }
      return NextResponse.next();
    }
    return NextResponse.next();
  }

  // Public paths: always allow
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Check for session cookie
  const sessionCookie = request.cookies.get('sessionbridge_view')?.value;

  if (!sessionCookie) {
    // API calls get 401 JSON
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      );
    }

    // Page requests get redirected to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Cookie exists — let it through. Real auth verification happens
  // in route handlers (/api/core/call verifies HMAC signature).
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files
    '/((?!_next/static|_next/image|images/|fonts/|.*\\.).*)',
  ],
};
