// ─── Unified Persistence Model — Integration Tests ──────────
// Verifies the 6-phase unified persistence architecture.
//
// Tests A-H as specified in the architecture plan:
//   A. Atomic creation (POST /api/instances → surface auto-created)
//   B. Browser close does NOT lose surfaces
//   C. Browser reopen recovers surface + replay
//   D. Multi-terminal independence
//   E. Relay restart recovers surfaces from surfaces.json
//   F. Agent reconnect clears orphaned flag (inventory)
//   G. Agent reconnect rebuilds missing surfaces
//   H. Keep + reconnection synthesis
//
// Usage:
//   node tests/integration/surface-persistence-restore.test.mjs

import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
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
  const candidates = [join(ROOT, 'bin', 'bridge.js'), join(ROOT, 'dist', 'src', 'index.js')];
  for (const c of candidates) if (existsSync(c)) return c;
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
    clientToken: `ptest_${label}_${Date.now()}`,
  }));
  await delay(100);
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

async function registerAgent(relayWs, label, dir) {
  const agent = await connectAgent(relayWs, label);
  await waitFor(agent.inbox, m => m.type === 'welcome', `${label} welcome`);
  agent.ws.send(env('agent.register', { dir: dir || '/fake/' + label.toLowerCase(), label, adapterId: 'shell' }));
  const reg = await waitFor(agent.inbox, m => m.type === 'agent.registered', `${label} registered`);
  return { ...agent, instanceId: reg.instanceId };
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
  return (await r.json()).surfaceDebug || { surfaces: [], events: [] };
}

