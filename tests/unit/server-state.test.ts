// ─── Server State Unit Tests ──────────────────────────────────
// Tests for lib/server-state/server-state.ts
//
// Uses SESSIONBRIDGE_DATA_DIR env var to redirect storage to a
// temp directory — no real ~/.sessionbridge/ files are touched.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

let tmpDir: string;
let stateFile: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'server-state-test-'));
  process.env.SESSIONBRIDGE_DATA_DIR = tmpDir;
  stateFile = join(tmpDir, 'server-state.json');
});

afterEach(() => {
  delete process.env.SESSIONBRIDGE_DATA_DIR;
  // Must clear module cache so re-imports pick up new env
  for (const key of Object.keys(require.cache)) {
    if (key.includes('server-state') || key.includes('paths')) {
      delete require.cache[key];
    }
  }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('readServerState', () => {
  it('returns defaults when file does not exist', async () => {
    const { readServerState } = await import('../../lib/server-state/server-state');
    const state = readServerState();
    expect(state.coreBinaryPath).toBeNull();
    expect(state.coreBinaryLastFound).toBeNull();
    expect(state.lastCorePort).toBe(9090);
    expect(state.lastCoreUrl).toBeNull();
  });

  it('reads existing state correctly', async () => {
    writeFileSync(stateFile, JSON.stringify({
      coreBinaryPath: '/usr/local/bin/sessionnode',
      coreBinaryLastFound: 1700000000000,
      lastCorePort: 9090,
      lastCoreUrl: 'ws://localhost:9090/ws',
    }), 'utf-8');

    const { readServerState } = await import('../../lib/server-state/server-state');
    const state = readServerState();
    expect(state.coreBinaryPath).toBe('/usr/local/bin/sessionnode');
    expect(state.coreBinaryLastFound).toBe(1700000000000);
    expect(state.lastCorePort).toBe(9090);
    expect(state.lastCoreUrl).toBe('ws://localhost:9090/ws');
  });

  it('provides defaults for missing fields', async () => {
    writeFileSync(stateFile, JSON.stringify({ coreBinaryPath: null, lastCorePort: 8080 }), 'utf-8');

    const { readServerState } = await import('../../lib/server-state/server-state');
    const state = readServerState();
    expect(state.coreBinaryPath).toBeNull();
    expect(state.coreBinaryLastFound).toBeNull();   // default, not in file
    expect(state.lastCorePort).toBe(8080);           // from file, overrides default 9090
    expect(state.lastCoreUrl).toBeNull();
  });

  it('returns defaults on corrupt JSON', async () => {
    writeFileSync(stateFile, 'not valid json', 'utf-8');
    const { readServerState } = await import('../../lib/server-state/server-state');
    const state = readServerState();
    expect(state.coreBinaryPath).toBeNull();
    expect(state.lastCorePort).toBe(9090);
  });
});

describe('writeServerState', () => {
  it('writes a new file with merged values', async () => {
    const { writeServerState } = await import('../../lib/server-state/server-state');
    const result = writeServerState({ coreBinaryPath: '/usr/bin/sessionnode' });

    expect(result.coreBinaryPath).toBe('/usr/bin/sessionnode');
    expect(result.lastCorePort).toBe(9090); // default

    // Verify file exists on disk
    expect(existsSync(stateFile)).toBe(true);
    const raw = JSON.parse(readFileSync(stateFile, 'utf-8'));
    expect(raw.coreBinaryPath).toBe('/usr/bin/sessionnode');
    expect(raw.lastCorePort).toBe(9090);
  });

  it('merges partial update over existing', async () => {
    // Seed initial state
    writeFileSync(stateFile, JSON.stringify({
      coreBinaryPath: '/old/path',
      coreBinaryLastFound: 1000000000000,
      lastCorePort: 9090,
      lastCoreUrl: 'ws://localhost:9090/ws',
    }), 'utf-8');

    const { writeServerState } = await import('../../lib/server-state/server-state');
    const result = writeServerState({ coreBinaryPath: '/new/path' });

    expect(result.coreBinaryPath).toBe('/new/path');
    expect(result.coreBinaryLastFound).toBe(1000000000000); // preserved
    expect(result.lastCorePort).toBe(9090);                  // preserved
  });

  it('clears path when set to null', async () => {
    writeFileSync(stateFile, JSON.stringify({
      coreBinaryPath: '/old/path',
      coreBinaryLastFound: 1000000000000,
      lastCorePort: 9090,
      lastCoreUrl: 'ws://localhost:9090/ws',
    }), 'utf-8');

    const { writeServerState } = await import('../../lib/server-state/server-state');
    const result = writeServerState({ coreBinaryPath: null, coreBinaryLastFound: null });

    expect(result.coreBinaryPath).toBeNull();
    expect(result.coreBinaryLastFound).toBeNull();
  });

  it('updates port and derives URL', async () => {
    const { writeServerState, setLastCorePort } = await import('../../lib/server-state/server-state');

    const result = setLastCorePort(8080);
    expect(result.lastCorePort).toBe(8080);
    expect(result.lastCoreUrl).toBe('ws://localhost:8080/ws');

    // Verify on disk
    const raw = JSON.parse(readFileSync(stateFile, 'utf-8'));
    expect(raw.lastCorePort).toBe(8080);
    expect(raw.lastCoreUrl).toBe('ws://localhost:8080/ws');
  });

  it('concurrent-safe: two writes do not lose data', async () => {
    const mod = await import('../../lib/server-state/server-state');

    mod.writeServerState({ coreBinaryPath: '/path/a' });
    mod.writeServerState({ lastCorePort: 7070 });

    const raw = JSON.parse(readFileSync(stateFile, 'utf-8'));
    expect(raw.coreBinaryPath).toBe('/path/a');
    expect(raw.lastCorePort).toBe(7070);
  });
});

describe('setCoreBinaryPath', () => {
  it('saves path and sets timestamp', async () => {
    const { setCoreBinaryPath } = await import('../../lib/server-state/server-state');
    const result = setCoreBinaryPath('/tmp/sessionnode');

    expect(result.coreBinaryPath).toBe('/tmp/sessionnode');
    expect(result.coreBinaryLastFound).toBeGreaterThan(0);

    // Verify disk
    const raw = JSON.parse(readFileSync(stateFile, 'utf-8'));
    expect(raw.coreBinaryPath).toBe('/tmp/sessionnode');
    expect(raw.coreBinaryLastFound).toBeGreaterThan(0);
  });

  it('clearing path nulls the timestamp', async () => {
    writeFileSync(stateFile, JSON.stringify({
      coreBinaryPath: '/old',
      coreBinaryLastFound: 1000000000000,
    }), 'utf-8');

    const { setCoreBinaryPath } = await import('../../lib/server-state/server-state');
    const result = setCoreBinaryPath(null);

    expect(result.coreBinaryPath).toBeNull();
    expect(result.coreBinaryLastFound).toBeNull();
  });
});
