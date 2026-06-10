// ─── POST /api/core/start ──────────────────────────────────────
// Spawns the Go Core binary from the saved path.
// The path must first be set via PUT /api/core/server-state.
//
// VPS detection: when PM2_HOME is set, Core is managed by PM2
// and this endpoint returns 409 (Conflict).
//
// Returns { ok, message, pid } on success, { error } on failure.

import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { verifySessionFromCookie } from '../../../../lib/auth/app-ui-auth';
import { readServerState, setCoreBinaryPath } from '../../../../lib/server-state/server-state';
import { getCoreWsUrl } from '../../../../lib/core-target';

export const runtime = 'nodejs';

function authError() {
  return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
}

async function checkAuth(request: Request): Promise<boolean> {
  if (process.env.SESSIONBRIDGE_AUTH_BYPASS === '1') return true;
  const cookie = request.headers.get('cookie')?.split(';')
    .find(c => c.trim().startsWith('sessionbridge_view='))
    ?.split('=')[1];
  const session = await verifySessionFromCookie(cookie);
  return session.ok;
}

/** VPS detection: PM2-managed Core should not be started from UI. */
function isVps(): boolean {
  return !!(process.env.PM2_HOME);
}

/** Default binary path: check user PATH for sessionnode. No bundled binary. */
function defaultBinaryPath(): string | null {
  // Core is a separate product. Users must install it independently.
  // https://github.com/PENG1028/sessionbridge-core/releases
  return null;
}

/** Resolve Core binary path: user-saved → project default → null. */
function resolveBinaryPath(): string | null {
  const saved = readServerState();
  if (saved.coreBinaryPath && existsSync(saved.coreBinaryPath)) {
    return saved.coreBinaryPath;
  }
  return defaultBinaryPath();
}

// Track the spawned Core process so we can kill it on server shutdown.
let coreProcess: ReturnType<typeof spawn> | null = null;

export async function POST(request: Request): Promise<NextResponse> {
  if (!(await checkAuth(request))) return authError();

  // ── VPS guard ────────────────────────────────────────────────
  if (isVps()) {
    return NextResponse.json(
      { error: 'Core is managed by PM2 on this server. Use pm2 to control it.' },
      { status: 409 },
    );
  }

  // ── Accept path override from request body ────────────────────
  let body: { coreBinaryPath?: string } = {};
  try { body = await request.json(); } catch { /* body optional */ }
  if (body.coreBinaryPath) {
    setCoreBinaryPath(body.coreBinaryPath);
  }

  // ── Resolve binary path ──────────────────────────────────────
  const binPath = resolveBinaryPath();
  if (!binPath) {
    return NextResponse.json(
      { error: 'Core binary not found. Set its path in Settings → Connection → Core Binary Path.' },
      { status: 400 },
    );
  }

  // ── Check if already running ──────────────────────────────────
  const currentUrl = getCoreWsUrl();
  try {
    const port = new URL(currentUrl).port || '9090';
    // Quick probe: if port responds, Core is likely already running
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    const probe = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: controller.signal,
    }).catch(() => null);
    clearTimeout(timeout);
    if (probe?.ok) {
      return NextResponse.json(
        { ok: true, message: 'Core is already running', pid: 0 },
      );
    }
  } catch {
    // Port unreachable — proceed to start
  }

  // ── Spawn Core ────────────────────────────────────────────────
  try {
    const pluginDirs = join(process.cwd(), 'plugins');
    const dataDir = join(homedir(), '.sessionnode');

    coreProcess = spawn(binPath, [], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LISTEN_ADDR: '127.0.0.1:9090',
        SESSIONNODE_DATA_DIR: dataDir,
        SESSIONNODE_PLUGIN_DIRS: pluginDirs,
      },
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });

    // Persist the path on successful launch
    setCoreBinaryPath(binPath);

    // Unref so the server can restart without waiting for Core
    coreProcess.unref();

    return NextResponse.json({
      ok: true,
      message: `Core started (pid ${coreProcess.pid})`,
      pid: coreProcess.pid,
    });
  } catch (err) {
    const msg = (err as Error).message || 'Failed to spawn Core binary';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
