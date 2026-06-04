// ─── GET /api/apps/list ───────────────────────────────────────────
// Scans plugins/*/plugin.yaml and returns AppSummary[].
// Does NOT call Go Core — reads YAML files directly from the server.
// Unlike the old plugin.list Core capability, this runs on the Next.js
// server and has no dependency on the Core runtime.

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';
import { verifySessionFromCookie } from '../../../../lib/auth/app-ui-auth';

export const runtime = 'nodejs';

async function checkAuth(request: NextRequest): Promise<boolean> {
  if (process.env.SESSIONBRIDGE_AUTH_BYPASS === '1') return true;
  const cookie = request.cookies.get('sessionbridge_view')?.value;
  const session = await verifySessionFromCookie(cookie);
  return session.ok;
}

interface RawManifest {
  id?: string;
  name?: string;
  version?: string;
  type?: string;
  trusted?: boolean;
  description?: string;
  core?: {
    permissions?: Array<{ capabilities?: string[] }>;
  };
}

const PLUGINS_DIR = join(process.cwd(), 'plugins');

function isDir(path: string): boolean {
  try { return readdirSync(path).length >= 0; } catch (_e) { return false; }
}

function readManifest(appId: string): RawManifest | null {
  const yamlPath = join(PLUGINS_DIR, appId, 'plugin.yaml');
  if (!existsSync(yamlPath)) return null;
  try {
    const raw = readFileSync(yamlPath, 'utf-8');
    return load(raw) as RawManifest;
  } catch (err) {
    console.error(`[apps] Failed to parse ${appId}/plugin.yaml:`, (err as Error).message);
    return null;
  }
}

function extractCapabilities(manifest: RawManifest): string[] {
  const caps = new Set<string>();
  const perms = manifest.core?.permissions ?? [];
  for (const perm of perms) {
    for (const cap of perm.capabilities ?? []) {
      caps.add(cap);
    }
  }
  return Array.from(caps).sort();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!(await checkAuth(request))) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (!isDir(PLUGINS_DIR)) {
    return NextResponse.json({ apps: [] });
  }

  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });
  const apps = [];
  let lastModified = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const yamlPath = join(PLUGINS_DIR, entry.name, 'plugin.yaml');
    try { lastModified = Math.max(lastModified, statSync(yamlPath).mtimeMs); } catch (_e) { console.debug('[apps/list] failed to stat plugin.yaml:', _e); }
    const manifest = readManifest(entry.name);
    if (!manifest) continue;

    apps.push({
      id: manifest.id || entry.name,
      name: manifest.name || entry.name,
      version: manifest.version || '0.0.0',
      type: (manifest.type as 'plugin' | 'system') || 'plugin',
      trusted: manifest.trusted ?? false,
      description: manifest.description || '',
      capabilities: extractCapabilities(manifest),
    });
  }

  return NextResponse.json({ apps, lastModified });
}
