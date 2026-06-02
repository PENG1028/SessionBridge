// ─── GET /api/apps/[appId]/check ──────────────────────────────────
// Returns the environment checks declared in the plugin manifest.
// The FRONTEND calls Core env.which for each check and resolves results.
// This route only reads the YAML — it does NOT call Core.

import { NextRequest, NextResponse } from 'next/server';
import { readEnvChecks } from '../../../../lib/dependency-checker';
import { verifySessionFromCookie } from '../../../../../lib/auth/app-ui-auth';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ appId: string }> },
): Promise<NextResponse> {
  if (process.env.SESSIONBRIDGE_AUTH_BYPASS !== '1') {
    const cookie = request.cookies.get('sessionbridge_view')?.value;
    const session = await verifySessionFromCookie(cookie);
    if (!session.ok) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const { appId } = await context.params;
  if (!/^[a-z][a-z0-9-]*$/.test(appId)) {
    return NextResponse.json({ error: 'Invalid app ID' }, { status: 400 });
  }

  const checks = readEnvChecks(appId);
  return NextResponse.json({ appId, checks });
}
