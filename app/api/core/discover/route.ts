// ─── GET /api/core/discover ─────────────────────────────────────
// Server-side Core discovery probe.
// Scans common ports on localhost to find running Go Core instances.
// Returns results sorted by most likely match.
//
// This route is public (no auth check) because it's a diagnostic tool
// for when the user can't connect. It only probes localhost.

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface ScanResult {
  port: number;
  status: 'running' | 'not_found' | 'unexpected';
  info?: { status?: string; nodeId?: string; fingerprint?: string };
  error?: string;
}

const COMMON_PORTS = [9090, 8080, 9091, 14400];

export async function GET() {
  const results: ScanResult[] = [];

  for (const port of COMMON_PORTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      });

      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        results.push({
          port,
          status: 'running',
          info: {
            status: data.status,
            nodeId: data.nodeId,
            fingerprint: data.fingerprint,
          },
        });
      } else {
        results.push({ port, status: 'unexpected', error: `HTTP ${res.status}` });
      }
    } catch (err) {
      // Timeout or connection refused = not found
      results.push({ port, status: 'not_found' });
    }
  }

  // Sort: running first (ordered by port), then not_found
  results.sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (a.status !== 'running' && b.status === 'running') return 1;
    return a.port - b.port;
  });

  return NextResponse.json({ results, timestamp: Date.now() });
}
