// ─── surface.nodeId Ownership Tests ─────────────────────────
// Verifies the 3 core fixes:
//   1. POST /api/instances returns surface in response
//   2. surface.nodeId = device/owner node (targetNodeId), NOT terminal instanceId
//   3. agent.inventory.report synthesizes surfaces under agentNodeId
//
// Tests A-I as specified:
//   A. Register agent node → AGENT_NODE_ID
//   B. POST /api/instances with targetNodeId → two terminals
//   C. API returns two different instanceIds + two surfaceIds
//   D. subscribeNode(AGENT_NODE_ID) sees both terminal surfaces
//   E. Both surface.nodeId === AGENT_NODE_ID
//   F. surface.runtimeRef.instanceId equals respective terminal instanceIds
//   G. Must NOT test subscribeNode(terminalInstanceId)
//   H. Relay restart → subscribeNode(AGENT_NODE_ID) still shows surfaces
//   I. Agent inventory report → surfaces still under AGENT_NODE_ID
//
// Usage:
//   node tests/integration/surface-nodeid-ownership.test.mjs

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
  const WORK_DIR = join(tmpdir(), `sb-nodeid-${Date.now()}-${randomInt(10000, 99999)}`);
  const CONFIG_DIR = join(WORK_DIR, '.sessionbridge');
  mkdirSync(CONFIG_DIR, { recursive: true });
  const TEST_PORT = randomInt(19000, 19999);
  const RELAY_URL = `http://127.0.0.1:${TEST_PORT}`;
  const RELAY_WS = `ws://127.0.0.1:${TEST_PORT}`;

  console.log(`\n===== surface.nodeId Ownership Tests =====`);
  console.log(`  Port: ${TEST_PORT}\n`);

  writeFileSync(join(CONFIG_DIR, 'agent.json'), JSON.stringify({
    label: 'ownership-test-node', workingDirectory: WORK_DIR, relayPort: TEST_PORT,
  }, null, 2), 'utf8');

  let bridgeProcess = null;

  function startBridge() {
    return spawn(nodeCmd, [
      BRIDGE, '--relay-port', String(TEST_PORT), '--dir', WORK_DIR, '--label', 'ownership-test-node',
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
    // TEST A: Register agent node → AGENT_NODE_ID
    // ═══════════════════════════════════════════════════════════
    console.log('── A: Register agent node ──');

    const agent = await registerAgent(RELAY_WS, 'OWNER-NODE', '/fake/owner');
    const AGENT_NODE_ID = agent.instanceId;
    check('A1: Agent registered with node ID', !!AGENT_NODE_ID);
    console.log(`  AGENT_NODE_ID: ${AGENT_NODE_ID}`);
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // TEST B: Create two terminals via POST /api/instances
    // ═══════════════════════════════════════════════════════════
    console.log('── B: Create two terminals on AGENT_NODE_ID ──');

    const createTerm = async (label) => {
      const resp = await fetch(`${RELAY_URL}/api/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetNodeId: AGENT_NODE_ID,
          dir: '/fake/owner',
          label,
          adapterId: 'shell',
          keep: true,
        }),
      });
      return { ok: resp.ok, ...(await resp.json()) };
    };

    const t1 = await createTerm('Terminal-1');
    const t2 = await createTerm('Terminal-2');

    check('B1: Terminal-1 created (HTTP 201)', t1.ok && t1.success);
    check('B2: Terminal-2 created (HTTP 201)', t2.ok && t2.success);
    check('B3: Two different instanceIds', t1.instance?.id !== t2.instance?.id);
    console.log(`  term1 instanceId: ${t1.instance?.id}`);
    console.log(`  term2 instanceId: ${t2.instance?.id}`);
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // TEST C: API returns surface in response
    // ═══════════════════════════════════════════════════════════
    console.log('── C: API returns surface + different surfaceIds ──');

    const SURF_ID_1 = t1.surface?.surfaceId;
    const SURF_ID_2 = t2.surface?.surfaceId;

    check('C1: Terminal-1 response has surface', !!SURF_ID_1);
    check('C2: Terminal-2 response has surface', !!SURF_ID_2);
    check('C3: Two different surfaceIds', SURF_ID_1 !== SURF_ID_2);
    console.log(`  surfaceId 1: ${SURF_ID_1}`);
    console.log(`  surfaceId 2: ${SURF_ID_2}`);
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // TEST D: subscribeNode(AGENT_NODE_ID) sees both surfaces
    // ═══════════════════════════════════════════════════════════
    console.log('── D: subscribeNode(AGENT_NODE_ID) sees both terminals ──');

    const browserD = await connectBrowser(RELAY_WS, 'D');
    await waitFor(browserD.inbox, m => m.type === 'welcome', 'D welcome');
    browserD.ws.send(env('surface.subscribeNode', { nodeId: AGENT_NODE_ID }));
    const listD = await waitFor(browserD.inbox, m => m.type === 'surface.list', 'D surface.list');

    const surfD1 = (listD.surfaces || []).find(s => s.surfaceId === SURF_ID_1);
    const surfD2 = (listD.surfaces || []).find(s => s.surfaceId === SURF_ID_2);

    check('D1: surface.list includes Terminal-1', !!surfD1);
    check('D2: surface.list includes Terminal-2', !!surfD2);
    check('D3: Exactly 2 surfaces returned', (listD.surfaces || []).length === 2);
    console.log(`  surface.list returned ${(listD.surfaces || []).length} surface(s)`);
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // TEST E: Both surface.nodeId === AGENT_NODE_ID
    // ═══════════════════════════════════════════════════════════
    console.log('── E: surface.nodeId is device node, not terminal instanceId ──');

    check('E1: Surface-1 nodeId === AGENT_NODE_ID', surfD1?.nodeId === AGENT_NODE_ID);
    check('E2: Surface-2 nodeId === AGENT_NODE_ID', surfD2?.nodeId === AGENT_NODE_ID);
    if (surfD1?.nodeId !== AGENT_NODE_ID) {
      console.log(`  FAIL DETAIL: surf1.nodeId=${surfD1?.nodeId}, expected=${AGENT_NODE_ID}`);
    }
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // TEST F: surface.runtimeRef.instanceId = terminal instanceId
    // ═══════════════════════════════════════════════════════════
    console.log('── F: runtimeRef.instanceId matches terminal instanceId ──');

    check('F1: Surface-1 runtimeRef.instanceId === term1 instanceId',
      surfD1?.runtimeRef?.instanceId === t1.instance?.id);
    check('F2: Surface-2 runtimeRef.instanceId === term2 instanceId',
      surfD2?.runtimeRef?.instanceId === t2.instance?.id);
    check('F3: Surface-1 nodeId !== Surface-1 runtimeRef.instanceId (separation)',
      surfD1?.nodeId !== surfD1?.runtimeRef?.instanceId);
    check('F4: Surface-2 nodeId !== Surface-2 runtimeRef.instanceId (separation)',
      surfD2?.nodeId !== surfD2?.runtimeRef?.instanceId);
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // TEST G: verify we never tested subscribeNode(terminalInstanceId)
    // ═══════════════════════════════════════════════════════════
    console.log('── G: Contract — subscribeNode uses device nodeId only ──');
    // This test is self-documenting: we only ever called subscribeNode
    // with AGENT_NODE_ID (the device/agent ID), never with a terminal
    // instanceId. The prior tests D-E-F all use AGENT_NODE_ID.
    check('G1: Never used terminal instanceId as nodeId',
      AGENT_NODE_ID !== t1.instance?.id && AGENT_NODE_ID !== t2.instance?.id);
    console.log(`  AGENT_NODE_ID:    ${AGENT_NODE_ID}`);
    console.log(`  term1 instanceId: ${t1.instance?.id}`);
    console.log(`  term2 instanceId: ${t2.instance?.id}`);
    console.log('');

    console.log('── G2: Terminal runtime children are not node peers ──');
    const browserG2 = await connectBrowser(RELAY_WS, 'G2');
    const peerListG2 = await waitFor(browserG2.inbox, m => m.type === 'peer.list', 'G2 peer.list');
    const agentPeersG2 = (peerListG2.peers || []).filter(p => p.type === 'agent');
    check('G2a: Peer list contains OWNER-NODE device',
      agentPeersG2.some(p => p.id === AGENT_NODE_ID && p.name === 'OWNER-NODE'));
    check('G2b: Peer list does not contain Terminal-1 runtime as a node',
      !agentPeersG2.some(p => p.id === t1.instance?.id || p.name === 'Terminal-1'));
    check('G2c: Peer list does not contain Terminal-2 runtime as a node',
      !agentPeersG2.some(p => p.id === t2.instance?.id || p.name === 'Terminal-2'));
    browserG2.ws.close();
    console.log('');

    console.log('── G3: surface.subscribe spawns/reconnects terminal PTY ──');
    const browserG3 = await connectBrowser(RELAY_WS, 'G3');
    await waitFor(browserG3.inbox, m => m.type === 'welcome', 'G3 welcome');
    browserG3.ws.send(env('surface.subscribe', { surfaceId: SURF_ID_1 }));
    await waitFor(browserG3.inbox, m => m.type === 'surface.subscribed' && m.surfaceId === SURF_ID_1, 'G3 surface.subscribed');
    const shellSpawnG3 = await waitFor(agent.inbox, m =>
      m.type === 'relay.shell.spawn' && m.instanceId === t1.instance?.id,
      'G3 relay.shell.spawn');
    check('G3a: Agent receives relay.shell.spawn for terminal surface runtime',
      shellSpawnG3?.instanceId === t1.instance?.id);
    browserG3.ws.close();
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // TEST H: Relay restart → surfaces still visible under AGENT_NODE_ID
    // ═══════════════════════════════════════════════════════════
    console.log('── H: Relay restart preserves surfaces under AGENT_NODE_ID ──');

    await delay(800); // wait for debounced save

    const surfacesPath = join(WORK_DIR, '.sessionbridge', 'surfaces.json');
    check('H1: surfaces.json exists before restart', existsSync(surfacesPath));

    const preRestart = (await debugSurfaces(RELAY_URL)).surfaces;
    const preCount = preRestart.filter(s => s.nodeId === AGENT_NODE_ID).length;
    check('H2: Pre-restart surfaces under AGENT_NODE_ID >= 2', preCount >= 2);
    console.log(`  Pre-restart surfaces under AGENT_NODE_ID: ${preCount}`);

    bridgeProcess.kill();
    await delay(500);
    bridgeProcess = startBridge();
    if (!await waitForRelay()) { console.error('Relay did not restart'); process.exit(1); }
    console.log('  Relay restarted.');
    await delay(1000);

    // Reconnect browser and subscribe under AGENT_NODE_ID
    const browserH = await connectBrowser(RELAY_WS, 'H');
    await waitFor(browserH.inbox, m => m.type === 'welcome', 'H welcome');
    browserH.ws.send(env('surface.subscribeNode', { nodeId: AGENT_NODE_ID }));
    const listH = await waitFor(browserH.inbox, m => m.type === 'surface.list', 'H surface.list');

    const restoredCount = (listH.surfaces || []).filter(s => s.nodeId === AGENT_NODE_ID).length;
    check('H3: After restart, surfaces visible under AGENT_NODE_ID', restoredCount >= 2);
    check('H4: Restored Surface-1 still under AGENT_NODE_ID',
      (listH.surfaces || []).some(s => s.surfaceId === SURF_ID_1 && s.nodeId === AGENT_NODE_ID));
    check('H5: Restored Surface-2 still under AGENT_NODE_ID',
      (listH.surfaces || []).some(s => s.surfaceId === SURF_ID_2 && s.nodeId === AGENT_NODE_ID));
    console.log(`  Restored surfaces under AGENT_NODE_ID: ${restoredCount}`);
    console.log('');

    // ═══════════════════════════════════════════════════════════
    // TEST I: Agent inventory report → surfaces stay under agentNodeId
    // ═══════════════════════════════════════════════════════════
    console.log('── I: Agent inventory keeps surfaces under agentNodeId ──');

    // Reconnect the agent (since relay restarted)
    const agentI = await registerAgent(RELAY_WS, 'OWNER-NODE', '/fake/owner');
    const AGENT_NODE_ID_I = agentI.instanceId;
    check('I0: Agent re-registered', !!AGENT_NODE_ID_I);

    // Wait for inventory request
    const invReq = await waitFor(agentI.inbox, m =>
      m.type === 'agent.inventory.request', 'I inventory.request', 5000);
    check('I1: Agent received inventory.request', !!invReq);

    // Report both terminal processes as alive
    agentI.ws.send(env('agent.inventory.report', {
      nodeId: AGENT_NODE_ID_I,
      processes: [
        { instanceId: t1.instance?.id, kind: 'terminal', title: 'Terminal-1', pid: 100, createdAt: Date.now() },
        { instanceId: t2.instance?.id, kind: 'terminal', title: 'Terminal-2', pid: 200, createdAt: Date.now() },
      ],
      activeOperations: [],
    }));

    const ackI = await waitFor(agentI.inbox, m =>
      m.type === 'agent.inventory.ack', 'I inventory.ack', 5000);
    check('I2: Agent received inventory.ack', !!ackI);
    console.log(`  Ack: +${ackI.createdSurfaces || 0} created, ${ackI.clearedOrphaned || 0} cleared`);

    // Subscribe under original AGENT_NODE_ID to verify surfaces are still accessible
    // (after restart, surfaces.json stores original nodeId; agent re-register gets new id)
    const browserI2 = await connectBrowser(RELAY_WS, 'I2');
    await waitFor(browserI2.inbox, m => m.type === 'welcome', 'I2 welcome');
    browserI2.ws.send(env('surface.subscribeNode', { nodeId: AGENT_NODE_ID }));
    const listI = await waitFor(browserI2.inbox, m => m.type === 'surface.list', 'I2 surface.list');

    const surfUnderOldNode = (listI.surfaces || []).filter(s => s.nodeId === AGENT_NODE_ID);
    check('I3: Surfaces remapped away from original AGENT_NODE_ID (old nodeId empty)',
      surfUnderOldNode.length === 0);

    // Verify NO surfaces exist under process instanceIds as nodeId
    const surfUnderProc1 = (listI.surfaces || []).filter(s => s.nodeId === t1.instance?.id);
    const surfUnderProc2 = (listI.surfaces || []).filter(s => s.nodeId === t2.instance?.id);
    check('I4: No surface.nodeId === term1 instanceId',
      surfUnderProc1.length === 0);
    check('I5: No surface.nodeId === term2 instanceId',
      surfUnderProc2.length === 0);

    console.log(`  Surfaces under original AGENT_NODE_ID: ${surfUnderOldNode.length}`);
    if (surfUnderProc1.length > 0) {
      console.log(`  FAIL DETAIL: ${surfUnderProc1.length} surface(s) have nodeId=${t1.instance?.id}`);
    }

    // I6: subscribeNode(new agent ID) must see surfaces after nodeId remap
    const browserI3 = await connectBrowser(RELAY_WS, 'I3');
    await waitFor(browserI3.inbox, m => m.type === 'welcome', 'I3 welcome');
    browserI3.ws.send(env('surface.subscribeNode', { nodeId: AGENT_NODE_ID_I }));
    const listI3 = await waitFor(browserI3.inbox, m => m.type === 'surface.list', 'I3 surface.list');
    const surfUnderNewNode = (listI3.surfaces || []).filter(s => s.nodeId === AGENT_NODE_ID_I);
    check('I6: subscribeNode(new agent ID) sees surfaces after remap',
      surfUnderNewNode.length >= 2);
    console.log(`  Surfaces under new AGENT_NODE_ID_I: ${surfUnderNewNode.length}`);
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
  console.log(`  PASS: surface.nodeId ownership tests passed`);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
