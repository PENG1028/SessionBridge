// ─── GET /api/core/health ─────────────────────────────────────
// Quick server-side Core health probe.
// Probes the Go Core HTTP health endpoint on localhost.
// Returns { ok: true } if Core responds, 502 otherwise.
//
// Unlike /api/core/discover (which scans multiple ports), this runs
// a single probe on the configured port and returns immediately.
//
// Designed for use by ProxyCoreClient's reconnect backoff — a
// short-lived HTTP GET that doesn't consume a persistent connection
// slot like an EventSource would.

import { NextResponse } from 'next/server';
import { getCoreWsUrl } from '../../../../lib/core-target';

export const runtime = 'nodejs';

export async function GET() {
  const wsUrl = getCoreWsUrl();
  const port = new URL(wsUrl).port || '9090';

  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    if (res.ok) {
      return NextResponse.json({ ok: true, status: res.status });
    }
    return NextResponse.json({ ok: false, status: res.status }, { status: 502 });
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }
}
