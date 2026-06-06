// ─── Core Target Unit Tests ──────────────────────────────────
// Tests for lib/core-target.ts
//
// Uses SESSIONBRIDGE_DATA_DIR env var to redirect storage.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'core-target-test-'));
  process.env.SESSIONBRIDGE_DATA_DIR = tmpDir;
  delete process.env.SESSIONBRIDGE_CORE_WS_URL;
});

afterEach(() => {
  delete process.env.SESSIONBRIDGE_DATA_DIR;
  delete process.env.SESSIONBRIDGE_CORE_WS_URL;
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('getCoreWsUrl (no module state dependence)', () => {
  it('returns default URL when nothing is configured', async () => {
    const { getCoreWsUrl } = await import('../../lib/core-target');
    expect(getCoreWsUrl()).toBe('ws://localhost:9090/ws');
  });

  it('returns env var URL when set', async () => {
    process.env.SESSIONBRIDGE_CORE_WS_URL = 'ws://example.com:1234/ws';
    const mod = await import('../../lib/core-target');
    expect(mod.getCoreWsUrl()).toBe('ws://example.com:1234/ws');
  });
});

describe('setCoreTargetPort', () => {
  it('updates in-memory target', async () => {
    const { setCoreTargetPort, getCoreWsUrl } = await import('../../lib/core-target');
    setCoreTargetPort(8080);
    expect(getCoreWsUrl()).toBe('ws://localhost:8080/ws');
  });

  it('persists port to server-state.json on disk', async () => {
    const { setCoreTargetPort } = await import('../../lib/core-target');
    setCoreTargetPort(8080);

    const statePath = join(tmpDir, 'server-state.json');
    expect(existsSync(statePath)).toBe(true);
    const raw = JSON.parse(readFileSync(statePath, 'utf-8'));
    expect(raw.lastCorePort).toBe(8080);
    expect(raw.lastCoreUrl).toBe('ws://localhost:8080/ws');
  });
});

describe('setCoreTargetUrl', () => {
  it('sets custom URL in memory', async () => {
    const { setCoreTargetUrl, getCoreWsUrl } = await import('../../lib/core-target');
    setCoreTargetUrl('ws://custom:3000/ws');
    expect(getCoreWsUrl()).toBe('ws://custom:3000/ws');
  });
});
