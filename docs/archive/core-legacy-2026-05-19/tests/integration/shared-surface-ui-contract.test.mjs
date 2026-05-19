// ─── SharedSurface UI Contract Test ────────────────────────────
// Verifies protocol-level contracts that the UI depends on, without
// requiring a real browser. Ensures:
//   1. surface.subscribeNode returns format compatible with WorkbenchState
//   2. surface.publish returns SharedSurface with runtimeRef.operationId
//   3. runtime.replay outputBuffer format compatible with xterm.js write
//   4. surface.close emits surface.closed to subscribers
//   5. workbench.tabs compatibility projection still works
//
// Usage:
//   node tests/integration/shared-surface-ui-contract.test.mjs

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
    clientToken: `ui_contract_${label}_${Date.now()}`,
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
  const WORK_DIR = join(tmpdir(), `sb-ui-contract-${Date.now()}-${randomInt(10000, 99999)}`);
  const CONFIG_DIR = join(WORK_DIR, '.sessionbridge');
  mkdirSync(CONFIG_DIR, { recursive: true });
  const TEST_PORT = randomInt(19000, 19999);
  const RELAY_URL = `http://127.0.0.1:${TEST_PORT}`;
  const RELAY_WS = `ws://127.0.0.1:${TEST_PORT}`;

  console.log(`\n===== SharedSurface UI Contract Test =====`);
  console.log(`  Port: ${TEST_PORT}\n`);

  const configPath = join(CONFIG_DIR, 'agent.json');
  writeFileSync(configPath, JSON.stringify({
    label: 'ui-contract-node',
    workingDirectory: WORK_DIR,
    relayPort: TEST_PORT,
  }, null, 2), 'utf8');

  let bridgeProcess = null;

  try {
    bridgeProcess = spawn(nodeCmd, [
      BRIDGE, '--relay-port', String(TEST_PORT), '--dir', WORK_DIR,
      '--label', 'ui-contract-node',
    ], {
      cwd: ROOT,
      env: { ...process.env, BRIDGE_CONFIG: configPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let started = false;
    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
      try { const r = await fetch(`${RELAY_URL}/api/health`); if (r.ok) { started = true; break; } } catch {}
      await delay(500);
    }
    if (!started) { console.error('Relay did not start'); process.exit(1); }
    console.log('Relay ready.\n');
    await delay(1000);

    // ── Register agent ───────────────────────────────────────────
    const agent = await connectAgent(RELAY_WS, 'CONTRACT-NODE');
    await waitFor(agent.inbox, m => m.type === 'welcome', 'Agent welcome');
    agent.ws.send(env('agent.register', {
      dir: '/fake', label: 'CONTRACT-NODE', adapterId: 'shell',
    }));
    const agentReg = await waitFor(agent.inbox, m => m.type === 'agent.registered', 'Agent registered');
    const INSTANCE_ID = agentReg.instanceId;

    // ═══════════════════════════════════════════════════════════
    // T1: surface.publish returns complete SharedSurface shape
    // ═══════════════════════════════════════════════════════════
    console.log('── T1: surface.publish returns SharedSurface with operationId ──');
    const browserA = await connectBrowser(RELAY_WS, 'A');
    await waitFor(browserA.inbox, m => m.type === 'welcome', 'A welcome');

    browserA.ws.send(env('surface.publish', {
      nodeId: INSTANCE_ID,
      title: 'UI Contract Terminal',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId: INSTANCE_ID },
      replayPolicy: { mode: 'tail', lines: 5000, bytes: 500_000 },
    }));

    // Terminal surfaces use synthetic operationId — no relay.operation.start to agent
    const published = await waitFor(browserA.inbox, m => m.type === 'surface.published', 'A gets published');

    const surface = published.surface || {};

    // Required fields for UI tab construction
    check('T1a: surfaceId is string', typeof surface.surfaceId === 'string' && surface.surfaceId.startsWith('surf_'));
    check('T1b: nodeId is string', typeof surface.nodeId === 'string');
    check('T1c: title is string', typeof surface.title === 'string');
    check('T1d: viewType is string', typeof surface.viewType === 'string');
    check('T1e: scope is string', typeof surface.scope === 'string');
    check('T1f: runtimeRef is object', typeof surface.runtimeRef === 'object' && surface.runtimeRef !== null);
    check('T1g: runtimeRef.kind present', typeof surface.runtimeRef?.kind === 'string');
    check('T1h: runtimeRef.operationId present (UI needs this for input)',
      typeof surface.runtimeRef?.operationId === 'string');
    check('T1i: runtimeRef.instanceId present',
      typeof surface.runtimeRef?.instanceId === 'string');
    check('T1j: replayPolicy is object', typeof surface.replayPolicy === 'object' && surface.replayPolicy !== null);
    check('T1k: replayPolicy.mode is tail', surface.replayPolicy?.mode === 'tail');
    check('T1l: shared is true', surface.shared === true);
    check('T1m: createdAt is number', typeof surface.createdAt === 'number');
    check('T1n: surfaceId usable as tab id', surface.surfaceId.length > 5);

    const SURFACE_ID = surface.surfaceId;
    const OPERATION_ID = surface.runtimeRef?.operationId;

    // ═══════════════════════════════════════════════════════════
    // T2: runtime.replay output format compatible with xterm.js
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T2: runtime.replay output format ──');

    // Send 10 lines via agent
    for (let i = 1; i <= 10; i++) {
      agent.ws.send(env('agent.operation.output', {
        operationId: OPERATION_ID,
        stream: 'stdout',
        data: `\x1b[32mgreen\x1b[0m line ${i}\n`,
      }));
      await delay(5);
    }
    await delay(200);
    drain(browserA.inbox, 'runtime.output'); // clear live output

    // Late joiner subscribes
    const browserB = await connectBrowser(RELAY_WS, 'B');
    await waitFor(browserB.inbox, m => m.type === 'welcome', 'B welcome');
    browserB.ws.send(env('surface.subscribeNode', { nodeId: INSTANCE_ID }));

    await waitFor(browserB.inbox, m => m.type === 'surface.list', 'B gets surface.list');
    const replay = await waitFor(browserB.inbox, m => m.type === 'runtime.replay', 'B gets replay', 12000);

    const outputs = replay.outputs || [];
    check('T2a: outputs is array', Array.isArray(outputs));
    check('T2b: outputs not empty', outputs.length > 0);

    // Each output must be consumable by xterm.js write()
    for (const o of outputs.slice(0, 3)) {
      check(`T2c: output has data (seq=${o.seq})`, typeof o.data === 'string' && o.data.length > 0);
      check(`T2d: output has stream (seq=${o.seq})`, ['stdout', 'stderr'].includes(o.stream));
    }

    // Verify ANSI escape codes survive the round-trip
    const hasAnsi = outputs.some(o => o.data?.includes('\x1b['));
    check('T2e: ANSI escape codes preserved in replay', hasAnsi);

    // Verify all 10 lines are present
    const allText = outputs.map(o => o.data).join('');
    check('T2f: replay contains line 1', allText.includes('line 1'));
    check('T2g: replay contains line 10', allText.includes('line 10'));

    // ═══════════════════════════════════════════════════════════
    // T3: runtime.output live format
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T3: runtime.output live format ──');
    agent.ws.send(env('agent.operation.output', {
      operationId: OPERATION_ID,
      stream: 'stdout',
      data: 'live output line\n',
    }));

    const aLive = await waitFor(browserA.inbox, m =>
      m.type === 'runtime.output' && m.data?.includes('live output'), 'A gets live output');
    check('T3a: runtime.output has surfaceId', typeof aLive.surfaceId === 'string');
    check('T3b: runtime.output has data', typeof aLive.data === 'string');
    check('T3c: runtime.output has stream', aLive.stream === 'stdout');

    // B should also get live (subscribed)
    const bLive = await waitFor(browserB.inbox, m =>
      m.type === 'runtime.output' && m.data?.includes('live output'), 'B gets live output');
    check('T3d: Subscriber B also received live output', !!bLive);

    // ═══════════════════════════════════════════════════════════
    // T4: result format
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T4: runtime.result format ──');
    drain(browserA.inbox, 'runtime.result');
    drain(browserB.inbox, 'runtime.result');

    agent.ws.send(env('agent.operation.result', {
      operationId: OPERATION_ID,
      success: false,
      data: { reason: 'test failure' },
      exitCode: 1,
    }));

    const aResult = await waitFor(browserA.inbox, m => m.type === 'runtime.result', 'A result');
    check('T4a: result has success field', typeof aResult.success === 'boolean');
    check('T4b: result has exitCode', aResult.exitCode === 1);
    check('T4c: result has operationId', typeof aResult.operationId === 'string');

    const bResult = await waitFor(browserB.inbox, m => m.type === 'runtime.result', 'B result');
    check('T4d: B also received result', !!bResult);

    // ═══════════════════════════════════════════════════════════
    // T5: surface.subscribeNode returns WorkbenchState-compatible data
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T5: surface.subscribeNode → WorkbenchState compatibility ──');
    const browserC = await connectBrowser(RELAY_WS, 'C');
    await waitFor(browserC.inbox, m => m.type === 'welcome', 'C welcome');
    browserC.ws.send(env('surface.subscribeNode', { nodeId: INSTANCE_ID }));

    const cList = await waitFor(browserC.inbox, m => m.type === 'surface.list', 'C gets surface.list');

    // The surface.list response must have fields the UI can turn into tabs
    const surfaces = Array.isArray(cList.surfaces) ? cList.surfaces : (cList.body?.surfaces || []);
    check('T5a: surface.list returns array', Array.isArray(surfaces));
    if (surfaces.length > 0) {
      const s = surfaces[0];
      // Every field the UI uses to construct a PaneTab must exist
      check('T5b: surface has surfaceId (→ tab.id)', typeof s.surfaceId === 'string');
      check('T5c: surface has title (→ tab.title)', typeof s.title === 'string');
      check('T5d: surface has viewType (→ tab.viewType)', typeof s.viewType === 'string');
      check('T5e: surface has runtimeRef (→ tab.instanceId + metadata)',
        typeof s.runtimeRef === 'object' && s.runtimeRef !== null);
      // nodeId must be present so UI knows which workbench to add the tab to
      check('T5f: surface has nodeId', typeof s.nodeId === 'string');
    }

    // Each shared surface in the list triggers an individual replay
    if (surfaces.length > 0) {
      const cReplay = await waitFor(browserC.inbox, m => m.type === 'runtime.replay', 'C gets replay', 12000);
      check('T5g: subscribeNode triggers runtime.replay for each shared surface',
        !!cReplay && Array.isArray(cReplay.outputs));
      check('T5h: replay has surfaceId', typeof cReplay.surfaceId === 'string');
    }

    // ═══════════════════════════════════════════════════════════
    // T6: surface.close emits surface.closed to all subscribers
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T6: surface.close broadcast ──');
    drain(browserB.inbox, 'surface.closed');
    drain(browserC.inbox, 'surface.closed');

    browserA.ws.send(env('surface.close', { surfaceId: SURFACE_ID }));

    // B was subscribed via subscribeNode → should get surface.closed
    const bClosed = await waitFor(browserB.inbox, m =>
      m.type === 'surface.closed' && m.surfaceId === SURFACE_ID, 'B gets surface.closed');
    check('T6a: B received surface.closed with surfaceId', !!bClosed && bClosed.surfaceId === SURFACE_ID);

    // Sender (A) does NOT get surface.closed for their own close
    const aClosedMsgs = drain(browserA.inbox, 'surface.closed');
    check('T6b: Sender exclusion — A did NOT get surface.closed', aClosedMsgs.length === 0);

    // Verify surface is gone
    browserC.ws.send(env('surface.subscribe', { surfaceId: SURFACE_ID }));
    const cErr = await waitFor(browserC.inbox, m =>
      m.type === 'error' && m.code === 'SURFACE_NOT_FOUND', 'C gets SURFACE_NOT_FOUND');
    check('T6c: Closed surface returns SURFACE_NOT_FOUND', !!cErr);

    // ═══════════════════════════════════════════════════════════
    // T7: workbench.tabs compatibility projection
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T7: workbench.tabs backward-compat projection ──');

    // Publish a new surface — should also create a workbench tab
    const browserD = await connectBrowser(RELAY_WS, 'D');
    await waitFor(browserD.inbox, m => m.type === 'welcome', 'D welcome');
    browserD.ws.send(env('surface.publish', {
      nodeId: INSTANCE_ID,
      title: 'Compat Terminal',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId: INSTANCE_ID },
      replayPolicy: { mode: 'tail', lines: 5000, bytes: 500_000 },
    }));

    const pub2 = await waitFor(browserD.inbox, m => m.type === 'surface.published', 'D published');
    const SURFACE2_ID = pub2.surfaceId;

    await delay(300);

    // Query workbench.tabs for the node
    browserD.ws.send(env('workbench.subscribe', { nodeId: INSTANCE_ID }));
    const wbTabs = await waitFor(browserD.inbox, m => m.type === 'workbench.tabs', 'D gets workbench.tabs');

    const tabs = Array.isArray(wbTabs.tabs) ? wbTabs.tabs : (wbTabs.body?.tabs || []);
    const compatTab = tabs.find(t => t._surfaceId === SURFACE2_ID || t.id === SURFACE2_ID);

    check('T7a: workbench.tabs includes surface-projected tab', !!compatTab);
    if (compatTab) {
      check('T7b: compat tab has title', compatTab.title === 'Compat Terminal');
      check('T7c: compat tab has viewType', compatTab.viewType === 'terminal');
      check('T7d: compat tab has instanceId', typeof compatTab.instanceId === 'string');
    }

    // Clean up
    browserD.ws.send(env('surface.close', { surfaceId: SURFACE2_ID }));
    await waitFor(browserD.inbox, m =>
      m.type === 'error' || m.type === 'surface.closed', 'close ack or error',
    ).catch(() => {});

    browserA.ws.close();
    browserB.ws.close();
    browserC.ws.close();
    browserD.ws.close();
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
  console.log(`  PASS: UI contract tests passed`);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
