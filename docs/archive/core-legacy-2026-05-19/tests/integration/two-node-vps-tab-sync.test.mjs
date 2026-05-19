// ─── Two-Node Cross-Machine Tab Sync Test ────────────────
// Tests the REAL bug: tab created on Node A (VPS) doesn't sync to Node B (local).
//
// Topology (real cross-machine):
//   Browser A ──→ VPS Relay (:8080, via SSH tunnel :18080)
//   Browser B ──→ Local Relay (:14400) ──upstream──→ VPS Relay (:8080)
//
// Usage:
//   node tests/integration/two-node-vps-tab-sync.test.mjs
//
// Prerequisites:
//   ssh -N -L 18080:localhost:8080 ubuntu@43.160.241.180
//   Local relay running on :14400 connected to VPS as upstream
//
// Environment:
//   VPS_PORT=18080  LOCAL_RELAY_PORT=14400  — override ports
//   VERBOSE=1       — print debug output

import http from 'http';
import WebSocket from 'ws';

const VPS_PORT = parseInt(process.env.VPS_PORT || '18080', 10);
const LOCAL_PORT = parseInt(process.env.LOCAL_RELAY_PORT || '14400', 10);
const VPS_HTTP = `http://localhost:${VPS_PORT}`;
const VPS_WS   = `ws://localhost:${VPS_PORT}`;
const LOCAL_WS = `ws://localhost:${LOCAL_PORT}`;
const VERBOSE  = process.env.VERBOSE === '1';

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Test accounting ─────────────────────────────────────
let passed = 0, failed = 0;
function check(desc, ok) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}
function section(name) {
  console.log(`\n─── ${name} ───`);
}

// ── Envelope helpers ────────────────────────────────────
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

function parseMsg(raw) {
  try {
    const m = JSON.parse(raw);
    return m.v === 1 && m.body ? { ...m.body, type: m.type } : m;
  } catch { return null; }
}

// ── HTTP helper ─────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}\n${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

// ── WebSocket client helper ─────────────────────────────
async function connectBrowser(url, label) {
  const ws = new WebSocket(url);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: ['shell'],
    clientToken: `2node_${label}_${Date.now()}`,
  }));
  return { ws, inbox, label };
}

async function waitFor(inbox, predicate, label, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (let i = 0; i < inbox.length; i++) {
      const msg = parseMsg(inbox[i]);
      if (msg && predicate(msg)) { inbox.splice(i, 1); return msg; }
    }
    await delay(50);
  }
  throw new Error(`[${label}] Timeout (${timeout}ms) waiting for ${predicate.toString().slice(0, 80)}`);
}

