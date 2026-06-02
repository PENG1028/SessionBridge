// ─── GET /api/apps/list ───────────────────────────────────────────
// Scans plugins/*/plugin.yaml and returns AppSummary[].
// Does NOT call Go Core — reads YAML files directly from the server.
// Unlike the old plugin.list Core capability, this runs on the Next.js
// server and has no dependency on the Core runtime.

import { NextResponse } from 'next/server';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { load } from 'js-yaml';

export const runtime = 'nodejs';

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
  try { return readdirSync(path).length >= 0; } catch { return false; }
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

export async function GET(): Promise<NextResponse> {
  if (!isDir(PLUGINS_DIR)) {
    return NextResponse.json({ apps: [] });
  }

  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });
  const apps = [];
  let lastModified = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const yamlPath = join(PLUGINS_DIR, entry.name, 'plugin.yaml');
    try { lastModified = Math.max(lastModified, statSync(yamlPath).mtimeMs); } catch {}
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
