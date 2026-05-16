// ─── SharedSurface Terminal Replay Test ──────────────────────
// MVP protocol test for the SharedSurface + RuntimeReplay model.
// Verifies that:
//   1. surface.publish creates a surface + operation, returns surfaceId
//   2. Live output from agent reaches surface subscriber as runtime.output
//   3. Late joiner (Browser B) gets surface.list + runtime.replay with history
//   4. New live output reaches both A and B
//   5. runtime.result reaches both subscribers
//
// Usage:
//   node tests/integration/shared-surface-terminal-replay.test.mjs [ws://host:port]
//   Default: starts its own bridge process on a random port

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
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
    clientToken: `surface_test_${label}_${Date.now()}`,
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

function drain(inbox, type) {
  const msgs = [];
  for (let i = inbox.length - 1; i >= 0; i--) {
    try {
      const m = JSON.parse(inbox[i]);
      const msg = m.v === 1 && m.body ? { ...m.body, type: m.type } : m;
      if (msg.type === type) { msgs.unshift(msg); inbox.splice(i, 1); }
    } catch {}
  }
  return msgs;
}

async function main() {
  const WORK_DIR = join(tmpdir(), `sb-surface-test-${Date.now()}-${randomInt(10000, 99999)}`);
  const CONFIG_DIR = join(WORK_DIR, '.sessionbridge');
  mkdirSync(CONFIG_DIR, { recursive: true });
  const TEST_PORT = randomInt(19000, 19999);
  const RELAY_URL = `http://127.0.0.1:${TEST_PORT}`;
  const RELAY_WS = `ws://127.0.0.1:${TEST_PORT}`;

  console.log(`\n===== SharedSurface Terminal Replay Test =====`);
  console.log(`  Bridge: ${BRIDGE}`);
  console.log(`  Work dir: ${WORK_DIR}`);
  console.log(`  Port: ${TEST_PORT}\n`);

  const configPath = join(CONFIG_DIR, 'agent.json');
  const cleanConfig = {
    label: 'surface-test-node',
    workingDirectory: WORK_DIR,
    relayPort: TEST_PORT,
  };
  writeFileSync(configPath, JSON.stringify(cleanConfig, null, 2), 'utf8');

  let bridgeProcess = null;

  try {
    // ── Start bridge ──────────────────────────────────────────
    bridgeProcess = spawn(nodeCmd, [
      BRIDGE, '--relay-port', String(TEST_PORT), '--dir', WORK_DIR,
      '--label', 'surface-test-node',
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

    if (!started) {
      console.error('Relay did not start within 30s');
      process.exit(1);
    }
    console.log('Relay ready.\n');

    // Let bridge fully initialize
    await delay(1000);

    // ── T1: Register mock agent ────────────────────────────────
    console.log('── T1: Register mock agent ──');
    const agent = await connectAgent(RELAY_WS, 'TEST-NODE');
    await waitFor(agent.inbox, m => m.type === 'welcome', 'Agent welcome');

    agent.ws.send(env('agent.register', {
      dir: '/fake/test', label: 'TEST-NODE', adapterId: 'shell',
    }));

    const agentReg = await waitFor(agent.inbox, m =>
      m.type === 'agent.registered', 'Agent registered');
    const INSTANCE_ID = agentReg.instanceId;
    check('T1: Agent registered with instanceId', typeof INSTANCE_ID === 'string');
    console.log(`  InstanceId: ${INSTANCE_ID}\n`);

    // ── T2: Browser A publishes shared terminal surface ────────
    // Terminal surfaces use synthetic operationIds — the relay does NOT
    // forward relay.operation.start to the agent because the shell PTY
    // already exists (spawned via shell.spawn / relay.shell.spawn).
    // The operationId exists only for relay-internal input/replay binding.
    console.log('── T2: Browser A publishes shared terminal surface ──');
    const browserA = await connectBrowser(RELAY_WS, 'A');
    await waitFor(browserA.inbox, m => m.type === 'welcome', 'Browser A welcome');

    browserA.ws.send(env('surface.publish', {
      nodeId: INSTANCE_ID,
      title: 'Shared Terminal',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId: INSTANCE_ID },
      replayPolicy: { mode: 'tail', lines: 100, bytes: 100_000 },
    }));

    // Browser A should receive surface.published with synthetic operationId
    const published = await waitFor(browserA.inbox, m =>
      m.type === 'surface.published', 'Browser A gets surface.published');
    const SURFACE_ID = published.surfaceId;
    const OPERATION_ID = published.surface?.runtimeRef?.operationId;
    check('T2a: Browser A received surface.published', !!SURFACE_ID);
    check('T2b: surface has runtimeRef.operationId (synthetic, no relay.operation.start)',
      typeof OPERATION_ID === 'string' && OPERATION_ID.length > 0);
    check('T2c: surface viewType is terminal',
      published.surface?.viewType === 'terminal');
    check('T2d: surface replayPolicy mode is tail',
      published.surface?.replayPolicy?.mode === 'tail');
    // Verify agent did NOT receive relay.operation.start
    const agentInboxTypes = agent.inbox.map(s => {
      try { const m = JSON.parse(s); const msg = m.v === 1 && m.body ? { ...m.body, type: m.type } : m; return msg.type; }
      catch { return '?'; }
    });
    check('T2e: agent did NOT receive relay.operation.start',
      !agentInboxTypes.includes('relay.operation.start'));
    console.log(`  SurfaceId: ${SURFACE_ID}`);
    console.log(`  OperationId: ${OPERATION_ID} (synthetic)\n`);

    // Drain any initial runtime.status
    drain(browserA.inbox, 'runtime.status');

    // ── T3: Agent sends output → Browser A gets runtime.output ─
    console.log('── T3: Agent sends 50 lines → Browser A gets live runtime.output ──');
    for (let i = 1; i <= 50; i++) {
      agent.ws.send(env('agent.operation.output', {
        operationId: OPERATION_ID,
        stream: 'stdout',
        data: `line-${i}\n`,
      }));
      await delay(5);
    }

    // Browser A should receive runtime.output messages
    await delay(200);
    const aOutput = drain(browserA.inbox, 'runtime.output');
    check('T3a: Browser A received runtime.output', aOutput.length > 0);
    const aLines = aOutput.filter(m => m.stream === 'stdout');
    check('T3b: Browser A received ~50 stdout lines', aLines.length >= 45);
    console.log(`  Browser A got ${aLines.length} runtime.output messages\n`);

    // ── T4: Late joiner Browser B subscribes → gets replay ─────
    console.log('── T4: Browser B subscribes to node → gets surface list + replay ──');
    const browserB = await connectBrowser(RELAY_WS, 'B');
    await waitFor(browserB.inbox, m => m.type === 'welcome', 'Browser B welcome');

    browserB.ws.send(env('surface.subscribeNode', { nodeId: INSTANCE_ID }));

    // B should get surface.list
    const surfaceList = await waitFor(browserB.inbox, m =>
      m.type === 'surface.list', 'Browser B gets surface.list');
    check('T4a: Browser B received surface.list', !!surfaceList);
    check('T4b: surface.list has 1 surface',
      Array.isArray(surfaceList.surfaces) && surfaceList.surfaces.length === 1);

    // B should get runtime.replay with history
    const replay = await waitFor(browserB.inbox, m =>
      m.type === 'runtime.replay', 'Browser B gets runtime.replay', 12000);
    check('T4c: Browser B received runtime.replay', !!replay);
    check('T4d: replay contains outputs',
      Array.isArray(replay.outputs) && replay.outputs.length > 0);

    // Verify history content
    const replayOutputs = replay.outputs || [];
    const replayText = replayOutputs.map(o => o.data).join('');
    check('T4e: replay contains line-1',
      replayText.includes('line-1'));
    check('T4f: replay contains line-50',
      replayText.includes('line-50'));
    check('T4g: replay has ~50 lines',
      replayOutputs.length >= 45);
    console.log(`  Replay has ${replayOutputs.length} output chunks\n`);

    // ── T5: New live output reaches both A and B ───────────────
    console.log('── T5: Live output reaches both A and B ──');
    drain(browserA.inbox, 'runtime.output');
    drain(browserB.inbox, 'runtime.output');

    for (let i = 51; i <= 60; i++) {
      agent.ws.send(env('agent.operation.output', {
        operationId: OPERATION_ID,
        stream: 'stdout',
        data: `line-${i}\n`,
      }));
      await delay(5);
    }

    await delay(300);

    const aNew = drain(browserA.inbox, 'runtime.output');
    const bNew = drain(browserB.inbox, 'runtime.output');
    check('T5a: Browser A received new live output', aNew.length > 0);
    check('T5b: Browser B received new live output', bNew.length > 0);

    const aNewText = aNew.map(o => o.data).join('');
    const bNewText = bNew.map(o => o.data).join('');
    check('T5c: A saw line-60', aNewText.includes('line-60'));
    check('T5d: B saw line-60', bNewText.includes('line-60'));
    console.log(`  A got ${aNew.length} new outputs, B got ${bNew.length} new outputs\n`);

    // ── T6: Agent sends result → both receive runtime.result ────
    console.log('── T6: Agent sends result → both receive runtime.result ──');
    drain(browserA.inbox, 'runtime.result');
    drain(browserB.inbox, 'runtime.result');

    agent.ws.send(env('agent.operation.result', {
      operationId: OPERATION_ID,
      success: true,
      data: { totalLines: 60 },
      exitCode: 0,
    }));

    const aResult = await waitFor(browserA.inbox, m =>
      m.type === 'runtime.result', 'Browser A gets runtime.result');
    const bResult = await waitFor(browserB.inbox, m =>
      m.type === 'runtime.result', 'Browser B gets runtime.result');

    check('T6a: Browser A received runtime.result', !!aResult);
    check('T6b: A result success=true', aResult.success === true);
    check('T6c: Browser B received runtime.result', !!bResult);
    check('T6d: B result success=true', bResult.success === true);
    console.log(`  Both browsers received runtime.result\n`);

    // ── T7: surface.subscribe on a single surface also works ────
    console.log('── T7: surface.subscribe (individual) works ──');
    const browserC = await connectBrowser(RELAY_WS, 'C');
    await waitFor(browserC.inbox, m => m.type === 'welcome', 'Browser C welcome');

    browserC.ws.send(env('surface.subscribe', { surfaceId: SURFACE_ID }));

    const cReplay = await waitFor(browserC.inbox, m =>
      m.type === 'runtime.replay', 'Browser C gets replay via surface.subscribe', 12000);
    check('T7a: Browser C got runtime.replay via surface.subscribe',
      !!cReplay && Array.isArray(cReplay.outputs) && cReplay.outputs.length > 0);

    // C should also get the terminal result
    const cResult = await waitFor(browserC.inbox, m =>
      m.type === 'runtime.result', 'Browser C gets runtime.result');
    check('T7b: Browser C got runtime.result (late joiner)', !!cResult);

    // Close C
    browserC.ws.close();

    // ── T8: surface.close broadcasts to other subscribers ──────
    console.log('\n── T8: surface.close ──');
    drain(browserB.inbox, 'surface.closed');

    browserA.ws.send(env('surface.close', { surfaceId: SURFACE_ID }));

    // Sender exclusion: A doesn't get their own close message.
    // Verify surface is gone by re-subscribing.
    const reSub = await connectBrowser(RELAY_WS, 'reSub-test');
    await waitFor(reSub.inbox, m => m.type === 'welcome', 'reSub welcome');
    reSub.ws.send(env('surface.subscribe', { surfaceId: SURFACE_ID }));
    const reSubErr = await waitFor(reSub.inbox, m =>
      m.type === 'error' && m.code === 'SURFACE_NOT_FOUND', 'SURFACE_NOT_FOUND after close');
    check('T8a: Surface not found after close', !!reSubErr);

    // B should also get surface.closed (B was subscribed via subscribeNode)
    const bClosed = await waitFor(browserB.inbox, m =>
      m.type === 'surface.closed', 'B gets surface.closed');
    check('T8b: B got surface.closed', !!bClosed);

    reSub.ws.close();

    // ── T9: surface.publish without instanceId still creates surface ──
    console.log('\n── T9: surface.publish without instanceId (no runtime) ──');
    browserA.ws.send(env('surface.publish', {
      nodeId: INSTANCE_ID,
      title: 'Static Panel',
      viewType: 'settings',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'none' },
      replayPolicy: { mode: 'none' },
    }));

    const staticPub = await waitFor(browserA.inbox, m =>
      m.type === 'surface.published', 'Static panel published');
    check('T9a: Static panel surface created', !!staticPub?.surfaceId);
    check('T9b: Static panel has runtimeRef.kind=none',
      staticPub.surface?.runtimeRef?.kind === 'none');
    check('T9c: Static panel replayPolicy mode=none',
      staticPub.surface?.replayPolicy?.mode === 'none');

  } finally {
    // ── Cleanup ──────────────────────────────────────────────
    console.log('\n── Cleanup ──');

    if (bridgeProcess) {
      bridgeProcess.kill();
      await delay(300);
    }

    try { rmSync(WORK_DIR, { recursive: true, force: true }); } catch {}
    console.log('  Done.');
  }

  console.log(`\n===== RESULTS: ${passed}/${passed + failed} passed =====`);
  if (failed) {
    console.log(`  FAIL: ${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`  PASS: SharedSurface terminal replay tests passed`);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
