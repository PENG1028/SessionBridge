// ─── GET /api/apps/[appId]/check ──────────────────────────────────
// Returns the environment checks declared in the plugin manifest.
// The FRONTEND calls Core env.which for each check and resolves results.
// This route only reads the YAML — it does NOT call Core.

import { NextRequest, NextResponse } from 'next/server';
import { readEnvChecks } from '../../../../lib/dependency-checker';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ appId: string }> },
): Promise<NextResponse> {
  const { appId } = await context.params;
  if (!/^[a-z][a-z0-9-]*$/.test(appId)) {
    return NextResponse.json({ error: 'Invalid app ID' }, { status: 400 });
  }

  const checks = readEnvChecks(appId);
  return NextResponse.json({ appId, checks });
}
