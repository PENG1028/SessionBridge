// ─── POST /api/core/target ─────────────────────────────────
// Dynamically set the server-side Core WebSocket target.
// Accepts { port: number } or { url: string }.
// After calling this, subsequent /api/core/call and
// /api/core/events routes will connect to the new target.
//
// Returns { ok: true, url: "<current-target>" } on success.

import { NextRequest, NextResponse } from 'next/server';
import { verifySessionFromCookie } from '../../../../lib/auth/app-ui-auth';
import { getCoreWsUrl, setCoreTargetPort, setCoreTargetUrl } from '../../../../lib/core-target';

export const runtime = 'nodejs';

function authError() {
  return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
}

async function checkAuth(request: NextRequest): Promise<boolean> {
  if (process.env.SESSIONBRIDGE_AUTH_BYPASS === '1') return true;
  const cookie = request.cookies.get('sessionbridge_view')?.value;
  const session = await verifySessionFromCookie(cookie);
  return session.ok;
}

export async function GET(request: NextRequest) {
  if (!(await checkAuth(request))) return authError();
  return NextResponse.json({ ok: true, url: getCoreWsUrl() });
}

export async function POST(request: NextRequest) {
  if (!(await checkAuth(request))) return authError();
  try {
    const body = await request.json();

    if (body.port !== undefined) {
      const port = parseInt(String(body.port), 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        return NextResponse.json({ error: 'Invalid port number' }, { status: 400 });
      }
      setCoreTargetPort(port);
    } else if (body.url && typeof body.url === 'string') {
      try {
        new URL(body.url);
      } catch {
        return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
      }
      setCoreTargetUrl(body.url);
    } else {
      return NextResponse.json({ error: 'port or url required' }, { status: 400 });
    }

    return NextResponse.json({ ok: true, url: getCoreWsUrl() });
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
}
