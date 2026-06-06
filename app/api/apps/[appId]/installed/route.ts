// ─── GET/PUT /api/apps/[appId]/installed ──────────────────────────
// Tracks installed software per plugin (name, binary, version, path).
// Stored server-side in ~/.sessionbridge/installed-apps.json.
// Dedup by checkId within each appId.

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { randomBytes } from 'crypto';
import { verifySessionFromCookie } from '../../../../../lib/auth/app-ui-auth';
import { getInstalledAppsFile, ensureBaseDir } from '../../../../../lib/server-state/paths';

export const runtime = 'nodejs';

const INSTALLED_FILE = getInstalledAppsFile();

interface InstalledSoftwareEntry {
  id: string;
  checkId: string;
  name: string;
  binary: string;
  version: string;
  path: string;
  installedAt: number;
  sizeBytes?: number;
  stale?: boolean;
}

interface InstalledStore {
  [appId: string]: InstalledSoftwareEntry[];
}

function readStore(): InstalledStore {
  try {
    if (!existsSync(INSTALLED_FILE)) return {};
    const raw = readFileSync(INSTALLED_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeStore(store: InstalledStore): void {
  ensureBaseDir();
  const tmp = INSTALLED_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  renameSync(tmp, INSTALLED_FILE);
}

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

  const store = readStore();
  const entries = store[appId] ?? [];
  // Newest first
  entries.sort((a, b) => b.installedAt - a.installedAt);
  return NextResponse.json({ entries });
}

export async function PUT(
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

  let body: {
    checkId?: string;
    name?: string;
    binary?: string;
    version?: string;
    path?: string;
    sizeBytes?: number | null;
    stale?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body.checkId) {
    return NextResponse.json({ error: 'checkId is required' }, { status: 400 });
  }

  const store = readStore();
  if (!store[appId]) store[appId] = [];

  const now = Date.now();
  const existingIdx = store[appId].findIndex(e => e.checkId === body.checkId);

  if (existingIdx >= 0) {
    // Update existing record (upsert by checkId)
    const existing = store[appId][existingIdx];
    existing.name = body.name ?? existing.name;
    existing.binary = body.binary ?? existing.binary;
    existing.version = body.version ?? existing.version;
    existing.path = body.path ?? existing.path;
    if (body.sizeBytes !== undefined) existing.sizeBytes = body.sizeBytes ?? undefined;
    if (body.stale !== undefined) existing.stale = body.stale;
    existing.installedAt = now;
  } else {
    // Create new entry
    const entry: InstalledSoftwareEntry = {
      id: randomBytes(6).toString('hex'),
      checkId: body.checkId,
      name: body.name ?? body.checkId,
      binary: body.binary ?? body.checkId,
      version: body.version ?? '',
      path: body.path ?? '',
      installedAt: now,
      sizeBytes: body.sizeBytes ?? undefined,
      stale: body.stale ?? false,
    };
    store[appId].push(entry);
  }

  writeStore(store);
  // Return sorted newest first
  const sorted = store[appId].sort((a, b) => b.installedAt - a.installedAt);
  return NextResponse.json({ entries: sorted });
}