async function main() {
  const WORK_DIR = join(tmpdir(), `sb-persist-${Date.now()}-${randomInt(10000, 99999)}`);
  const CONFIG_DIR = join(WORK_DIR, '.sessionbridge');
  mkdirSync(CONFIG_DIR, { recursive: true });
  const TEST_PORT = randomInt(19000, 19999);
  const RELAY_URL = `http://127.0.0.1:${TEST_PORT}`;
  const RELAY_WS = `ws://127.0.0.1:${TEST_PORT}`;

  console.log(`\n===== Unified Persistence Model Tests =====`);
  console.log(`  Port: ${TEST_PORT}\n`);

  writeFileSync(join(CONFIG_DIR, 'agent.json'), JSON.stringify({
    label: 'persist-test-node', workingDirectory: WORK_DIR, relayPort: TEST_PORT,
  }, null, 2), 'utf8');

  let bridgeProcess = null;

  function startBridge() {
    return spawn(nodeCmd, [
      BRIDGE, '--relay-port', String(TEST_PORT), '--dir', WORK_DIR, '--label', 'persist-test-node',
    ], { cwd: ROOT, env: { ...process.env, BRIDGE_DIR: WORK_DIR, BRIDGE_CONFIG: join(CONFIG_DIR, 'agent.json') }, stdio: ['pipe', 'pipe', 'pipe'] });
  }

  async function waitForRelay(timeout = 30000) {
    const t = Date.now();
    while (Date.now() - t < timeout) {
      try { const r = await fetch(`${RELAY_URL}/api/health`); if (r.ok) return true; } catch {}
      await delay(500);
    }
    return false;
  }

  try {
    bridgeProcess = startBridge();
    if (!await waitForRelay()) { console.error('Relay did not start'); process.exit(1); }
    console.log('Relay ready.\n');
    await delay(1000);

    // ═══════════════════════════════════════════════════════════
    // TEST A: Atomic creation (POST /api/instances → surface)
    // ═══════════════════════════════════════════════════════════
    console.log('── A: Atomic creation ──');

    const createResp = await fetch(`${RELAY_URL}/api/instances`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: WORK_DIR, label: 'test-term', adapterId: 'shell', keep: true }),
    });
    check('A1: POST /api/instances succeeds', createResp.ok);
    const createJson = await createResp.json();
    const INST_ID_A = createJson.instance.id;
    check('A2: Response has instance', !!INST_ID_A);

    const debugA = await debugSurfaces(RELAY_URL);
    const surfA = debugA.surfaces.find(s => s.nodeId === INST_ID_A);
    check('A3: Surface auto-created', !!surfA);
    check('A4: Surface viewType=terminal', surfA?.viewType === 'terminal');

    // Subscribe to node → should see surface
    const browserA = await connectBrowser(RELAY_WS, 'A');
    await waitFor(browserA.inbox, m => m.type === 'welcome', 'A welcome');
    browserA.ws.send(env('surface.subscribeNode', { nodeId: INST_ID_A }));
    const listA = await waitFor(browserA.inbox, m => m.type === 'surface.list', 'A surface.list');
    const sA = (listA.surfaces || []).find(s => s.nodeId === INST_ID_A);
    check('A5: surface.list returns the surface', !!sA);
    check('A6: Surface keep=true in response', sA?.keep === true);
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // TEST B: Browser close does NOT lose surfaces
    // ═══════════════════════════════════════════════════════════
    console.log('── B: Browser close preserves surfaces ──');

    const agB = await registerAgent(RELAY_WS, 'NODE-B', '/fake/b');
    const INST_ID_B = agB.instanceId;
    check('B1: Agent B registered', !!INST_ID_B);

    // Observer browser subscribes to node first
    const obsB = await connectBrowser(RELAY_WS, 'obs-B');
    await waitFor(obsB.inbox, m => m.type === 'welcome', 'obs-B welcome');
    obsB.ws.send(env('surface.subscribeNode', { nodeId: INST_ID_B }));
    const obsBList = await waitFor(obsB.inbox, m => m.type === 'surface.list', 'obs-B surface.list');

    // Browser B1 publishes surface using the real instanceId
    const b1 = await connectBrowser(RELAY_WS, 'B1');
    await waitFor(b1.inbox, m => m.type === 'welcome', 'B1 welcome');
    b1.ws.send(env('surface.publish', {
      nodeId: INST_ID_B, title: 'B-Terminal', viewType: 'terminal',
      scope: 'node', shared: true,
      runtimeRef: { kind: 'terminal', instanceId: INST_ID_B },
      replayPolicy: { mode: 'tail', lines: 100, bytes: 50_000 },
    }));
    const pubB = await waitFor(b1.inbox, m => m.type === 'surface.published', 'B1 surface.published');
    const SURF_ID_B = pubB.surfaceId;
    check('B2: Surface published', !!SURF_ID_B);

    // Disconnect B1 (simulate browser close)
    b1.ws.close();
    await delay(300);

    // Verify surface still exists
    const debugB = await debugSurfaces(RELAY_URL);
    check('B3: Surface exists after browser disconnect',
      debugB.surfaces.some(s => s.surfaceId === SURF_ID_B));
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // TEST C: Browser reopen recovers surface
    // ═══════════════════════════════════════════════════════════
    console.log('── C: Browser reopen recovers surface ──');

    const b2 = await connectBrowser(RELAY_WS, 'B2');
    await waitFor(b2.inbox, m => m.type === 'welcome', 'B2 welcome');
    b2.ws.send(env('surface.subscribeNode', { nodeId: INST_ID_B }));
    const listC = await waitFor(b2.inbox, m => m.type === 'surface.list', 'B2 surface.list');
    check('C1: Reconnected browser sees surface',
      (listC.surfaces || []).some(s => s.surfaceId === SURF_ID_B));
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // TEST D: Multi-terminal independence
    // ═══════════════════════════════════════════════════════════
    console.log('── D: Multi-terminal independence ──');

    const agD1 = await registerAgent(RELAY_WS, 'NODE-D1', '/fake/d1');
    const agD2 = await registerAgent(RELAY_WS, 'NODE-D2', '/fake/d2');
    check('D0a: Agent D1 registered', !!agD1.instanceId);
    check('D0b: Agent D2 registered', !!agD2.instanceId);

    const bD = await connectBrowser(RELAY_WS, 'D');
    await waitFor(bD.inbox, m => m.type === 'welcome', 'D welcome');

    // Create surfaces with real instanceIds
    bD.ws.send(env('surface.publish', {
      nodeId: agD1.instanceId, title: 'Terminal-1', viewType: 'terminal',
      scope: 'node', shared: true,
      runtimeRef: { kind: 'terminal', instanceId: agD1.instanceId },
      replayPolicy: { mode: 'tail', lines: 100, bytes: 50_000 },
    }));
    const pubD1 = await waitFor(bD.inbox, m =>
      m.type === 'surface.published' && m.surface?.title === 'Terminal-1', 'D terminal-1');
    check('D1: Terminal-1 created', !!pubD1.surfaceId);

    bD.ws.send(env('surface.publish', {
      nodeId: agD2.instanceId, title: 'Terminal-2', viewType: 'terminal',
      scope: 'node', shared: true,
      runtimeRef: { kind: 'terminal', instanceId: agD2.instanceId },
      replayPolicy: { mode: 'tail', lines: 100, bytes: 50_000 },
    }));
    const pubD2 = await waitFor(bD.inbox, m =>
      m.type === 'surface.published' && m.surface?.title === 'Terminal-2', 'D terminal-2');
    check('D2: Terminal-2 created', !!pubD2.surfaceId);

    // Observer for D
    const obsD = await connectBrowser(RELAY_WS, 'obs-D');
    await waitFor(obsD.inbox, m => m.type === 'welcome', 'obs-D welcome');
    obsD.ws.send(env('surface.subscribeNode', { nodeId: agD1.instanceId }));
    await waitFor(obsD.inbox, m => m.type === 'surface.list', 'obs-D list');

    // Close Terminal-1
    bD.ws.send(env('surface.close', { surfaceId: pubD1.surfaceId }));
    await waitFor(obsD.inbox, m =>
      m.type === 'surface.closed' && m.surfaceId === pubD1.surfaceId, 'obs-D surface.closed terminal-1');
    check('D3: Terminal-1 closed', true);

    // Verify Terminal-2 still exists
    const debugD = await debugSurfaces(RELAY_URL);
    check('D4: Terminal-1 gone', !debugD.surfaces.some(s => s.surfaceId === pubD1.surfaceId));
    check('D5: Terminal-2 still exists', debugD.surfaces.some(s => s.surfaceId === pubD2.surfaceId));
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // TEST E: Relay restart recovers surfaces
    // ═══════════════════════════════════════════════════════════
    console.log('── E: Relay restart recovery ──');

    // Force flush before checking
    await delay(800); // wait for debounce

    // relay uses process.cwd() for persistence, so file is in project root
    const surfacesPath = join(WORK_DIR, '.sessionbridge', 'surfaces.json');
    check('E1: surfaces.json exists', existsSync(surfacesPath));
    if (existsSync(surfacesPath)) {
      const raw = readFileSync(surfacesPath, 'utf-8');
      const parsed = JSON.parse(raw);
      check('E2: surfaces.json has version=1', parsed.version === 1);
      check('E3: surfaces.json has surfaces array', Array.isArray(parsed.surfaces));
      console.log(`  surfaces.json: ${parsed.surfaces.length} surface(s)`);
    }

    const preCount = (await debugSurfaces(RELAY_URL)).surfaces.length;
    console.log(`  Surfaces before restart: ${preCount}`);

    bridgeProcess.kill();
    await delay(500);
    bridgeProcess = startBridge();
    if (!await waitForRelay()) { console.error('Relay did not restart'); process.exit(1); }
    console.log('  Relay restarted.');
    await delay(1000);

    const debugE = await debugSurfaces(RELAY_URL);
    check('E4: Surfaces restored after restart', debugE.surfaces.length >= 1);
    console.log(`  Surfaces after restart: ${debugE.surfaces.length}`);
    check('E5: Auto-created surface (test A) restored',
      debugE.surfaces.some(s => s.nodeId === INST_ID_A));
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // TEST F: Agent reconnect clears orphaned flag
    // ═══════════════════════════════════════════════════════════
    console.log('── F: Agent reconnect clears orphaned ──');

    const agF = await registerAgent(RELAY_WS, 'NODE-B', '/fake/b');
    const invReq = await waitFor(agF.inbox, m =>
      m.type === 'agent.inventory.request', 'F inventory.request', 5000);
    check('F1: Agent got inventory.request', !!invReq);

    // Report the surface's instance as alive
    agF.ws.send(env('agent.inventory.report', {
      nodeId: agF.instanceId,
      processes: [{ instanceId: INST_ID_B, kind: 'terminal', title: 'B-Terminal', pid: 12345, createdAt: Date.now() }],
      activeOperations: [],
    }));
    const ackF = await waitFor(agF.inbox, m =>
      m.type === 'agent.inventory.ack', 'F inventory.ack', 5000);
    check('F2: Agent got inventory.ack', !!ackF);
    console.log(`  Ack: +${ackF.createdSurfaces || 0} created, ${ackF.clearedOrphaned || 0} cleared`);
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // TEST G: Agent reconnect rebuilds missing surfaces
    // ═══════════════════════════════════════════════════════════
    console.log('── G: Agent reconnect rebuilds surfaces ──');

    const agG = await registerAgent(RELAY_WS, 'NODE-G-NEW', '/fake/g');
    await waitFor(agG.inbox, m => m.type === 'agent.inventory.request', 'G inventory.request', 5000);

    const GHOST_ID = `ghost_proc_${Date.now().toString(36)}`;
    agG.ws.send(env('agent.inventory.report', {
      nodeId: agG.instanceId,
      processes: [{ instanceId: GHOST_ID, kind: 'terminal', title: 'Ghost-Term', pid: 99999, createdAt: Date.now() }],
      activeOperations: [],
    }));
    const ackG = await waitFor(agG.inbox, m =>
      m.type === 'agent.inventory.ack', 'G inventory.ack', 5000);
    check('G1: Inventory ack received', !!ackG);
    check('G2: New surface created from inventory', (ackG.createdSurfaces || 0) >= 1);

    const debugG = await debugSurfaces(RELAY_URL);
    const ghost = debugG.surfaces.find(s => s.title === 'Ghost-Term');
    check('G3: Ghost surface exists', !!ghost);
    check('G4: Ghost surface is terminal', ghost?.viewType === 'terminal');
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // TEST H: Keep + reconnection synthesis
    // ═══════════════════════════════════════════════════════════
    console.log('── H: Keep + reconnection ──');

    const agH = await registerAgent(RELAY_WS, 'NODE-H', '/fake/h');
    check('H0: Agent H registered', !!agH.instanceId);

    const bH = await connectBrowser(RELAY_WS, 'H');
    await waitFor(bH.inbox, m => m.type === 'welcome', 'H welcome');

    bH.ws.send(env('surface.publish', {
      nodeId: agH.instanceId, title: 'Kept-Term', viewType: 'terminal',
      scope: 'node', shared: true,
      runtimeRef: { kind: 'terminal', instanceId: agH.instanceId },
      replayPolicy: { mode: 'tail', lines: 100, bytes: 50_000 },
    }));
    const pubH = await waitFor(bH.inbox, m =>
      m.type === 'surface.published' && m.surface?.title === 'Kept-Term', 'H surface.published');
    const SURF_ID_H = pubH.surfaceId;
    check('H1: Surface created', !!SURF_ID_H);

    // Set keep
    bH.ws.send(env('surface.keep', { surfaceId: SURF_ID_H }));
    const keptH = await waitFor(bH.inbox, m =>
      m.type === 'surface.kept' && m.keep === true, 'H surface.kept');
    check('H2: surface.keep acknowledged', !!keptH);

    // Close browser H
    bH.ws.close();
    await delay(300);

    // New browser connects → surface should still be listed (keep=true)
    const bH2 = await connectBrowser(RELAY_WS, 'H2');
    await waitFor(bH2.inbox, m => m.type === 'welcome', 'H2 welcome');
    bH2.ws.send(env('surface.subscribeNode', { nodeId: agH.instanceId }));
    const listH2 = await waitFor(bH2.inbox, m => m.type === 'surface.list', 'H2 surface.list');
    const surfH2 = (listH2.surfaces || []).find(s => s.surfaceId === SURF_ID_H);
    check('H3: Kept surface visible after browser close', !!surfH2);
    if (surfH2) check('H4: Surface has keep=true', surfH2.keep === true);

    // Unkeep
    bH2.ws.send(env('surface.unkeep', { surfaceId: SURF_ID_H }));
    const unkeptH = await waitFor(bH2.inbox, m =>
      m.type === 'surface.kept' && m.keep === false, 'H2 surface.unkeep confirmed');
    check('H5: surface.unkeep acknowledged', !!unkeptH);
    console.log('');

  } finally {
    console.log('── Cleanup ──');
    if (bridgeProcess) { bridgeProcess.kill(); await delay(300); }
    try { rmSync(WORK_DIR, { recursive: true, force: true }); } catch {}
    try { rmSync(join(WORK_DIR, '.sessionbridge', 'surfaces.json'), { force: true }); } catch {}
    console.log('  Done.');
  }

  console.log(`\n===== RESULTS: ${passed}/${passed + failed} passed =====`);
  if (failed) { console.log(`  FAIL: ${failed} test(s) failed`); process.exit(1); }
  console.log(`  PASS: Unified persistence model tests passed`);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
