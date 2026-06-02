// ─── GET/PUT /api/apps/[appId]/state ──────────────────────────────
// Reads and writes per-app state (enabled/disabled, grants).
// Stored server-side in .sessionbridge/app-state.json.
// This replaces the old plugin.enable/plugin.disable Core capabilities.

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';

const STATE_FILE = join(process.cwd(), '.sessionbridge', 'app-state.json');

interface AppState {
  enabled: boolean;
  updatedAt: number;
  grants: Record<string, { mode: 'allow' | 'deny' | 'ask'; grantedAt: number }>;
}

interface StateStore {
  [appId: string]: AppState;
}

function readState(): StateStore {
  try {
    if (!existsSync(STATE_FILE)) return {};
    const raw = readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeState(store: StateStore): void {
  const dir = join(process.cwd(), '.sessionbridge');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Atomic write: temp file → rename
  const tmp = STATE_FILE + '.tmp';
  writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  renameSync(tmp, STATE_FILE);
}

function ensureApp(store: StateStore, appId: string): AppState {
  if (!store[appId]) {
    store[appId] = {
      enabled: true, // default: enabled
      updatedAt: Date.now(),
      grants: {},
    };
  }
  return store[appId];
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ appId: string }> },
): Promise<NextResponse> {
  const { appId } = await context.params;
  if (!/^[a-z][a-z0-9-]*$/.test(appId)) {
    return NextResponse.json({ error: 'Invalid app ID' }, { status: 400 });
  }

  const store = readState();
  return NextResponse.json(store[appId] || { enabled: true, updatedAt: 0, grants: {} });
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ appId: string }> },
): Promise<NextResponse> {
  const { appId } = await context.params;
  if (!/^[a-z][a-z0-9-]*$/.test(appId)) {
    return NextResponse.json({ error: 'Invalid app ID' }, { status: 400 });
  }

  let body: Partial<AppState>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const store = readState();
  const state = ensureApp(store, appId);

  if (typeof body.enabled === 'boolean') state.enabled = body.enabled;
  if (body.grants) {
    for (const [cap, grant] of Object.entries(body.grants)) {
      if (grant && typeof grant.mode === 'string') {
        state.grants[cap] = {
          mode: grant.mode,
          grantedAt: Date.now(),
        };
      }
    }
  }
  state.updatedAt = Date.now();

  writeState(store);
  return NextResponse.json(state);
}
