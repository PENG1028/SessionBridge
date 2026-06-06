// ─── GET/PUT /api/core/server-state ─────────────────────────────
// Persistent server state: Core binary path, last port, etc.
// Stored in ~/.sessionbridge/server-state.json — survives restarts.
//
// This is machine-level state (not per-user). Multi-user isolation
// belongs in the user-level app-state layer.
//
// The binary path is either user-configured or auto-detected from
// the project's dist/go-core/ directory on first server start.

import { NextRequest, NextResponse } from 'next/server';
import { verifySessionFromCookie } from '../../../../lib/auth/app-ui-auth';
import { readServerState, writeServerState, type ServerState } from '../../../../lib/server-state/server-state';

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

/** GET /api/core/server-state — returns full state. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await checkAuth(request))) return authError();
  const state = readServerState();
  return NextResponse.json(state);
}

/** PUT /api/core/server-state — update partial state (merge). */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  if (!(await checkAuth(request))) return authError();

  let body: Partial<ServerState>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Validate fields if present
  if (body.coreBinaryPath !== undefined && body.coreBinaryPath !== null) {
    if (typeof body.coreBinaryPath !== 'string' || !body.coreBinaryPath.trim()) {
      return NextResponse.json({ error: 'coreBinaryPath must be a non-empty string or null' }, { status: 400 });
    }
  }
  if (body.lastCorePort !== undefined) {
    const port = Number(body.lastCorePort);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return NextResponse.json({ error: 'lastCorePort must be 1–65535' }, { status: 400 });
    }
    body.lastCorePort = port;
  }

  // Strip readonly/discouraged fields from body
  const allowed: Partial<ServerState> = {};
  if ('coreBinaryPath' in body) allowed.coreBinaryPath = body.coreBinaryPath;
  if ('lastCorePort' in body) {
    allowed.lastCorePort = body.lastCorePort;
    allowed.lastCoreUrl = `ws://localhost:${body.lastCorePort}/ws`;
  }

  const state = writeServerState(allowed);
  return NextResponse.json(state);
}