function filterMsgs(inbox, type) {
  return inbox.map(m => parseMsg(m)).filter(m => m && m.type === type);
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`  Two-Node Cross-Machine Tab Sync Test`);
  console.log(`  VPS relay:   localhost:${VPS_PORT} → 43.160.241.180:8080`);
  console.log(`  Local relay: localhost:${LOCAL_PORT} → upstream VPS`);
  console.log(`══════════════════════════════════════════════════════\n`);

  // ── N0: Verify topology ──────────────────────────────
  section('N0: Verify topology');

  // VPS must be reachable
  const vpsInfo = await httpGet(`${VPS_HTTP}/api/info`);
  check('N0.1: VPS relay reachable', !!vpsInfo.homeDir);
  console.log(`  VPS: ${vpsInfo.homeDir}`);

  // Get VPS node info
  const vpsState = await httpGet(`${VPS_HTTP}/api/debug/statebus`);
  const vpsNodeId = vpsState.localNodeInfo?.id || '__local__';
  check('N0.2: VPS statebus responds', vpsState.ok === true);

  // Find downstream instance
  const downInst = vpsState.instances?.find(i => i.label === 'local-test-node' && i.status === 'running');
  check('N0.3: Local relay registered on VPS', !!downInst);
  const localNodeId = downInst?.id;
  console.log(`  VPS node: ${vpsNodeId}  Local node: ${localNodeId}`);

  if (!localNodeId) {
    console.error('  FATAL: Local relay not registered on VPS. Start it with --upstream ws://43.160.241.180:8080');
    process.exit(1);
  }

  // ── Connect browsers ─────────────────────────────────
  section('Connect browsers');
  const browserA = await connectBrowser(VPS_WS, 'A');
  await waitFor(browserA.inbox, m => m.type === 'welcome', 'A');
  console.log('  Browser A → VPS relay ✅');

  const browserB = await connectBrowser(LOCAL_WS, 'B');
  await waitFor(browserB.inbox, m => m.type === 'welcome', 'B');
  console.log('  Browser B → Local relay ✅');
  await delay(500);

  // ═══════════════════════════════════════════════════════
  // N1: Tab created on VPS → visible on local relay
  // This is the user's reported bug scenario
  // ═══════════════════════════════════════════════════════
  section('N1: VPS tab → visible on local relay');

  // Browser A: create surface on VPS
  browserA.ws.send(env('surface.publish', {
    nodeId: '__local__',
    title: 'N1 VPS Terminal',
    viewType: 'terminal',
    scope: 'node',
    shared: true,
    runtimeRef: { kind: 'terminal', instanceId: `n1_vps_${Date.now().toString(36)}` },
  }));
  const n1Pub = await waitFor(browserA.inbox, m => m.type === 'surface.published', 'A n1 pub');
  check('N1.1: Surface published on VPS', !!n1Pub.surfaceId);
  const n1SurfId = n1Pub.surfaceId;
  console.log(`  Surface ID: ${n1SurfId}`);

  await delay(2000);

  // Browser B: subscribe to VPS node's workbench tabs
  browserB.ws.send(env('workbench.subscribe', { nodeId: '__local__' }));
  const n1TabsB = await waitFor(browserB.inbox, m => m.type === 'workbench.tabs', 'B n1 tabs');
  check('N1.2: Browser B received workbench.tabs', Array.isArray(n1TabsB.tabs));
  const n1SeesVpsTab = n1TabsB.tabs.some(t => t._surfaceId === n1SurfId);
  check('N1.3: VPS tab visible on local relay', n1SeesVpsTab);
  console.log(`  Tab count on local relay: ${n1TabsB.tabs?.length || 0}`);

  // Verify via VPS statebus
  const n1StateAfter = await httpGet(`${VPS_HTTP}/api/debug/statebus`);
  const n1InVpsState = Object.values(n1StateAfter.surfaces?.byNode || {}).flat()
    .some(s => s.surfaceId === n1SurfId);
  check('N1.4: Surface registered in VPS statebus', n1InVpsState);

  // ═══════════════════════════════════════════════════════
  // N2: Tab created on local relay → visible on VPS
  // ═══════════════════════════════════════════════════════
  section('N2: Local relay tab → visible on VPS');

  // Browser B: create surface on local relay
  browserB.ws.send(env('surface.publish', {
    nodeId: '__local__',
    title: 'N2 Local Terminal',
    viewType: 'terminal',
    scope: 'node',
    shared: true,
    runtimeRef: { kind: 'terminal', instanceId: `n2_local_${Date.now().toString(36)}` },
  }));
  const n2Pub = await waitFor(browserB.inbox, m => m.type === 'surface.published', 'B n2 pub');
  check('N2.1: Surface published on local relay', !!n2Pub.surfaceId);
  const n2SurfId = n2Pub.surfaceId;
  console.log(`  Surface ID: ${n2SurfId}`);

  await delay(2000);

  // Verify via VPS statebus: surface appears under local relay's node
  const n2State = await httpGet(`${VPS_HTTP}/api/debug/statebus`);
  const n2InDownstream = (n2State.surfaces?.byNode?.[localNodeId] || [])
    .some(s => s.surfaceId === n2SurfId);
  check('N2.2: Local tab visible in VPS statebus under downstream node', n2InDownstream);

  // Browser A: subscribe to VPS workbench (should show local tab via sync)
  browserA.ws.send(env('workbench.subscribe', { nodeId: '__local__' }));
  const n2TabsA = await waitFor(browserA.inbox, m => m.type === 'workbench.tabs', 'A n2 tabs');
  check('N2.3: Browser A received workbench.tabs on VPS', Array.isArray(n2TabsA.tabs));
  const n2VpsSeesLocal = n2TabsA.tabs.some(t => t._surfaceId === n2SurfId);
  check('N2.4: Local relay tab visible on VPS', n2VpsSeesLocal);

  // ═══════════════════════════════════════════════════════
  // N3: Node-level surface discovery across relays
  // ═══════════════════════════════════════════════════════
  section('N3: Cross-node surface discovery');

  // Browser B: subscribeNode on VPS local node
  browserB.ws.send(env('surface.subscribeNode', { nodeId: '__local__' }));
  const n3VpsList = await waitFor(browserB.inbox, m => m.type === 'surface.list', 'B n3 vps');
  check('N3.1: Local relay discovers VPS node surfaces', Array.isArray(n3VpsList.surfaces));
  const n3SeesVpsInLocal = n3VpsList.surfaces.some(s => s.surfaceId === n1SurfId);
  check('N3.2: VPS surface visible via subscribeNode on local relay', n3SeesVpsInLocal);

  // Browser A: subscribeNode on local relay node
  browserA.ws.send(env('surface.subscribeNode', { nodeId: localNodeId }));
  const n3LocalList = await waitFor(browserA.inbox, m => m.type === 'surface.list', 'A n3 local');
  check('N3.3: VPS discovers local relay node surfaces', Array.isArray(n3LocalList.surfaces));
  const n3SeesLocalOnVps = n3LocalList.surfaces.some(s => s.surfaceId === n2SurfId);
  check('N3.4: Local surface visible via subscribeNode on VPS', n3SeesLocalOnVps);

  // ═══════════════════════════════════════════════════════
  // N4: Bi-directional tab sync (concurrent)
  // ═══════════════════════════════════════════════════════
  section('N4: Bi-directional tab sync');

  // Both A and B create surfaces simultaneously
  browserA.ws.send(env('surface.publish', {
    nodeId: '__local__', title: 'N4 From VPS', viewType: 'terminal',
    scope: 'node', shared: true,
    runtimeRef: { kind: 'terminal', instanceId: `n4a_${Date.now().toString(36)}` },
  }));
  browserB.ws.send(env('surface.publish', {
    nodeId: '__local__', title: 'N4 From Local', viewType: 'terminal',
    scope: 'node', shared: true,
    runtimeRef: { kind: 'terminal', instanceId: `n4b_${Date.now().toString(36)}` },
  }));

  const n4PubA = await waitFor(browserA.inbox, m => m.type === 'surface.published', 'A n4 pub');
  const n4PubB = await waitFor(browserB.inbox, m => m.type === 'surface.published', 'B n4 pub');
  check('N4.1: Both surfaces published', !!(n4PubA.surfaceId && n4PubB.surfaceId));
  console.log(`  VPS surf: ${n4PubA.surfaceId}  Local surf: ${n4PubB.surfaceId}`);

  await delay(3000);

  // Verify both surfaces on VPS statebus
  const n4State = await httpGet(`${VPS_HTTP}/api/debug/statebus`);
  const n4AllSurfaces = Object.values(n4State.surfaces?.byNode || {}).flat();
  const n4VpsOnVps = n4AllSurfaces.some(s => s.surfaceId === n4PubA.surfaceId);
  const n4LocalOnVps = n4AllSurfaces.some(s => s.surfaceId === n4PubB.surfaceId);
  check('N4.2: VPS surface on VPS statebus', n4VpsOnVps);
  check('N4.3: Local surface on VPS statebus', n4LocalOnVps);

  // Check no duplicate surface IDs
  const n4Ids = n4AllSurfaces.map(s => s.surfaceId).filter(Boolean);
  const n4Unique = new Set(n4Ids);
  check('N4.4: No duplicate surface IDs in statebus', n4Ids.length === n4Unique.size);

  // ═══════════════════════════════════════════════════════
  // N5: Surface cleanup via close
  // ═══════════════════════════════════════════════════════
  section('N5: Surface close propagation');

  browserA.ws.send(env('surface.close', { surfaceId: n1SurfId }));
  browserB.ws.send(env('surface.close', { surfaceId: n2SurfId }));
  await delay(2000);

  // Verify closed surfaces no longer visible in active surface lists
  const n5State = await httpGet(`${VPS_HTTP}/api/debug/statebus`);
  const n5AllSurfaces = Object.values(n5State.surfaces?.byNode || {}).flat();
  // Note: surfaces may persist in statebus (keep:true for restore), but should
  // not be in active __local__ or downstream node's list
  const n5LocalActive = n5State.surfaces?.byNode?.['__local__'] || [];
  const n5DownActive = n5State.surfaces?.byNode?.[localNodeId] || [];
  const n5ActiveSurfIds = [...n5LocalActive, ...n5DownActive].map(s => s.surfaceId);
  const n5ClosedGone = !n5ActiveSurfIds.includes(n1SurfId) && !n5ActiveSurfIds.includes(n2SurfId);
  check('N5.1: Closed surfaces removed from active lists', n5ClosedGone);

  // ── Summary ──────────────────────────────────────────
  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`══════════════════════════════════════════════════════\n`);

  browserA.ws.close();
  browserB.ws.close();
  await delay(500);

  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
