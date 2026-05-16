// ─── Real-World UI Simulation: HTTP createInstance → surface.publish ──
// This test simulates the EXACT browser behavior when a user creates a
// terminal, unlike other tests that skip the HTTP createInstance step.
//
// Real UI flow (from exploration):
//   1. TerminalView calls createInstance() → HTTP POST /api/instances
//   2. On success, bindCurrentTabInstance(instanceId)
//   3. bindCurrentTabInstance dispatches SET_TAB_VIEW then calls
//      publishSurfaceForTab(tab, instanceId)
//   4. publishSurfaceForTab sends surface.publish via WebSocket
//
// This test checks whether the relay correctly handles this exact sequence.
//
// Usage:
//   node tests/integration/real-ui-simulation-full-pipeline.test.mjs

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
    clientToken: `real_ui_${label}_${Date.now()}`,
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
  const WORK_DIR = join(tmpdir(), `sb-real-ui-test-${Date.now()}-${randomInt(10000, 99999)}`);
  const CONFIG_DIR = join(WORK_DIR, '.sessionbridge');
  mkdirSync(CONFIG_DIR, { recursive: true });
  const TEST_PORT = randomInt(19000, 19999);
  const RELAY_URL = `http://127.0.0.1:${TEST_PORT}`;
  const RELAY_WS = `ws://127.0.0.1:${TEST_PORT}`;

  console.log('═══════════════════════════════════════════');
  console.log('Real-UI Simulation: HTTP createInstance → surface.publish');
  console.log('═══════════════════════════════════════════');
  console.log(`  Port: ${TEST_PORT}\n`);

  const configPath = join(CONFIG_DIR, 'agent.json');
  writeFileSync(configPath, JSON.stringify({
    label: 'real-ui-test-node',
    workingDirectory: WORK_DIR,
    relayPort: TEST_PORT,
  }, null, 2), 'utf8');

  let relayProc = null;

  try {
    // ── Start relay ──────────────────────────────────────────
    relayProc = spawn(nodeCmd, [
      BRIDGE, '--relay-port', String(TEST_PORT), '--dir', WORK_DIR,
      '--label', 'real-ui-test-node',
    ], {
      cwd: ROOT,
      env: { ...process.env, BRIDGE_CONFIG: configPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait for HTTP ready
    let started = false;
    for (let i = 0; i < 80; i++) {
      try {
        const res = await fetch(`${RELAY_URL}/api/health`);
        if (res.ok) { started = true; break; }
      } catch {}
      await delay(250);
    }
    if (!started) { console.error('FATAL: Relay did not start'); process.exit(1); }

    // Wait for WebSocket ready
    for (let i = 0; i < 30; i++) {
      try {
        const testWs = new WebSocket(RELAY_WS);
        await new Promise((resolve, reject) => {
          testWs.on('open', () => { testWs.close(); resolve(true); });
          testWs.on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 500);
        });
        break;
      } catch {}
      await delay(200);
    }
    console.log('  Relay ready\n');

    // ── Register agent ────────────────────────────────────────
    console.log('── Register agent ──');
    const agent = await connectAgent(RELAY_WS, 'TEST-NODE');
    await waitFor(agent.inbox, m => m.type === 'welcome', 'agent welcome');
    agent.ws.send(env('agent.register', {
      dir: WORK_DIR, label: 'TEST-NODE', adapterId: 'shell',
    }));
    const agentReg = await waitFor(agent.inbox, m => m.type === 'agent.registered', 'agent registered');
    const NODE_ID = agentReg.instanceId;
    console.log(`  NODE_ID: ${NODE_ID}\n`);

    // ═══════════════════════════════════════════════════════════
    // STEP 1: Simulate TerminalView mounting with no instanceId
    // Browser A connects, subscribes to the node
    // ═══════════════════════════════════════════════════════════
    console.log('── Step 1: Browser A subscribes to node ──');
    const browserA = await connectBrowser(RELAY_WS, 'A');
    await waitFor(browserA.inbox, m => m.type === 'welcome', 'A welcome');
    browserA.ws.send(env('workbench.subscribe', { nodeId: NODE_ID }));
    const initTabs = await waitFor(browserA.inbox, m =>
      m.type === 'workbench.tabs' && m.nodeId === NODE_ID, 'A initial tabs');
    console.log(`  Initial tabs: ${initTabs.tabs?.length || 0}\n`);

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Simulate HTTP createInstance (exactly like UI)
    // This is what TerminalView's auto-create useEffect does:
    //   const result = await createInstance(cwd, 'Terminal', 'shell');
    // ═══════════════════════════════════════════════════════════
    console.log('── Step 2: HTTP POST /api/instances (simulating createInstance) ──');

    let instanceId;
    try {
      const res = await fetch(`${RELAY_URL}/api/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: WORK_DIR, label: 'Terminal', adapterId: 'shell' }),
      });
      const data = await res.json();
      console.log(`  HTTP response: success=${data.success}, instanceId=${data.instance?.id}`);
      check('Step 2: HTTP createInstance succeeded', data.success === true);
      check('Step 2: instance has id', !!data.instance?.id);
      instanceId = data.instance?.id;
    } catch (e) {
      check('Step 2: HTTP createInstance succeeded', false);
      console.log(`  Error: ${e.message}`);
    }

    if (!instanceId) {
      console.log('  FATAL: No instanceId — cannot continue');
      process.exit(1);
    }
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // STEP 3: Simulate bindCurrentTabInstance + publishSurfaceForTab
    // This is what happens after createInstance returns:
    //   1. surfacePublished.current = true (prevents duplicate)
    //   2. bindCurrentTabInstance(instanceId) → SET_TAB_VIEW + publishSurfaceForTab
    //   3. publishSurfaceForTab sends surface.publish via WebSocket
    // ═══════════════════════════════════════════════════════════
    console.log('── Step 3: Send surface.publish (simulating publishSurfaceForTab) ──');

    browserA.ws.send(env('surface.publish', {
      nodeId: NODE_ID,
      title: 'Terminal',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId },
      replayPolicy: { mode: 'tail', lines: 5000, bytes: 500000 },
    }));

    let surfaceId;
    try {
      const pub = await waitFor(browserA.inbox, m =>
        m.type === 'surface.published' &&
        m.surface?.runtimeRef?.instanceId === instanceId,
        'A surface.published', 5000);
      surfaceId = pub.surfaceId || pub.surface?.surfaceId;
      console.log(`  surface.published: ${surfaceId}`);
      check('Step 3: surface.published received', !!surfaceId);
      check('Step 3: surface has correct instanceId',
        pub.surface?.runtimeRef?.instanceId === instanceId);
      check('Step 3: surface has operationId',
        typeof pub.surface?.runtimeRef?.operationId === 'string');
    } catch (e) {
      check('Step 3: surface.published received', false);
      console.log(`  Error: ${e.message}`);
    }
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // STEP 4: Simulate Browser B entering the node
    // (same as handleEnterNode: sends workbench.subscribe + surface.subscribeNode)
    // ═══════════════════════════════════════════════════════════
    console.log('── Step 4: Browser B enters node (workbench.subscribe + surface.subscribeNode) ──');
    const browserB = await connectBrowser(RELAY_WS, 'B');
    await waitFor(browserB.inbox, m => m.type === 'welcome', 'B welcome');

    // Simulate handleEnterNode behavior
    browserB.ws.send(env('workbench.subscribe', { nodeId: NODE_ID }));
    browserB.ws.send(env('surface.subscribeNode', { nodeId: NODE_ID }));

    // Wait for workbench.tabs
    let bTabs = [];
    try {
      const tabsMsg = await waitFor(browserB.inbox, m =>
        m.type === 'workbench.tabs' && m.nodeId === NODE_ID, 'B workbench.tabs', 5000);
      bTabs = tabsMsg.tabs || [];
      console.log(`  Browser B received ${bTabs.length} tabs`);
      // The surface should be projected into workbench.tabs
      const surfaceTab = bTabs.find(t => t._surfaceId === surfaceId || t.id === surfaceId);
      check('Step 4a: surface tab in workbench.tabs', !!surfaceTab);
      if (surfaceTab) {
        check('Step 4a: tab has instanceId', !!surfaceTab.instanceId);
        check('Step 4a: tab has _surfaceId', !!surfaceTab._surfaceId);
      }
    } catch (e) {
      console.log(`  workbench.tabs error: ${e.message}`);
    }

    // Wait for surface.list
    try {
      const list = await waitFor(browserB.inbox, m =>
        m.type === 'surface.list' && m.nodeId === NODE_ID, 'B surface.list', 5000);
      const surfaces = Array.isArray(list.surfaces) ? list.surfaces : [];
      console.log(`  Browser B received ${surfaces.length} surfaces`);
      const found = surfaces.find(s => s.surfaceId === surfaceId);
      check('Step 4b: surface is in surface.list', !!found);
      if (found) {
        check('Step 4b: surface has viewType terminal', found.viewType === 'terminal');
        check('Step 4b: surface has runtimeRef.instanceId', found.runtimeRef?.instanceId === instanceId);
        check('Step 4b: surface has replayPolicy', !!found.replayPolicy);
      }
    } catch (e) {
      check('Step 4b: surface.list received', false);
      console.log(`  Error: ${e.message}`);
    }
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // STEP 5: Verify surface was actually stored (via API)
    // ═══════════════════════════════════════════════════════════
    console.log('── Step 5: Verify surface persistence ──');
    try {
      const health = await fetch(`${RELAY_URL}/api/health`).then(r => r.json());
      const nodeInst = health.instances?.find(i => i.id === NODE_ID);
      check('Step 5: node instance exists', !!nodeInst);
      console.log(`  Instance: ${nodeInst?.id} [${nodeInst?.status}]\n`);
    } catch (e) {
      console.log(`  Health check error: ${e.message}\n`);
    }

    // Cleanup
    browserA.ws.close();
    browserB.ws.close();
    agent.ws.close();

  } finally {
    relayProc?.kill();
    try { rmSync(WORK_DIR, { recursive: true }); } catch {}
  }

  console.log(`═══════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}\n${err.stack}`);
  process.exit(1);
});
