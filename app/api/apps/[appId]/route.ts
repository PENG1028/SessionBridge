// ─── GET /api/apps/[appId] ───────────────────────────────────────
// Returns the full manifest for a single app.
// Reads plugins/<appId>/plugin.yaml from the server filesystem.

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { verifySessionFromCookie } from '../../../../lib/auth/app-ui-auth';

export const runtime = 'nodejs';

const PLUGINS_DIR = join(process.cwd(), 'plugins');

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

  // Security: prevent path traversal
  if (!/^[a-z][a-z0-9-]*$/.test(appId)) {
    return NextResponse.json({ error: 'Invalid app ID' }, { status: 400 });
  }

  const yamlPath = join(PLUGINS_DIR, appId, 'plugin.yaml');
  if (!existsSync(yamlPath)) {
    return NextResponse.json({ error: 'App not found' }, { status: 404 });
  }

  try {
    const raw = readFileSync(yamlPath, 'utf-8');
    const manifest = load(raw);
    return NextResponse.json(manifest);
  } catch (_e) {
    return NextResponse.json({ error: 'Failed to parse manifest' }, { status: 500 });
  }
}
