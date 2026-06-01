// ─── GET/POST /api/apps/[appId]/install ────────────────────────────
// Manages install records for plugin dependencies.
// The actual install execution happens on the client via Core process.spawn.

import { NextRequest, NextResponse } from 'next/server';
import { getInstallHistory, createInstallRecord, updateInstallRecord } from '../../../../lib/install-manager';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ appId: string }> },
): Promise<NextResponse> {
  const { appId } = await context.params;
  if (!/^[a-z][a-z0-9-]*$/.test(appId)) {
    return NextResponse.json({ error: 'Invalid app ID' }, { status: 400 });
  }
  return NextResponse.json({ records: getInstallHistory(appId) });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ appId: string }> },
): Promise<NextResponse> {
  const { appId } = await context.params;
  if (!/^[a-z][a-z0-9-]*$/.test(appId)) {
    return NextResponse.json({ error: 'Invalid app ID' }, { status: 400 });
  }

  let body: { checkId?: string; command?: string; status?: string; stdout?: string; stderr?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // If status update (client reporting install result)
  if (body.status && body.checkId) {
    const records = getInstallHistory(appId);
    const lastRunning = records.find(r => r.checkId === body.checkId && r.status === 'running');
    if (lastRunning) {
      const updated = updateInstallRecord(appId, lastRunning.installId, {
        status: body.status as 'success' | 'failed',
        finishedAt: Date.now(),
        stdout: body.stdout,
        stderr: body.stderr,
      });
      return NextResponse.json(updated);
    }
    return NextResponse.json({ error: 'No running install found' }, { status: 404 });
  }

  // New install record
  if (body.checkId && body.command) {
    const record = createInstallRecord(appId, body.checkId, body.command);
    return NextResponse.json(record);
  }

  return NextResponse.json({ error: 'checkId and command required' }, { status: 400 });
}
