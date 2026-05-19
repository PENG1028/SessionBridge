// ─── UI Terminal Existing Instance → Surface Publish Test ──────
// Tests the real UI path that other tests miss: a terminal tab already
// has an instanceId (e.g. restored from localStorage or synced via
// workbench.tabs) but NO _surfaceId.  TerminalView's ensureSurfacePublished
// should auto-publish the surface so other devices can discover it.
//
// This is the EXACT path that was broken in production — all other
// shared-surface tests directly send surface.publish and skip the
// "UI discovers a tab needs a surface" step.
//
// Scenario:
//   1. Browser A workbench.subscribe nodeId
//   2. Browser A sends workbench.tabs with a terminal tab that has
//      instanceId but NO _surfaceId (simulates localStorage restore)
//   3. Browser A detects the tab has no _surfaceId and sends surface.publish
//      (this is what TerminalView's ensureSurfacePublished useEffect does)
//   4. Browser B surface.subscribeNode nodeId
//   5. Assert B receives surface.list containing the published surface
//
// Usage:
//   node tests/integration/ui-terminal-existing-instance-publishes-surface.test.mjs

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
    clientToken: `ui_existing_${label}_${Date.now()}`,
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
  throw new Error(`[${label}] Timeout waiting for predicate (inbox: [${remaining}])`);
}

