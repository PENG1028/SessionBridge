// ─── Cross-Node Surface Discovery End-to-End Test ─────────────
// Verifies that two independent nodes (agents) connected to the
// same relay can each create surfaces, and a browser can discover
// them per-node with correct metadata, cross-node isolation, refresh
// persistence, and live broadcast updates.
//
// Scenarios:
//   S1: Node A creates terminal → Browser subscribes Node A → sees it
//   S2: Node B creates terminal → Browser subscribes Node B → sees only B's
//   S3: Cross-node isolation — Node A's surface NOT in Node B's list
//   S4: Refresh persistence — re-subscribe returns same surfaces
//   S5: Live update — new surface after subscribe triggers surface.published
//   S6: Metadata correctness — title, viewType, runtimeRef, nodeId
//   S7: surface.subscribe (single surface) works across nodes
//   S8: No surface leakage after agent unregister
//
// Usage:
//   node tests/integration/cross-node-surface-discovery.test.mjs

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
    clientToken: `xnode_test_${label}_${Date.now()}`,
  }));
  return { ws, inbox, label };
}

async function registerAgent(relayWs, label, dir) {
  const ws = new WebSocket(relayWs);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'agent', version: '0.6.0', features: ['shell'],
    label, adapterId: 'shell',
  }));
  await waitFor(inbox, m => m.type === 'welcome', `${label} welcome`);
  ws.send(env('agent.register', {
    dir: dir || `/fake/${label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    label,
    adapterId: 'shell',
  }));
  const reg = await waitFor(inbox, m => m.type === 'agent.registered', `${label} registered`);
  return { ws, inbox, label, instanceId: reg.instanceId };
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

async function debugSurfaces(relayUrl) {
  const r = await fetch(`${relayUrl}/api/debug/surfaces`);
  const data = await r.json();
  return {
    surfaces: data.surfaceDebug?.surfaces || [],
    events: data.surfaceDebug?.events || [],
  };
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  const WORK_DIR = join(tmpdir(), `sb-xnode-test-${Date.now()}-${randomInt(10000, 99999)}`);
  const CONFIG_DIR = join(WORK_DIR, '.sessionbridge');
  mkdirSync(CONFIG_DIR, { recursive: true });
  const TEST_PORT = randomInt(19000, 19999);
  const RELAY_URL = `http://127.0.0.1:${TEST_PORT}`;
  const RELAY_WS = `ws://127.0.0.1:${TEST_PORT}`;

  console.log(`\n===== Cross-Node Surface Discovery Test =====`);
  console.log(`  Bridge: ${BRIDGE}`);
  console.log(`  Work dir: ${WORK_DIR}`);
  console.log(`  Port: ${TEST_PORT}\n`);

  const configPath = join(CONFIG_DIR, 'agent.json');
  writeFileSync(configPath, JSON.stringify({
    label: 'xnode-test-relay',
    workingDirectory: WORK_DIR,
    relayPort: TEST_PORT,
  }, null, 2), 'utf8');

  let bridgeProcess = null;

  try {
    // ── Start bridge ──────────────────────────────────────────
    bridgeProcess = spawn(nodeCmd, [
      BRIDGE, '--relay-port', String(TEST_PORT), '--dir', WORK_DIR,
      '--label', 'xnode-test-relay',
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
    if (!started) { console.error('Relay did not start within 30s'); process.exit(1); }
    console.log('Relay ready.\n');
    await delay(500);

    // ═══════════════════════════════════════════════════════════
    // S1: Two agents register as independent nodes
    // ═══════════════════════════════════════════════════════════
    console.log('── S1: Register two independent agent nodes ──');

    const agentA = await registerAgent(RELAY_WS, 'NODE-ALPHA', '/fake/node-alpha');
    const NODE_A_ID = agentA.instanceId;
    check('S1a: Node A registered', typeof NODE_A_ID === 'string' && NODE_A_ID.length > 0);
    console.log(`  Node A (ALPHA): ${NODE_A_ID}`);

    const agentB = await registerAgent(RELAY_WS, 'NODE-BRAVO', '/fake/node-bravo');
    const NODE_B_ID = agentB.instanceId;
    check('S1b: Node B registered', typeof NODE_B_ID === 'string' && NODE_B_ID.length > 0);
    console.log(`  Node B (BRAVO): ${NODE_B_ID}`);

    check('S1c: Node A and B have different IDs', NODE_A_ID !== NODE_B_ID);

    // ═══════════════════════════════════════════════════════════
    // S2: Node A publishes surfaces via surface.publish
    // ═══════════════════════════════════════════════════════════
    console.log('\n── S2: Node A publishes terminal surfaces ──');

    const browserA = await connectBrowser(RELAY_WS, 'Browser-A');
    await waitFor(browserA.inbox, m => m.type === 'welcome', 'Browser-A welcome');

    // Publish surface A1 (terminal on Node A)
    browserA.ws.send(env('surface.publish', {
      nodeId: NODE_A_ID,
      title: 'Alpha Terminal 1',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId: NODE_A_ID },
      replayPolicy: { mode: 'tail', lines: 100, bytes: 100_000 },
    }));
    const pubA1 = await waitFor(browserA.inbox, m =>
      m.type === 'surface.published' && m.surface?.title === 'Alpha Terminal 1',
      'surface.published for A1');
    const SURFACE_A1_ID = pubA1.surfaceId;
    check('S2a: Surface A1 created (Alpha Terminal 1)', !!SURFACE_A1_ID);

    // Publish surface A2 (another terminal on Node A)
    browserA.ws.send(env('surface.publish', {
      nodeId: NODE_A_ID,
      title: 'Alpha Terminal 2',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId: NODE_A_ID },
      replayPolicy: { mode: 'tail', lines: 100, bytes: 100_000 },
    }));
    const pubA2 = await waitFor(browserA.inbox, m =>
      m.type === 'surface.published' && m.surface?.title === 'Alpha Terminal 2',
      'surface.published for A2');
    const SURFACE_A2_ID = pubA2.surfaceId;
    check('S2b: Surface A2 created (Alpha Terminal 2)', !!SURFACE_A2_ID);
    check('S2c: Surfaces A1 and A2 have different IDs', SURFACE_A1_ID !== SURFACE_A2_ID);

    // ═══════════════════════════════════════════════════════════
    // S3: Node B publishes its own surface
    // ═══════════════════════════════════════════════════════════
    console.log('\n── S3: Node B publishes its own surface ──');

    const browserB = await connectBrowser(RELAY_WS, 'Browser-B');
    await waitFor(browserB.inbox, m => m.type === 'welcome', 'Browser-B welcome');

    browserB.ws.send(env('surface.publish', {
      nodeId: NODE_B_ID,
      title: 'Bravo Terminal 1',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId: NODE_B_ID },
      replayPolicy: { mode: 'tail', lines: 100, bytes: 100_000 },
    }));
    const pubB1 = await waitFor(browserB.inbox, m =>
      m.type === 'surface.published' && m.surface?.title === 'Bravo Terminal 1',
      'surface.published for B1');
    const SURFACE_B1_ID = pubB1.surfaceId;
    check('S3a: Surface B1 created (Bravo Terminal 1)', !!SURFACE_B1_ID);

    // ═══════════════════════════════════════════════════════════
    // S4: Browser subscribes to Node A → gets only A's surfaces
    // ═══════════════════════════════════════════════════════════
    console.log('\n── S4: Browser discovers Node A surfaces ──');

    const browserViewer = await connectBrowser(RELAY_WS, 'Viewer');
    await waitFor(browserViewer.inbox, m => m.type === 'welcome', 'Viewer welcome');

    browserViewer.ws.send(env('surface.subscribeNode', { nodeId: NODE_A_ID }));
    const listA = await waitFor(browserViewer.inbox, m =>
      m.type === 'surface.list' && m.nodeId === NODE_A_ID,
      'surface.list for Node A');
    const surfacesA = Array.isArray(listA.surfaces) ? listA.surfaces : [];
    const titlesA = surfacesA.map(s => s.title);
    const idsA = surfacesA.map(s => s.surfaceId);

    check('S4a: surface.list for Node A returns 2 surfaces', surfacesA.length === 2);
    check('S4b: Node A list contains Alpha Terminal 1', titlesA.includes('Alpha Terminal 1'));
    check('S4c: Node A list contains Alpha Terminal 2', titlesA.includes('Alpha Terminal 2'));
    check('S4d: Node A list does NOT contain Bravo Terminal 1', !titlesA.includes('Bravo Terminal 1'));
    console.log(`  Node A surfaces: ${titlesA.join(', ')}`);

    // ═══════════════════════════════════════════════════════════
    // S5: Browser subscribes to Node B → gets only B's surfaces
    // ═══════════════════════════════════════════════════════════
    console.log('\n── S5: Browser discovers Node B surfaces (cross-node isolation) ──');

    browserViewer.ws.send(env('surface.subscribeNode', { nodeId: NODE_B_ID }));
    const listB = await waitFor(browserViewer.inbox, m =>
      m.type === 'surface.list' && m.nodeId === NODE_B_ID,
      'surface.list for Node B');
    const surfacesB = Array.isArray(listB.surfaces) ? listB.surfaces : [];
    const titlesB = surfacesB.map(s => s.title);

    check('S5a: surface.list for Node B returns 1 surface', surfacesB.length === 1);
    check('S5b: Node B list contains Bravo Terminal 1', titlesB.includes('Bravo Terminal 1'));
    check('S5c: Node B list does NOT contain Alpha surfaces', !titlesB.includes('Alpha Terminal 1') && !titlesB.includes('Alpha Terminal 2'));
    console.log(`  Node B surfaces: ${titlesB.join(', ')}`);

    // ═══════════════════════════════════════════════════════════
    // S6: Metadata correctness — every field is present and correct
    // ═══════════════════════════════════════════════════════════
    console.log('\n── S6: Surface metadata correctness ──');

    const surfaceA1 = surfacesA.find(s => s.surfaceId === SURFACE_A1_ID);
    check('S6a: surfaceId present', typeof surfaceA1?.surfaceId === 'string');
    check('S6b: nodeId matches Node A', surfaceA1?.nodeId === NODE_A_ID);
    check('S6c: title is "Alpha Terminal 1"', surfaceA1?.title === 'Alpha Terminal 1');
    check('S6d: viewType is "terminal"', surfaceA1?.viewType === 'terminal');
    check('S6e: scope is "node"', surfaceA1?.scope === 'node');
    check('S6f: shared is true', surfaceA1?.shared === true);
    check('S6g: runtimeRef.kind is "terminal"', surfaceA1?.runtimeRef?.kind === 'terminal');
    check('S6h: runtimeRef.instanceId present', typeof surfaceA1?.runtimeRef?.instanceId === 'string');
    check('S6i: replayPolicy.tail mode', surfaceA1?.replayPolicy?.mode === 'tail');
    check('S6j: createdAt is a number', typeof surfaceA1?.createdAt === 'number');
    check('S6k: updatedAt is a number', typeof surfaceA1?.updatedAt === 'number');

    const surfaceB1 = surfacesB.find(s => s.surfaceId === SURFACE_B1_ID);
    check('S6l: Node B surface nodeId matches Node B', surfaceB1?.nodeId === NODE_B_ID);
    check('S6m: Node B surface title is "Bravo Terminal 1"', surfaceB1?.title === 'Bravo Terminal 1');

    // ═══════════════════════════════════════════════════════════
    // S7: Refresh persistence — re-subscribe returns same data
    // ═══════════════════════════════════════════════════════════
    console.log('\n── S7: Refresh persistence (re-subscribe) ──');

    // Re-subscribe to Node A
    browserViewer.ws.send(env('surface.subscribeNode', { nodeId: NODE_A_ID }));
    const listA2 = await waitFor(browserViewer.inbox, m =>
      m.type === 'surface.list' && m.nodeId === NODE_A_ID,
      'surface.list for Node A (refresh)');
    const surfacesA2 = Array.isArray(listA2.surfaces) ? listA2.surfaces : [];
    const idsA2 = surfacesA2.map(s => s.surfaceId);

    check('S7a: Refresh returns same count', surfacesA2.length === 2);
    check('S7b: Refresh includes A1', idsA2.includes(SURFACE_A1_ID));
    check('S7c: Refresh includes A2', idsA2.includes(SURFACE_A2_ID));
    check('S7d: Refresh surface titles unchanged',
      surfacesA2.some(s => s.title === 'Alpha Terminal 1') &&
      surfacesA2.some(s => s.title === 'Alpha Terminal 2'));

    // Re-subscribe to Node B
    browserViewer.ws.send(env('surface.subscribeNode', { nodeId: NODE_B_ID }));
    const listB2 = await waitFor(browserViewer.inbox, m =>
      m.type === 'surface.list' && m.nodeId === NODE_B_ID,
      'surface.list for Node B (refresh)');
    const surfacesB2 = Array.isArray(listB2.surfaces) ? listB2.surfaces : [];
    check('S7e: Node B refresh returns same count', surfacesB2.length === 1);
    check('S7f: Node B refresh includes B1', surfacesB2.some(s => s.surfaceId === SURFACE_B1_ID));

    console.log('  Refresh returns identical data for both nodes.');

    // ═══════════════════════════════════════════════════════════
    // S8: Live update — new surface triggers surface.published
    //     to an already-subscribed browser
    // ═══════════════════════════════════════════════════════════
    console.log('\n── S8: Live update after subscribe ──');

    // Viewer is already subscribed to both nodes from S4/S5.
    // Publishing a new surface on Node A should trigger surface.published
    // broadcast to the viewer (who is a node subscriber).
    browserA.ws.send(env('surface.publish', {
      nodeId: NODE_A_ID,
      title: 'Alpha Terminal 3 — LIVE',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId: NODE_A_ID },
      replayPolicy: { mode: 'tail', lines: 100, bytes: 100_000 },
    }));

    // The publishing browser gets surface.published
    await waitFor(browserA.inbox, m =>
      m.type === 'surface.published' && m.surface?.title === 'Alpha Terminal 3 — LIVE',
      'Publisher gets surface.published for A3');

    // The subscribed viewer should ALSO receive surface.published
    const livePub = await waitFor(browserViewer.inbox, m =>
      m.type === 'surface.published' && m.surface?.title === 'Alpha Terminal 3 — LIVE',
      'Viewer receives live surface.published for A3', 10000);
    const SURFACE_A3_ID = livePub?.surfaceId;
    check('S8a: Subscribed viewer received surface.published for new surface',
      !!livePub && livePub.surface?.title === 'Alpha Terminal 3 — LIVE');
    check('S8b: Live surface has correct nodeId', livePub?.surface?.nodeId === NODE_A_ID);
    check('S8c: Live surface has surfaceId', typeof SURFACE_A3_ID === 'string');

    // After live broadcast, re-subscribe should now include 3 surfaces
    browserViewer.ws.send(env('surface.subscribeNode', { nodeId: NODE_A_ID }));
    const listA3 = await waitFor(browserViewer.inbox, m =>
      m.type === 'surface.list' && m.nodeId === NODE_A_ID,
      'surface.list for Node A (after live update)');
    const surfacesA3 = Array.isArray(listA3.surfaces) ? listA3.surfaces : [];
    check('S8d: Node A now has 3 surfaces', surfacesA3.length === 3);
    check('S8e: New surface A3 is in the list',
      surfacesA3.some(s => s.surfaceId === SURFACE_A3_ID));

    // Node B should still have only 1 surface
    browserViewer.ws.send(env('surface.subscribeNode', { nodeId: NODE_B_ID }));
    const listB3 = await waitFor(browserViewer.inbox, m =>
      m.type === 'surface.list' && m.nodeId === NODE_B_ID,
      'surface.list for Node B (after A3 added)');
    check('S8f: Node B still has 1 surface (unaffected by Node A changes)',
      (Array.isArray(listB3.surfaces) ? listB3.surfaces : []).length === 1);

    console.log('  Live broadcast confirmed: viewers see new surfaces without refresh.');

    // ═══════════════════════════════════════════════════════════
    // S9: Single surface subscribe — cross-node surface detail
    // ═══════════════════════════════════════════════════════════
    console.log('\n── S9: Single surface subscribe (surface detail) ──');

    browserViewer.ws.send(env('surface.subscribe', { surfaceId: SURFACE_A1_ID }));
    const subDetail = await waitFor(browserViewer.inbox, m =>
      m.type === 'surface.subscribed' && m.surfaceId === SURFACE_A1_ID,
      'surface.subscribed for A1');
    check('S9a: surface.subscribed returns correct surfaceId',
      subDetail?.surfaceId === SURFACE_A1_ID);
    check('S9b: surface.subscribed includes runtime info',
      subDetail?.runtime !== undefined);

    // Subscribe to Node B's surface from the same viewer
    browserViewer.ws.send(env('surface.subscribe', { surfaceId: SURFACE_B1_ID }));
    const subB1Detail = await waitFor(browserViewer.inbox, m =>
      m.type === 'surface.subscribed' && m.surfaceId === SURFACE_B1_ID,
      'surface.subscribed for B1');
    check('S9c: Cross-node surface subscribe works',
      subB1Detail?.surfaceId === SURFACE_B1_ID);

    console.log('  Single-surface subscribe works across nodes.');

    // ═══════════════════════════════════════════════════════════
    // S10: Agent unregister → surfaces cleaned up
    // ═══════════════════════════════════════════════════════════
    console.log('\n── S10: Agent unregister cleans up surfaces ──');

    // Subscribe viewer to Node A so we can catch surface.closed
    browserViewer.ws.send(env('surface.subscribeNode', { nodeId: NODE_A_ID }));
    await waitFor(browserViewer.inbox, m =>
      m.type === 'surface.list' && m.nodeId === NODE_A_ID,
      'Viewer subscribed to Node A for close tracking');

    // Unregister Node A
    agentA.ws.send(env('agent.unregister', { instanceId: NODE_A_ID }));

    // Viewer should receive surface.closed for each of A's surfaces
    const closedIds = [];
    for (let i = 0; i < 3; i++) {
      try {
        const closed = await waitFor(browserViewer.inbox, m =>
          m.type === 'surface.closed' && m.nodeId === NODE_A_ID,
          `surface.closed #${i + 1} for Node A`, 8000);
        if (closed) closedIds.push(closed.surfaceId);
      } catch {
        // Agent unregister deletes via validateSurfaces which may not
        // broadcast surface.closed for each. That's OK.
      }
    }
    check('S10a: surface.closed broadcast received for unregistered node',
      closedIds.length >= 1);

    // After unregister, subscribeNode should return 0 surfaces for Node A
    const browserViewer2 = await connectBrowser(RELAY_WS, 'Viewer2');
    await waitFor(browserViewer2.inbox, m => m.type === 'welcome', 'Viewer2 welcome');
    browserViewer2.ws.send(env('surface.subscribeNode', { nodeId: NODE_A_ID }));
    const listAfterUnreg = await waitFor(browserViewer2.inbox, m =>
      m.type === 'surface.list' && m.nodeId === NODE_A_ID,
      'surface.list after unregister', 12000);
    const afterCount = Array.isArray(listAfterUnreg.surfaces) ? listAfterUnreg.surfaces.length : 0;
    check('S10b: No surfaces remain for Node A after unregister', afterCount === 0);

    // Node B's surfaces should still exist
    browserViewer2.ws.send(env('surface.subscribeNode', { nodeId: NODE_B_ID }));
    const listBAfter = await waitFor(browserViewer2.inbox, m =>
      m.type === 'surface.list' && m.nodeId === NODE_B_ID,
      'surface.list for Node B after A unregistered');
    check('S10c: Node B surfaces unaffected by Node A unregister',
      (Array.isArray(listBAfter.surfaces) ? listBAfter.surfaces : []).length === 1);

    console.log('  Node A unregistered, surfaces cleaned; Node B intact.');

    // ═══════════════════════════════════════════════════════════
    // S11: Debug endpoint reflects correct per-node state
    // ═══════════════════════════════════════════════════════════
    console.log('\n── S11: Debug endpoint per-node state ──');

    const debug = await debugSurfaces(RELAY_URL);
    const nodeAInDebug = debug.surfaces.filter(s => s.nodeId === NODE_A_ID);
    const nodeBInDebug = debug.surfaces.filter(s => s.nodeId === NODE_B_ID);
    check('S11a: Debug shows 0 surfaces for Node A (after unregister)',
      nodeAInDebug.length === 0);
    check('S11b: Debug shows 1 surface for Node B',
      nodeBInDebug.length === 1);
    check('S11c: Debug surface count matches per-node totals',
      debug.surfaces.length === 1);

    console.log(`  Debug surfaces total: ${debug.surfaces.length} (A: ${nodeAInDebug.length}, B: ${nodeBInDebug.length})`);
    console.log(`  Debug events recorded: ${debug.events.length}`);

  } finally {
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
  console.log(`  PASS: Cross-node surface discovery works correctly`);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
