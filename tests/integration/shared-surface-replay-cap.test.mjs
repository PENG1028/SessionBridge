// ─── SharedSurface Replay Cap Test ─────────────────────────────
// Verifies that replayPolicy tail mode correctly trims output buffer:
//   6000 lines of output with tail lines=5000 → earliest 1000 lines dropped
//
// Usage:
//   node tests/integration/shared-surface-replay-cap.test.mjs

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { randomInt } from 'crypto';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const delay = ms => new Promise(r => setTimeout(r, ms));
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

let passed = 0, failed = 0;
function check(desc, ok) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}

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

const BRIDGE = resolveBridge();
const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';

async function connectBrowser(relayWs, label) {
  const ws = new WebSocket(relayWs);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: ['shell'],
    cols: 120, rows: 40, workspace: true,
    clientToken: `cap_test_${label}_${Date.now()}`,
  }));
  return { ws, inbox, label };
}

async function connectAgent(relayWs, label) {
  const ws = new WebSocket(relayWs);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'agent', version: '0.6.0', features: ['shell'],
    label, adapterId: 'shell',
  }));
  return { ws, inbox, label };
}

async function waitFor(inbox, predicate, label, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (let i = 0; i < inbox.length; i++) {
      try {
        const m = JSON.parse(inbox[i]);
        const msg = m.v === 1 && m.body ? { ...m.body, type: m.type } : m;
        if (predicate(msg)) { inbox.splice(i, 1); return msg; }
      } catch {}
    }
    await delay(50);
  }
  const remaining = inbox.map(s => { try { return JSON.parse(s).type ?? '?'; } catch { return '?'; } }).join(', ');
  throw new Error(`[${label}] Timeout (inbox: [${remaining}])`);
}