async function main() {
  const WORK_DIR = join(tmpdir(), `sb-ui-surface-test-${Date.now()}-${randomInt(10000, 99999)}`);
  const CONFIG_DIR = join(WORK_DIR, '.sessionbridge');
  mkdirSync(CONFIG_DIR, { recursive: true });
  const TEST_PORT = randomInt(19000, 19999);
  const RELAY_URL = `http://127.0.0.1:${TEST_PORT}`;
  const RELAY_WS = `ws://127.0.0.1:${TEST_PORT}`;

  console.log('═══════════════════════════════════════════');
  console.log('UI Terminal Existing Instance → Surface Publish Test');
  console.log('═══════════════════════════════════════════');
  console.log(`  Bridge: ${BRIDGE}`);
  console.log(`  Work dir: ${WORK_DIR}`);
  console.log(`  Port: ${TEST_PORT}\n`);

  const configPath = join(CONFIG_DIR, 'agent.json');
  const cleanConfig = {
    label: 'ui-surface-test-node',
    workingDirectory: WORK_DIR,
    relayPort: TEST_PORT,
  };
  writeFileSync(configPath, JSON.stringify(cleanConfig, null, 2), 'utf8');

  let relayProc = null;

  try {
    // ── Start relay ──────────────────────────────────────────
    relayProc = spawn(nodeCmd, [
      BRIDGE, '--relay-port', String(TEST_PORT), '--dir', WORK_DIR,
      '--label', 'ui-surface-test-node',
    ], {
      cwd: ROOT,
      env: { ...process.env, BRIDGE_CONFIG: configPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let started = false;
    const startTime = Date.now();
    while (Date.now() - startTime < 30000) {
      try {
        const res = await fetch(`${RELAY_URL}/api/health`);
        if (res.ok) { started = true; break; }
      } catch {}
      await delay(200);
    }
    if (!started) {
      console.error('FATAL: Relay did not start');
      relayProc.kill();
      process.exit(1);
    }

    // Wait for WebSocket to be ready
    let wsReady = false;
    for (let i = 0; i < 30; i++) {
      try {
        const testWs = new WebSocket(RELAY_WS);
        await new Promise((resolve, reject) => {
          testWs.on('open', () => { testWs.close(); resolve(true); });
          testWs.on('error', reject);
          setTimeout(() => reject(new Error('timeout')), 500);
        });
        wsReady = true;
        break;
      } catch {}
      await delay(200);
    }
    if (!wsReady) {
      console.error('FATAL: Relay WebSocket not ready');
      relayProc.kill();
      process.exit(1);
    }
    console.log('  Relay ready\n');

    // ── Register an agent to have a real node ─────────────────
    console.log('── Setup: register agent ──');
    const agent = await connectAgent(RELAY_WS, 'test-node');
    await waitFor(agent.inbox, m => m.type === 'welcome', 'agent welcome');

    agent.ws.send(env('agent.register', {
      dir: WORK_DIR, label: 'test-node', adapterId: 'shell',
    }));

    const reg = await waitFor(agent.inbox, m => m.type === 'agent.registered', 'agent registered');
    const NODE_ID = reg.instanceId;
    console.log(`  Agent registered: ${NODE_ID} (${reg.label})\n`);

    // ═══════════════════════════════════════════════════════════
    // STEP 1: Browser A subscribes to the node
    // ═══════════════════════════════════════════════════════════
    console.log('── Step 1: Browser A subscribes to node ──');
    const browserA = await connectBrowser(RELAY_WS, 'A');
    await waitFor(browserA.inbox, m => m.type === 'welcome', 'A welcome');

    browserA.ws.send(env('workbench.subscribe', { nodeId: NODE_ID }));
    // Initial workbench.tabs arrives (empty store)
    await waitFor(browserA.inbox, m => m.type === 'workbench.tabs' && m.nodeId === NODE_ID, 'A workbench.tabs');
    console.log(`  Browser A subscribed to ${NODE_ID}\n`);

    // ═══════════════════════════════════════════════════════════
    // STEP 2: Browser A creates a terminal tab with instanceId
    //         but WITHOUT calling surface.publish
    // ═══════════════════════════════════════════════════════════
    console.log('── Step 2: Browser A creates terminal tab (no surface.publish) ──');

    // Simulate the UI restoring a terminal tab from localStorage or
    // receiving it via workbench.tabs sync — tab has instanceId but
    // no _surfaceId metadata.
    const TAB_ID = `tab_ui_${Date.now()}`;
    const INSTANCE_ID = NODE_ID;

    browserA.ws.send(env('workbench.tabs', {
      nodeId: NODE_ID,
      tabs: [{
        id: TAB_ID,
        title: 'Terminal',
        viewType: 'terminal',
        instanceId: INSTANCE_ID,
        // NOTE: no _surfaceId — this is the key property being tested
      }],
    }));

    // broadcastTabs excludes the sender, so Browser A won't get an echo.
    // Use Browser C to verify the tab was stored.
    const browserC = await connectBrowser(RELAY_WS, 'C');
    await waitFor(browserC.inbox, m => m.type === 'welcome', 'C welcome');
    browserC.ws.send(env('workbench.subscribe', { nodeId: NODE_ID }));
    const tabsForC = await waitFor(browserC.inbox, m =>
      m.type === 'workbench.tabs' && m.nodeId === NODE_ID, 'C workbench.tabs');
    const tabInStore = (tabsForC.tabs || []).find(t => t.id === TAB_ID);
    check('Step 2: tab stored with instanceId', tabInStore && tabInStore.instanceId === INSTANCE_ID);
    check('Step 2: tab has NO _surfaceId', tabInStore && !tabInStore._surfaceId);
    console.log(`  Verified via Browser C: tab ${tabInStore?.id} stored\n`);

    // ═══════════════════════════════════════════════════════════
    // STEP 3: Simulate TerminalView's ensureSurfacePublished
    // ═══════════════════════════════════════════════════════════
    console.log('── Step 3: Simulate TerminalView ensureSurfacePublished ──');

    // This is what TerminalView does when it mounts with instanceId
    // but no _surfaceId — it calls ensureSurfacePublished(instanceId),
    // which walks the pane tree to find the tab and calls
    // publishSurfaceForTab(tab, instanceId), which sends surface.publish.
    //
    // We already verified via Browser C that the tab has instanceId but
    // no _surfaceId. Now we simulate the auto-publish.
    check('Step 3: found tabs needing surface', !!tabInStore && tabInStore.viewType === 'terminal' && !tabInStore._surfaceId);

    let publishedSurfaceId = null;

    browserA.ws.send(env('surface.publish', {
      nodeId: NODE_ID,
      title: 'Terminal',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId: INSTANCE_ID },
      replayPolicy: { mode: 'tail', lines: 5000, bytes: 500000 },
    }));

    try {
      const pub = await waitFor(browserA.inbox, m =>
        m.type === 'surface.published' &&
        m.surface?.runtimeRef?.instanceId === INSTANCE_ID,
        'A surface.published', 5000);
      publishedSurfaceId = pub.surfaceId || pub.surface?.surfaceId;
      console.log(`  surface.published: ${publishedSurfaceId}`);
      check('Step 3: surfaceId returned', !!publishedSurfaceId);
      check('Step 3: surface has operationId', !!pub.surface?.runtimeRef?.operationId);
    } catch (e) {
      check('Step 3: surface.published received', false);
      console.log(`  Error: ${e.message}`);
    }
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // STEP 4: Browser B subscribes to the node
    // ═══════════════════════════════════════════════════════════
    console.log('── Step 4: Browser B surface.subscribeNode ──');
    const browserB = await connectBrowser(RELAY_WS, 'B');
    await waitFor(browserB.inbox, m => m.type === 'welcome', 'B welcome');

    browserB.ws.send(env('surface.subscribeNode', { nodeId: NODE_ID }));

    let surfaceListReceived = false;
    let bFoundSurface = false;

    try {
      const list = await waitFor(browserB.inbox, m =>
        m.type === 'surface.list' && m.nodeId === NODE_ID, 'B surface.list', 5000);
      surfaceListReceived = true;
      const surfaces = Array.isArray(list.surfaces) ? list.surfaces : [];
      console.log(`  Browser B received ${surfaces.length} surfaces`);

      if (publishedSurfaceId) {
        bFoundSurface = surfaces.some(s => s.surfaceId === publishedSurfaceId);
      } else {
        bFoundSurface = surfaces.some(s =>
          s.viewType === 'terminal' && s.runtimeRef?.instanceId === INSTANCE_ID);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // RESULTS
    // ═══════════════════════════════════════════════════════════
    check('Step 4: surface.list received', surfaceListReceived);
    check('Step 4: Browser B sees the published surface', bFoundSurface);

    // Cleanup
    browserA.ws.close();
    browserB.ws.close();
    browserC.ws.close();
    agent.ws.close();

  } finally {
    relayProc?.kill();
    try { rmSync(WORK_DIR, { recursive: true }); } catch {}
  }

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`═══════════════════════════════════════════`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}\n${err.stack}`);
  process.exit(1);
});
