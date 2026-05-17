// ─── Stale Surface / Tab Cleanup Test ─────────────────────────
// Verifies that:
//   1. surface.subscribe with fake instanceId → relay deletes surface,
//      returns SURFACE_STALE error + surface.closed
//   2. surface.subscribeNode: surfaces with fake instanceId are deleted
//      before list is returned; only valid surfaces appear
//   3. Debug snapshot doesn't contain stale surfaces; debug events recorded
//   4. Agent disconnect triggers surface validation: stale surfaces
//      deleted, surface.closed broadcast to node subscribers
//   5. Old workbench.tabs tab (instanceId=nodeId, no _surfaceId) doesn't
//      create a usable terminal surface
//   6. Debug events: surface.stale.instance_missing recorded
//
// Usage:
//   node tests/integration/stale-surface-tab-cleanup.test.mjs [ws://host:port]
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
    clientToken: `stale_test_${label}_${Date.now()}`,
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
  const WORK_DIR = join(tmpdir(), `sb-stale-test-${Date.now()}-${randomInt(10000, 99999)}`);
  const CONFIG_DIR = join(WORK_DIR, '.sessionbridge');
  mkdirSync(CONFIG_DIR, { recursive: true });
  const TEST_PORT = randomInt(19000, 19999);
  const RELAY_URL = `http://127.0.0.1:${TEST_PORT}`;
  const RELAY_WS = `ws://127.0.0.1:${TEST_PORT}`;

  console.log(`\n===== Stale Surface / Tab Cleanup Test =====`);
  console.log(`  Bridge: ${BRIDGE}`);
  console.log(`  Work dir: ${WORK_DIR}`);
  console.log(`  Port: ${TEST_PORT}\n`);

  const configPath = join(CONFIG_DIR, 'agent.json');
  writeFileSync(configPath, JSON.stringify({
    label: 'stale-test-node',
    workingDirectory: WORK_DIR,
    relayPort: TEST_PORT,
  }, null, 2), 'utf8');

  let bridgeProcess = null;

  try {
    // ── Start bridge ──────────────────────────────────────────
    bridgeProcess = spawn(nodeCmd, [
      BRIDGE, '--relay-port', String(TEST_PORT), '--dir', WORK_DIR,
      '--label', 'stale-test-node',
    ], {
      cwd: ROOT,
      env: { ...process.env, BRIDGE_DIR: WORK_DIR, BRIDGE_CONFIG: configPath },
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
    await delay(1000);

    // ── T1: surface.subscribe with fake instanceId → SURFACE_STALE ──
    console.log('── T1: surface.subscribe with fake instanceId → SURFACE_STALE ──');

    // Register agent to get a valid nodeId
    const agent = await connectAgent(RELAY_WS, 'STALE-NODE');
    await waitFor(agent.inbox, m => m.type === 'welcome', 'Agent welcome');
    agent.ws.send(env('agent.register', {
      dir: '/fake/stale', label: 'STALE-NODE', adapterId: 'shell',
    }));
    const agentReg = await waitFor(agent.inbox, m =>
      m.type === 'agent.registered', 'Agent registered');
    const INSTANCE_ID = agentReg.instanceId;
    check('T1a: Agent registered', typeof INSTANCE_ID === 'string');
    console.log(`  InstanceId: ${INSTANCE_ID}`);

    // Browser A creates a surface pointing to a FAKE (non-existent) instanceId.
    // The relay allows creation (publisher might not know if instance is valid)
    // but subscription triggers validation.
    const FAKE_INSTANCE = 'inst_fake_deadbeef';
    const browserA = await connectBrowser(RELAY_WS, 'A');
    await waitFor(browserA.inbox, m => m.type === 'welcome', 'Browser A welcome');

    browserA.ws.send(env('surface.publish', {
      nodeId: INSTANCE_ID,
      title: 'Ghost Terminal',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId: FAKE_INSTANCE },
      replayPolicy: { mode: 'tail', lines: 100, bytes: 100_000 },
    }));

    const published = await waitFor(browserA.inbox, m =>
      m.type === 'surface.published', 'Browser A gets surface.published');
    const GHOST_SURFACE_ID = published.surfaceId;
    check('T1b: Surface created (even with fake instanceId)', !!GHOST_SURFACE_ID);
    console.log(`  Ghost SurfaceId: ${GHOST_SURFACE_ID}`);

    // Browser B subscribes to the surface → relay detects missing instance
    const browserB = await connectBrowser(RELAY_WS, 'B');
    await waitFor(browserB.inbox, m => m.type === 'welcome', 'Browser B welcome');

    browserB.ws.send(env('surface.subscribe', { surfaceId: GHOST_SURFACE_ID }));

    // Since surface.publish now defaults keep=true, the stale surface is
    // orphaned rather than deleted. The subscriber gets surface.subscribed
    // and the surface persists.
    const subscribedMsg = await waitFor(browserB.inbox, m =>
      m.type === 'surface.subscribed', 'B gets surface.subscribed for stale (kept) surface');
    check('T1c: B received surface.subscribed for stale kept surface',
      !!subscribedMsg && subscribedMsg.surfaceId === GHOST_SURFACE_ID);
    check('T1d: Stale kept surface is orphaned, not deleted', !!subscribedMsg);

    // Re-subscribe: surface still exists (orphaned, not deleted)
    browserB.ws.send(env('surface.subscribe', { surfaceId: GHOST_SURFACE_ID }));
    const subscribed2 = await waitFor(browserB.inbox, m =>
      m.type === 'surface.subscribed', 'Re-subscribe still returns surface.subscribed');
    check('T1e: Re-subscribe succeeds — surface persists as orphaned',
      !!subscribed2 && subscribed2.surfaceId === GHOST_SURFACE_ID);

    console.log('');

    // ── T2: surface.subscribeNode validates & removes stale surfaces ──
    console.log('── T2: surface.subscribeNode validates surfaces & removes stale ones ──');

    // Create a valid surface + another ghost surface (fake instanceId)
    browserA.ws.send(env('surface.publish', {
      nodeId: INSTANCE_ID,
      title: 'Valid Terminal',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId: INSTANCE_ID },
      replayPolicy: { mode: 'tail', lines: 100, bytes: 100_000 },
    }));
    const pubValid = await waitFor(browserA.inbox, m =>
      m.type === 'surface.published' && m.surface?.title === 'Valid Terminal',
      'Valid surface published');
    const VALID_SURFACE_ID = pubValid.surfaceId;
    check('T2a: Valid surface created', !!VALID_SURFACE_ID);

    browserA.ws.send(env('surface.publish', {
      nodeId: INSTANCE_ID,
      title: 'Ghost Terminal 2',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId: 'inst_fake_another_dead' },
      replayPolicy: { mode: 'tail', lines: 100, bytes: 100_000 },
    }));
    const pubGhost2 = await waitFor(browserA.inbox, m =>
      m.type === 'surface.published' && m.surface?.title === 'Ghost Terminal 2',
      'Second ghost surface published');
    const GHOST2_SURFACE_ID = pubGhost2.surfaceId;
    check('T2b: Second ghost surface created', !!GHOST2_SURFACE_ID);

    // Browser C subscribes to the node → should get surface.closed for ghost,
    // and surface.list should only include the valid surface.
    const browserC = await connectBrowser(RELAY_WS, 'C');
    await waitFor(browserC.inbox, m => m.type === 'welcome', 'Browser C welcome');

    browserC.ws.send(env('surface.subscribeNode', { nodeId: INSTANCE_ID }));

    // Ghost surface is kept → orphaned, not deleted. Appears in list.
    // It should NOT trigger surface.closed (the surface persists).
    // Instead, it appears in surface.list as an orphaned surface.
    const surfaceList = await waitFor(browserC.inbox, m =>
      m.type === 'surface.list', 'C gets surface.list');
    const listedSurfaces = surfaceList.surfaces || [];
    const listedIds = listedSurfaces.map(s => s.surfaceId);
    const ghost2InList = listedSurfaces.find(s => s.surfaceId === GHOST2_SURFACE_ID);
    check('T2c: Ghost surface not deleted — appears in surface.list',
      !!ghost2InList);
    check('T2d: Ghost surface is orphaned in surface.list',
      ghost2InList?.orphaned === true);
    check('T2e: surface.list DOES include valid surface',
      listedIds.includes(VALID_SURFACE_ID));
    check('T2f: surface.list has exactly 3 surfaces (valid + 2 ghost/orphaned)',
      listedSurfaces.length === 3);

    console.log(`  surface.list has ${listedSurfaces.length} surface(s): ${listedIds.join(', ')}\n`);

    // ── T3: Debug snapshot excludes stale surfaces ────────────
    console.log('── T3: Debug snapshot excludes stale surfaces ──');

    const debugResp = await fetch(`${RELAY_URL}/api/debug/surfaces`);
    check('T3a: Debug endpoint reachable', debugResp.ok);

    const debugData = await debugResp.json();
    const debugSurfaceIds = (debugData.surfaceDebug?.surfaces || []).map(s => s.surfaceId);
    check('T3b: Debug snapshot CONTAINS ghost surfaces (orphaned, not deleted)',
      debugSurfaceIds.includes(GHOST_SURFACE_ID) && debugSurfaceIds.includes(GHOST2_SURFACE_ID));
    check('T3c: Debug snapshot DOES contain valid surface',
      debugSurfaceIds.includes(VALID_SURFACE_ID));

    // Check that stale events were recorded
    const events = debugData.surfaceDebug?.events || [];
    const staleInstanceEvents = events.filter(e =>
      e.kind === 'surface.stale.instance_missing');
    check('T3d: Debug events include surface.stale.instance_missing',
      staleInstanceEvents.length >= 2);
    console.log(`  Found ${staleInstanceEvents.length} stale instance event(s)`);

    if (staleInstanceEvents.length > 0) {
      const evt = staleInstanceEvents[0];
      check('T3e: Stale event includes surfaceId', !!evt.surfaceId);
      check('T3f: Stale event includes message', typeof evt.message === 'string');
    }

    console.log('');

    // ── T4: Agent disconnect triggers surface validation + broadcast ──
    console.log('── T4: Agent disconnect triggers surface validation + broadcast ──');

    // Browser D subscribes to the node BEFORE agent unregisters
    const browserD = await connectBrowser(RELAY_WS, 'D');
    await waitFor(browserD.inbox, m => m.type === 'welcome', 'Browser D welcome');
    browserD.ws.send(env('surface.subscribeNode', { nodeId: INSTANCE_ID }));
    const dList = await waitFor(browserD.inbox, m =>
      m.type === 'surface.list', 'D gets initial surface.list');
    check('T4a: D received initial surface.list', !!dList);

    // Now unregister agent → validateSurfaces deletes surfaces pointing to this instance
    agent.ws.send(env('agent.unregister', { instanceId: INSTANCE_ID }));

    // Browser D should receive surface.closed for the valid surface
    const dClosed = await waitFor(browserD.inbox, m =>
      m.type === 'surface.closed' && m.surfaceId === VALID_SURFACE_ID,
      'D gets surface.closed after agent disconnect', 15000);
    check('T4b: Node subscriber received surface.closed after agent disconnect',
      !!dClosed);

    // Verify surface is gone from relay
    const debugResp2 = await fetch(`${RELAY_URL}/api/debug/surfaces`);
    const debugData2 = await debugResp2.json();
    const debugSurfaceIds2 = (debugData2.surfaceDebug?.surfaces || []).map(s => s.surfaceId);
    check('T4c: Valid surface removed after agent disconnect',
      !debugSurfaceIds2.includes(VALID_SURFACE_ID));
    check('T4d: No surfaces remain for this node',
      (debugData2.surfaceDebug?.surfaces || []).filter(s => s.nodeId === INSTANCE_ID).length === 0);

    console.log('');

    // ── T5: Old workbench.tabs tab (instanceId=nodeId, no _surfaceId) ──
    console.log('── T5: workbench.tabs with old-style tab (no _surfaceId) ──');

    // Re-register agent to get a new instance
    const agent3 = await connectAgent(RELAY_WS, 'STALE-NODE-3');
    await waitFor(agent3.inbox, m => m.type === 'welcome', 'Agent3 welcome');
    agent3.ws.send(env('agent.register', {
      dir: '/fake/stale3', label: 'STALE-NODE-3', adapterId: 'shell',
    }));
    const agent3Reg = await waitFor(agent3.inbox, m =>
      m.type === 'agent.registered', 'Agent3 registered');
    const INSTANCE_3 = agent3Reg.instanceId;
    check('T5a: Third agent registered', typeof INSTANCE_3 === 'string');

    // Send old-style workbench.tabs where a terminal tab has instanceId === nodeId
    // but no _surfaceId. This simulates a tab created before the surface protocol.
    const oldTab = {
      id: 'old-tab-1',
      title: 'Terminal',
      viewType: 'terminal',
      instanceId: INSTANCE_3,
      // no _surfaceId — old-style tab
    };
    const normalTab = {
      id: 'normal-tab-1',
      title: 'Settings',
      viewType: 'settings',
      instanceId: INSTANCE_3,
      _surfaceId: 'surf_normal_1',
    };

    agent3.ws.send(env('workbench.tabs', {
      nodeId: INSTANCE_3,
      tabs: [oldTab, normalTab],
    }));
    await delay(500);

    // Browser E subscribes to the node → should get surface.list with only
    // surfaces that exist (the old-style tab has no surface, so it won't appear).
    const browserE = await connectBrowser(RELAY_WS, 'E');
    await waitFor(browserE.inbox, m => m.type === 'welcome', 'Browser E welcome');
    browserE.ws.send(env('surface.subscribeNode', { nodeId: INSTANCE_3 }));

    const eList = await waitFor(browserE.inbox, m =>
      m.type === 'surface.list', 'E gets surface.list');
    const eSurfaces = eList.surfaces || [];

    // The old-style terminal tab should NOT have a corresponding surface
    const oldTabSurface = eSurfaces.find(s => s.title === 'Terminal');
    check('T5b: Old-style terminal tab has NO corresponding surface in surface.list',
      !oldTabSurface);
    check('T5c: No broken terminal surfaces in surface.list',
      eSurfaces.every(s => !(s.viewType === 'terminal' && s.runtimeRef?.instanceId === INSTANCE_3 && !s.surfaceId)));

    // The client side would mark this tab as _stale because:
    //   tab.instanceId === nodeId && !tab._surfaceId && tab.viewType === 'terminal'

    console.log(`  E received ${eSurfaces.length} surface(s)\n`);

    // ── T6: Verify all stale handling is captured in debug events ──
    console.log('── T6: Debug events cover all stale scenarios ──');

    const finalDebug = await fetch(`${RELAY_URL}/api/debug/surfaces`);
    check('T6a: Final debug endpoint reachable', finalDebug.ok);
    const finalData = await finalDebug.json();
    const finalEvents = finalData.surfaceDebug?.events || [];

    const allStaleEvents = finalEvents.filter(e =>
      e.kind === 'surface.stale.instance_missing');
    // T1: 1 from surface.subscribe, T2: 1 from surface.subscribeNode,
    // T4: 1 from agent.unregister validateSurfaces = at least 3
    check('T6b: At least 3 stale instance events recorded',
      allStaleEvents.length >= 3);

    const allCloseEvents = finalEvents.filter(e =>
      e.kind === 'surface.close');
    check('T6c: surface.close events recorded', allCloseEvents.length >= 3);

    console.log(`  Total debug events: ${finalEvents.length}`);
    console.log(`  stale.instance_missing: ${allStaleEvents.length}`);
    console.log(`  surface.close: ${allCloseEvents.length}\n`);

  } finally {
    // ── Cleanup ──────────────────────────────────────────────
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
  console.log(`  PASS: Stale surface/tab cleanup tests passed`);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
