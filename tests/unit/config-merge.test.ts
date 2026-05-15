// ─── Config merge regression test ───────────────────────────
// Verifies that absent CLI flags do NOT overwrite persisted
// config values.  Bug: `{ dashboardToken: undefined }` in
// cliOverrides was clobbering the token from agent.json.
//
// Usage: npx vitest run tests/unit/config-merge.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveConfig } from '../../agent-core/config';

describe('resolveConfig — undefined CLI overrides must not clobber JSON', () => {
  let workDir: string;
  let configPath: string;
  const origEnv = process.env.BRIDGE_CONFIG;

  beforeEach(() => {
    workDir = join(tmpdir(), `sb-config-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
    const configDir = join(workDir, '.sessionbridge');
    mkdirSync(configDir, { recursive: true });
    configPath = join(configDir, 'agent.json');
    process.env.BRIDGE_CONFIG = configPath;
  });

  afterEach(() => {
    if (origEnv) process.env.BRIDGE_CONFIG = origEnv;
    else delete process.env.BRIDGE_CONFIG;
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  });

  function writeAgentJson(obj: Record<string, unknown>) {
    writeFileSync(configPath, JSON.stringify(obj, null, 2), 'utf8');
  }

  it('preserves dashboardToken when CLI overrides omit it', () => {
    writeAgentJson({
      dashboardToken: 'persisted-secret',
      dashboardAuthEnabled: true,
      label: 'my-agent',
    });

    const cfg = resolveConfig({ label: 'cli-label' }); // label passed, dashboardToken NOT passed

    expect(cfg.dashboardToken).toBe('persisted-secret');
    expect(cfg.dashboardAuthEnabled).toBe(true);
    expect(cfg.label).toBe('cli-label'); // CLI override for label still wins
  });

  it('CLI dashboardToken overrides JSON when explicitly passed', () => {
    writeAgentJson({
      dashboardToken: 'persisted-secret',
      dashboardAuthEnabled: true,
    });

    const cfg = resolveConfig({ dashboardToken: 'cli-token' } as any);

    expect(cfg.dashboardToken).toBe('cli-token');
    expect(cfg.dashboardAuthEnabled).toBe(true);
  });

  it('preserves relayToken when CLI overrides omit it', () => {
    writeAgentJson({
      relayToken: 'persisted-relay-token',
    });

    const cfg = resolveConfig({});

    expect(cfg.relayToken).toBe('persisted-relay-token');
  });

  it('filters out explicitly-undefined cliOverrides (the safety-net)', () => {
    writeAgentJson({
      dashboardToken: 'persisted-secret',
      relayToken: 'persisted-relay',
      upstreamRelay: 'ws://persisted:8080',
    });

    // Simulate the OLD bad pattern: pass undefined explicitly
    const cfg = resolveConfig({
      dashboardToken: undefined,
      relayToken: undefined,
      upstreamRelay: undefined,
    } as any);

    // The safety net in resolveConfig must strip these undefineds
    expect(cfg.dashboardToken).toBe('persisted-secret');
    expect(cfg.relayToken).toBe('persisted-relay');
    expect(cfg.upstreamRelay).toBe('ws://persisted:8080');
  });

  it('preserves upstreamRelay from JSON when CLI overrides omit it', () => {
    writeAgentJson({
      upstreamRelay: 'ws://remote-relay:9000',
    });

    const cfg = resolveConfig({});

    expect(cfg.upstreamRelay).toBe('ws://remote-relay:9000');
  });

  it('preserves logFile and pidFile from JSON', () => {
    writeAgentJson({
      logFile: '/var/log/sb.log',
      pidFile: '/var/run/sb.pid',
    });

    const cfg = resolveConfig({});

    expect(cfg.logFile).toBe('/var/log/sb.log');
    expect(cfg.pidFile).toBe('/var/run/sb.pid');
  });

  it('preserves extensionPaths from JSON', () => {
    writeAgentJson({
      extensionPaths: ['/custom/ext1', '/custom/ext2'],
    });

    const cfg = resolveConfig({});

    expect(cfg.extensionPaths).toEqual(['/custom/ext1', '/custom/ext2']);
  });

  it('empty overrides work with no existing agent.json', () => {
    // agent.json does not exist — should use defaults
    const cfg = resolveConfig({});

    expect(cfg.dashboardAuthEnabled).toBe(true);
    expect(cfg.dashboardToken).toBeUndefined();
    expect(cfg.relayPort).toBe(8080);
  });
});
