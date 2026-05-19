// ─── Cross-Relay InstanceId Remap Test Runner ───────────────
// Starts a clean relay, runs the remap test, then cleans up.
//
// Usage:
//   node tests/integration/run-remap-test.mjs

import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { randomInt } from 'crypto';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

function resolveBridge() {
  const candidates = [
    join(ROOT, 'bin', 'bridge.js'),
    join(ROOT, 'dist', 'src', 'index.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error('FATAL: No bridge entry found');
  process.exit(1);
}

const delay = ms => new Promise(r => setTimeout(r, ms));
const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';

async function main() {
  const workDir = join(tmpdir(), `sb-remap-test-${Date.now()}-${randomInt(10000, 99999)}`);
  const configDir = join(workDir, '.sessionbridge');
  mkdirSync(configDir, { recursive: true });

  const TEST_PORT = randomInt(19000, 19999);
  const RELAY_URL = `http://127.0.0.1:${TEST_PORT}`;
  const RELAY_WS = `ws://127.0.0.1:${TEST_PORT}`;

  // Write a clean config — no upstreamRelay, so the agent connects to its own relay
  const configPath = join(configDir, 'agent.json');
  const cleanConfig = {
    label: 'remap-test-node',
    relayPort: TEST_PORT,
    workingDirectory: workDir,
  };
  writeFileSync(configPath, JSON.stringify(cleanConfig, null, 2), 'utf8');
  console.log(`Temp config: ${configPath}`);

  const bridgePath = resolveBridge();
  console.log(`Starting relay on port ${TEST_PORT}...`);

  const proc = spawn(nodeCmd, [bridgePath, '--relay-port', String(TEST_PORT), '--dir', workDir, '--label', 'remap-test-node'], {
    cwd: ROOT,
    env: { ...process.env, BRIDGE_CONFIG: configPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Wait for relay
  let started = false;
  const startTime = Date.now();
  while (Date.now() - startTime < 30000) {
    try {
      const r = await fetch(`${RELAY_URL}/api/health`);
      if (r.ok) { started = true; break; }
    } catch {}
    await delay(500);
  }

  if (!started) {
    console.error('Relay did not start within 30s');
    proc.kill();
    process.exit(1);
  }
  console.log('Relay ready.');

  // Wait for agent registration
  await delay(3000);

  // Run the test
  console.log('Running test...\n');
  const { spawn: spawnSync } = await import('child_process');
  const testProc = spawnSync(nodeCmd, [
    join(ROOT, 'tests', 'integration', 'cross-relay-instanceid-remap.test.mjs'),
    RELAY_WS,
  ], {
    cwd: ROOT,
    stdio: 'inherit',
  });

  testProc.on('close', (code) => {
    proc.kill();
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
    process.exit(code ?? 1);
  });
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
