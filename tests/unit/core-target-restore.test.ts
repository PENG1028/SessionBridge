// ─── Core Target — restore function tests ─────────────────────
// Tests for restoreCoreTargetFromServerState().
// Calls resetCoreTarget() before each test to clear module state.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { restoreCoreTargetFromServerState, getCoreWsUrl, resetCoreTarget } from '../../lib/core-target';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'core-restore-'));
  process.env.SESSIONBRIDGE_DATA_DIR = tmpDir;
  delete process.env.SESSIONBRIDGE_CORE_WS_URL;
  resetCoreTarget(); // clear _customTarget from previous tests
});

afterEach(() => {
  delete process.env.SESSIONBRIDGE_DATA_DIR;
  delete process.env.SESSIONBRIDGE_CORE_WS_URL;
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe('restoreCoreTargetFromServerState', () => {
  it('restores lastCoreUrl when server-state.json exists', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'server-state.json'), JSON.stringify({
      lastCorePort: 7777,
      lastCoreUrl: 'ws://localhost:7777/ws',
    }), 'utf-8');

    restoreCoreTargetFromServerState();
    expect(getCoreWsUrl()).toBe('ws://localhost:7777/ws');
  });

  it('env override takes precedence over restored state', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'server-state.json'), JSON.stringify({
      lastCorePort: 7777,
      lastCoreUrl: 'ws://localhost:7777/ws',
    }), 'utf-8');

    process.env.SESSIONBRIDGE_CORE_WS_URL = 'ws://env-wins:1234/ws';

    restoreCoreTargetFromServerState();
    // env override wins — getCoreWsUrl returns env first
    expect(getCoreWsUrl()).toBe('ws://env-wins:1234/ws');
  });

  it('falls back to default when state lacks lastCoreUrl', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'server-state.json'), JSON.stringify({
      coreBinaryPath: '/x',
    }), 'utf-8');

    restoreCoreTargetFromServerState();
    expect(getCoreWsUrl()).toBe('ws://localhost:9090/ws');
  });

  it('falls back to default when state file is corrupt', () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'server-state.json'), 'corrupt json', 'utf-8');

    restoreCoreTargetFromServerState();
    expect(getCoreWsUrl()).toBe('ws://localhost:9090/ws');
  });

  it('falls back to default when no state file exists', () => {
    // Empty tmpDir — no server-state.json seeded
    restoreCoreTargetFromServerState();
    expect(getCoreWsUrl()).toBe('ws://localhost:9090/ws');
  });

  it('restore does not override when env is set', () => {
    process.env.SESSIONBRIDGE_CORE_WS_URL = 'ws://from-env:9999/ws';
    // Even if state has a different value
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'server-state.json'), JSON.stringify({
      lastCorePort: 1111,
      lastCoreUrl: 'ws://localhost:1111/ws',
    }), 'utf-8');

    restoreCoreTargetFromServerState();
    expect(getCoreWsUrl()).toBe('ws://from-env:9999/ws');
  });
});