async function main() {
  const WORK_DIR = join(tmpdir(), `sb-replay-cap-${Date.now()}-${randomInt(10000, 99999)}`);
  const CONFIG_DIR = join(WORK_DIR, '.sessionbridge');
  mkdirSync(CONFIG_DIR, { recursive: true });
  const TEST_PORT = randomInt(19000, 19999);
  const RELAY_URL = `http://127.0.0.1:${TEST_PORT}`;
  const RELAY_WS = `ws://127.0.0.1:${TEST_PORT}`;

  console.log(`\n===== SharedSurface Replay Cap Test =====`);
  console.log(`  Port: ${TEST_PORT}\n`);

  const configPath = join(CONFIG_DIR, 'agent.json');
  writeFileSync(configPath, JSON.stringify({
    label: 'replay-cap-node',
    workingDirectory: WORK_DIR,
    relayPort: TEST_PORT,
  }, null, 2), 'utf8');

  let bridgeProcess = null;

  try {
    bridgeProcess = spawn(nodeCmd, [
      BRIDGE, '--relay-port', String(TEST_PORT), '--dir', WORK_DIR,
      '--label', 'replay-cap-node',
    ], {
      cwd: ROOT,
      env: { ...process.env, BRIDGE_CONFIG: configPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let started = false;
    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
      try {
        const r = await fetch(`${RELAY_URL}/api/health`);
        if (r.ok) { started = true; break; }
      } catch {}
      await delay(500);
    }
    if (!started) { console.error('Relay did not start'); process.exit(1); }
    console.log('Relay ready.\n');
    await delay(1000);

    // ── Register agent ───────────────────────────────────────────
    const agent = await connectAgent(RELAY_WS, 'CAP-NODE');
    await waitFor(agent.inbox, m => m.type === 'welcome', 'Agent welcome');
    agent.ws.send(env('agent.register', { dir: '/fake', label: 'CAP-NODE', adapterId: 'shell' }));
    const agentReg = await waitFor(agent.inbox, m => m.type === 'agent.registered', 'Agent registered');
    const INSTANCE_ID = agentReg.instanceId;

    // ── Browser publishes surface with tail=5000 ──────────────────
    const browserA = await connectBrowser(RELAY_WS, 'A');
    await waitFor(browserA.inbox, m => m.type === 'welcome', 'A welcome');
    browserA.ws.send(env('surface.publish', {
      nodeId: INSTANCE_ID,
      title: 'Cap Test Terminal',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId: INSTANCE_ID },
      replayPolicy: { mode: 'tail', lines: 5000, bytes: 5_000_000 },
    }));

    // Terminal surfaces use synthetic operationId — no relay.operation.start
    const published = await waitFor(browserA.inbox, m => m.type === 'surface.published', 'A gets published');
    const SURFACE_ID = published.surfaceId;
    const OPERATION_ID = published.surface?.runtimeRef?.operationId;

    // ── T1: Send 6000 lines, buffer should cap at ~5000 ───────────
    console.log('── T1: 6000 lines output, tail cap at 5000 ──');
    for (let i = 1; i <= 6000; i++) {
      agent.ws.send(env('agent.operation.output', {
        operationId: OPERATION_ID,
        stream: 'stdout',
        data: `line-${String(i).padStart(5, '0')}\n`,
      }));
      if (i % 2000 === 0) await delay(10);
    }
    await delay(300);

    // Browser B (late joiner) subscribes
    const browserB = await connectBrowser(RELAY_WS, 'B');
    await waitFor(browserB.inbox, m => m.type === 'welcome', 'B welcome');
    browserB.ws.send(env('surface.subscribeNode', { nodeId: INSTANCE_ID }));

    await waitFor(browserB.inbox, m => m.type === 'surface.list', 'B gets surface.list');
    const replay = await waitFor(browserB.inbox, m => m.type === 'runtime.replay', 'B gets replay', 15000);

    const replayOutputs = replay.outputs || [];
    const replayText = replayOutputs.map(o => o.data).join('');

    // Earliest lines should be truncated
    check('T1a: line-1 is absent (trimmed)', !replayText.includes('line-00001'));
    check('T1b: line-1000 is absent (trimmed)', !replayText.includes('line-01000'));
    // The last lines must be present
    check('T1c: line-5999 present', replayText.includes('line-05999'));
    check('T1d: line-6000 present', replayText.includes('line-06000'));
    // Total outputs should be ~5000 (not 6000)
    check('T1e: replay has ~5000 lines (not 6000)',
      replayOutputs.length >= 4900 && replayOutputs.length <= 5100);
    console.log(`  Replay has ${replayOutputs.length} output chunks (expected ~5000)\n`);

    // ── T2: line-based cap works ──────────────────────────────────
    console.log('── T2: Line-based cap (not byte-based) ──');
    // With tail lines=5000, first line in buffer should be ~line-1001
    const firstLine = replayOutputs[0]?.data?.trim();
    const firstNum = parseInt(firstLine?.replace('line-', '')?.replace(/^0+/, '') || '0', 10);
    check('T2a: first replay line is around 1001', firstNum >= 900 && firstNum <= 1100);
    console.log(`  First replay line: ${firstLine || 'none'}\n`);

    // ── T3: New output still flows after cap ──────────────────────
    console.log('── T3: New output after cap still flows live ──');
    agent.ws.send(env('agent.operation.output', {
      operationId: OPERATION_ID,
      stream: 'stdout',
      data: 'line-06001\n',
    }));

    const bLive = await waitFor(browserB.inbox, m =>
      m.type === 'runtime.output' && m.data?.includes('line-06001'), 'B sees line-6001');
    check('T3a: Browser B received live output after cap', !!bLive);

    // A should also see it
    const aLive = await waitFor(browserA.inbox, m =>
      m.type === 'runtime.output' && m.data?.includes('line-06001'), 'A sees line-6001');
    check('T3b: Browser A received live output after cap', !!aLive);

    // ── T4: Result is delivered even with capped buffer ───────────
    console.log('\n── T4: Result after cap ──');
    agent.ws.send(env('agent.operation.result', {
      operationId: OPERATION_ID,
      success: true,
      exitCode: 0,
    }));

    const aResult = await waitFor(browserA.inbox, m => m.type === 'runtime.result', 'A result');
    check('T4a: Browser A received result', !!aResult);
    const bResult = await waitFor(browserB.inbox, m => m.type === 'runtime.result', 'B result');
    check('T4b: Browser B received result', !!bResult);

    // ── T5: Second late joiner gets capped replay + result ────────
    console.log('\n── T5: Third late joiner after result ──');
    const browserC = await connectBrowser(RELAY_WS, 'C');
    await waitFor(browserC.inbox, m => m.type === 'welcome', 'C welcome');
    browserC.ws.send(env('surface.subscribe', { surfaceId: SURFACE_ID }));

    const cReplay = await waitFor(browserC.inbox, m => m.type === 'runtime.replay', 'C replay', 12000);
    const cOutputs = cReplay.outputs || [];
    check('T5a: C replay also capped', cOutputs.length >= 4900 && cOutputs.length <= 5100);
    check('T5b: C got result after replay', await waitFor(browserC.inbox, m =>
      m.type === 'runtime.result', 'C result').then(() => true, () => false));

    browserC.ws.close();
    browserB.ws.close();
    browserA.ws.close();
    agent.ws.close();

  } finally {
    console.log('\n── Cleanup ──');
    if (bridgeProcess) { bridgeProcess.kill(); await delay(300); }
    try { rmSync(WORK_DIR, { recursive: true, force: true }); } catch {}
    console.log('  Done.');
  }

  console.log(`\n===== RESULTS: ${passed}/${passed + failed} passed =====`);
  if (failed) {
    console.log(`  FAIL: ${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`  PASS: SharedSurface replay cap tests passed`);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
