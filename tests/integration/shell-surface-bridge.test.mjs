// ─── Shell-to-Surface Bridge Test ────────────────────────
// Verifies that real terminal output (agent.stdout → broadcastShellOutput)
// flows through to surface subscribers as runtime.output.
//
// This is the critical bridge: without it, real shell sessions don't
// appear in SharedSurface replays for late joiners.
//
// Scenario:
//   1. Agent registers (simulates PENGSPC)
//   2. Browser A sends surface.publish with the agent's instanceId
//   3. Agent sends agent.stdout (the real shell output path)
//   4. Browser A receives BOTH shell.output AND runtime.output
//   5. Browser B subscribes → gets runtime.replay with the shell output
//   6. Browser A's input via shell.input → agent.stdout → B sees it live
//
// Usage:
//   node tests/integration/shell-surface-bridge.test.mjs

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
    clientToken: `bridge_${label}_${Date.now()}`,
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
  const WORK_DIR = join(tmpdir(), `sb-bridge-test-${Date.now()}-${randomInt(10000, 99999)}`);
  const CONFIG_DIR = join(WORK_DIR, '.sessionbridge');
  mkdirSync(CONFIG_DIR, { recursive: true });
  const TEST_PORT = randomInt(19000, 19999);
  const RELAY_URL = `http://127.0.0.1:${TEST_PORT}`;
  const RELAY_WS = `ws://127.0.0.1:${TEST_PORT}`;

  console.log(`\n===== Shell-to-Surface Bridge Test =====`);
  console.log(`  Bridge: ${BRIDGE}`);
  console.log(`  Port: ${TEST_PORT}\n`);

  const configPath = join(CONFIG_DIR, 'agent.json');
  writeFileSync(configPath, JSON.stringify({
    label: 'bridge-test-node',
    workingDirectory: WORK_DIR,
    relayPort: TEST_PORT,
  }, null, 2), 'utf8');

  let bridgeProcess = null;

  try {
    bridgeProcess = spawn(nodeCmd, [
      BRIDGE, '--relay-port', String(TEST_PORT), '--dir', WORK_DIR,
      '--label', 'bridge-test-node',
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

    if (!started) { console.error('Relay did not start within 30s'); process.exit(1); }
    console.log('Relay ready.\n');
    await delay(1000);

    // ── T1: Register agent (simulates PENGSPC) ────────────────
    console.log('── T1: Register agent ──');
    const agent = await connectAgent(RELAY_WS, 'PENGSPC');
    await waitFor(agent.inbox, m => m.type === 'welcome', 'Agent welcome');

    agent.ws.send(env('agent.register', {
      dir: '/fake/pengspc', label: 'PENGSPC', adapterId: 'shell',
    }));

    const agentReg = await waitFor(agent.inbox, m =>
      m.type === 'agent.registered', 'Agent registered');
    const INSTANCE_ID = agentReg.instanceId;
    check('T1: Agent registered', typeof INSTANCE_ID === 'string');
    console.log(`  InstanceId: ${INSTANCE_ID}\n`);

    // ── T2: Browser A publishes terminal surface ──────────────
    console.log('── T2: Browser A publishes surface → gets surface.published ──');
    const browserA = await connectBrowser(RELAY_WS, 'A');
    await waitFor(browserA.inbox, m => m.type === 'welcome', 'A welcome');

    browserA.ws.send(env('surface.publish', {
      nodeId: INSTANCE_ID,
      title: 'Terminal (PENGSPC)',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId: INSTANCE_ID },
      replayPolicy: { mode: 'tail', lines: 100, bytes: 100_000 },
    }));

    const published = await waitFor(browserA.inbox, m =>
      m.type === 'surface.published', 'A gets surface.published');
    const SURFACE_ID = published.surfaceId;
    const OPERATION_ID = published.surface?.runtimeRef?.operationId;
    check('T2a: surface.published received', !!SURFACE_ID);
    check('T2b: surface has operationId', !!OPERATION_ID);
    console.log(`  SurfaceId: ${SURFACE_ID}`);
    console.log(`  OperationId: ${OPERATION_ID}\n`);

    // Drain any initial runtime.status
    drain(browserA.inbox, 'runtime.status');

    // ── T3: Agent sends agent.stdout → BOTH shell.output AND runtime.output ─
    console.log('── T3: agent.stdout → broadcastShellOutput → BOTH paths ──');

    // Send agent.stdout — this is the REAL shell output path that PENGSPC agent emits
    agent.ws.send(env('agent.stdout', {
      instanceId: INSTANCE_ID,
      data: 'pi@PENGSPC:~$ ',
    }));

    await delay(200);

    // THE KEY ASSERTION: agent.stdout must bridge to runtime.output for surface subscribers
    const aRtOutput = drain(browserA.inbox, 'runtime.output');
    check('T3a: agent.stdout → bridge → runtime.output (surface subscriber)', aRtOutput.length > 0);

    if (aRtOutput.length > 0) {
      check('T3b: runtime.output contains PENGSPC prompt',
        aRtOutput.some(o => o.data.includes('PENGSPC')));
    }

    // Send a command and its output — simulates real terminal interaction
    agent.ws.send(env('agent.stdout', {
      instanceId: INSTANCE_ID,
      data: 'echo hello-from-pengspc\n',
    }));
    await delay(50);
    agent.ws.send(env('agent.stdout', {
      instanceId: INSTANCE_ID,
      data: 'hello-from-pengspc\n',
    }));
    await delay(50);
    agent.ws.send(env('agent.stdout', {
      instanceId: INSTANCE_ID,
      data: 'pi@PENGSPC:~$ ',
    }));
    await delay(200);

    const aRt2 = drain(browserA.inbox, 'runtime.output');
    check('T3c: agent.stdout → bridge → runtime.output for command', aRt2.length > 0);
    const aRtText = aRt2.map(o => o.data).join('');
    check('T3d: runtime.output contains command output "hello-from-pengspc"',
      aRtText.includes('hello-from-pengspc'));
    console.log(`  Runtime output: ${aRt2.length} msgs (bridged from agent.stdout)\n`);

    // ── T4: Browser B subscribes → gets replay with shell history ─
    console.log('── T4: Browser B late-join → gets replay with shell history ──');
    const browserB = await connectBrowser(RELAY_WS, 'B');
    await waitFor(browserB.inbox, m => m.type === 'welcome', 'B welcome');

    browserB.ws.send(env('surface.subscribeNode', { nodeId: INSTANCE_ID }));

    // B should get surface.list
    const surfaceList = await waitFor(browserB.inbox, m =>
      m.type === 'surface.list', 'B gets surface.list');
    check('T4a: B received surface.list', !!surfaceList);

    // B should get runtime.replay with the shell output history
    const replay = await waitFor(browserB.inbox, m =>
      m.type === 'runtime.replay', 'B gets runtime.replay', 12000);
    check('T4b: B received runtime.replay', !!replay);

    const replayOutputs = replay.outputs || [];
    const replayText = replayOutputs.map(o => o.data).join('');
    check('T4c: replay contains PENGSPC prompt (history preserved)',
      replayText.includes('PENGSPC'));
    check('T4d: replay contains command output (history preserved)',
      replayText.includes('hello-from-pengspc'));
    check('T4e: replay has output chunks',
      replayOutputs.length >= 2);
    console.log(`  Replay has ${replayOutputs.length} output chunks\n`);

    // ── T5: More agent.stdout → both A and B get live runtime.output ─
    console.log('── T5: Live shell output reaches both A and B ──');
    drain(browserA.inbox, 'runtime.output');
    drain(browserB.inbox, 'runtime.output');

    agent.ws.send(env('agent.stdout', {
      instanceId: INSTANCE_ID,
      data: 'whoami\n',
    }));
    await delay(50);
    agent.ws.send(env('agent.stdout', {
      instanceId: INSTANCE_ID,
      data: 'pi\n',
    }));
    await delay(200);

    const aNewRt = drain(browserA.inbox, 'runtime.output');
    const bNewRt = drain(browserB.inbox, 'runtime.output');
    check('T5a: A received live runtime.output', aNewRt.length > 0);
    check('T5b: B received live runtime.output', bNewRt.length > 0);

    const bRtText = bNewRt.map(o => o.data).join('');
    check('T5c: B sees whoami output via runtime.output (live sync)',
      bRtText.includes('whoami') || bRtText.includes('pi'));
    console.log(`  A got ${aNewRt.length} runtime msgs, B got ${bNewRt.length}\n`);

    // ── T6: Shell exit → both get runtime.result ──────────────
    console.log('── T6: Shell exit → runtime.result for both ──');
    drain(browserA.inbox, 'runtime.result');
    drain(browserB.inbox, 'runtime.result');

    agent.ws.send(env('agent.instance.exit', {
      instanceId: INSTANCE_ID,
      exitCode: 0,
    }));

    const aResult = await waitFor(browserA.inbox, m =>
      m.type === 'runtime.result', 'A gets runtime.result', 8000);
    const bResult = await waitFor(browserB.inbox, m =>
      m.type === 'runtime.result', 'B gets runtime.result', 8000);

    check('T6a: A received runtime.result', !!aResult);
    check('T6b: A result success=true', aResult.success === true);
    check('T6c: B received runtime.result', !!bResult);
    check('T6d: B result success=true', bResult.success === true);
    console.log(`  Both browsers received runtime.result\n`);

  } finally {
    console.log('── Cleanup ──');
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
  console.log(`  PASS: Shell-to-Surface bridge verified`);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
