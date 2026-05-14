// Real scenario cross-relay tab sync test
// Uses ACTUAL peer IDs from both relays (not synthetic)
// VPS: subscribes to PENGSPC instance ID (e.g. inst_3_mp59u12m)
// Local: subscribes to __local__
// Validates label-matching path (syncTabsByLabel) used in real UI

import WebSocket from 'ws';

const delay = ms => new Promise(r => setTimeout(r, ms));
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

const LOCAL = 'ws://localhost:9000';
const VPS   = 'ws://43.160.241.180:8080';

let passed = 0, failed = 0;
function check(desc, ok) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}

async function waitFor(inbox, type, label, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (let i = 0; i < inbox.length; i++) {
      try {
        const m = JSON.parse(inbox[i]);
        const msg = m.v === 1 && m.body ? { ...m.body, type: m.type } : m;
        if (msg.type === type) { inbox.splice(i, 1); return msg; }
      } catch {}
    }
    await delay(50);
  }
  const remaining = inbox.map(s => { try { return JSON.parse(s).type; } catch { return '??'; } }).join(', ');
  throw new Error(`[${label}] Timeout waiting for ${type} (inbox: [${remaining}])`);
}

async function connect(url, label) {
  const ws = new WebSocket(url);
  const buf = [];
  ws.on('message', d => buf.push(d.toString()));
  await new Promise(r => ws.on('open', r));

  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: [],
    cols: 120, rows: 40, workspace: true,
    clientToken: `${label}_${Date.now()}`,
  }));

  await waitFor(buf, 'welcome', `${label} welcome`, 5000);
  const peerList = await waitFor(buf, 'peer.list', `${label} peer.list`, 5000);
  return { ws, buf, peers: peerList.peers || [] };
}

async function main() {
  console.log(`\n===== Real Scenario Cross-Relay Tab Sync Test =====`);
  console.log(`  Local: ${LOCAL}`);
  console.log(`  VPS:   ${VPS}\n`);

  // 1. Connect both sides
  console.log('1. Connecting...');
  const local = await connect(LOCAL, 'LOCAL');
  const vps = await connect(VPS, 'VPS');
  console.log('   Connected.\n');

  // 2. Find real IDs
  const localNode = local.peers.find(p => p.id === '__local__');
  const vpsPengspc = vps.peers.find(p => p.name === 'PENGSPC' && p.type === 'agent');

  console.log('2. Real IDs:');
  console.log(`   Local node:  id=${localNode?.id} name=${localNode?.name}`);
  console.log(`   VPS PENGSPC: id=${vpsPengspc?.id} name=${vpsPengspc?.name}`);
  check('Local __local__ node found', !!localNode);
  check('VPS PENGSPC agent found', !!vpsPengspc);

  if (!localNode || !vpsPengspc) {
    console.log('\n  [ABORT] Required nodes not found');
    local.ws.close(); vps.ws.close();
    return;
  }

  const localNodeId = '__local__';
  const vpsNodeId = vpsPengspc.id;

  // 3. Subscribe to nodes (different IDs on each relay!)
  console.log('\n3. Subscribing...');
  local.ws.send(env('workbench.subscribe', { nodeId: localNodeId }));
  vps.ws.send(env('workbench.subscribe', { nodeId: vpsNodeId }));

  const localTabs = await waitFor(local.buf, 'workbench.tabs', 'local initial tabs', 5000);
  const vpsTabs = await waitFor(vps.buf, 'workbench.tabs', 'vps initial tabs', 5000);
  console.log(`   Local subscribed to ${localNodeId}, got ${localTabs.tabs?.length || 0} tabs`);
  console.log(`   VPS subscribed to ${vpsNodeId}, got ${vpsTabs.tabs?.length || 0} tabs`);

  // 4. VPS → Local: create tabs on VPS, check local receives
  console.log('\n4. VPS → Local sync test:');
  const vpsCreatedTabs = [
    { id: 'vps_tab_1', title: 'terminal', viewType: 'terminal', instanceId: vpsNodeId },
    { id: 'vps_tab_2', title: 'files', viewType: 'files', instanceId: null },
  ];
  vps.ws.send(env('workbench.tabs', { nodeId: vpsNodeId, tabs: vpsCreatedTabs }));

  try {
    const received = await waitFor(local.buf, 'workbench.tabs', 'local receive VPS tabs', 10000);
    check('Local received VPS tabs', !!received.tabs && received.tabs.length === 2);
    if (received.tabs?.length > 0) {
      check('VPS→Local: tab title preserved', received.tabs[0]?.title === 'terminal');
      check('VPS→Local: viewType preserved', received.tabs[1]?.viewType === 'files');
    }
  } catch (e) {
    console.log(`  ${e.message}`);
    check('Local received VPS tabs (label-matching)', false);
  }

  // Clear buffer for next test
  await delay(500);
  local.buf.length = 0;
  vps.buf.length = 0;

  // 5. Local → VPS: create tabs on local, check VPS receives
  console.log('\n5. Local → VPS sync test:');
  const localCreatedTabs = [
    { id: 'local_tab_1', title: 'system-info', viewType: 'system-info', instanceId: null },
    { id: 'local_tab_2', title: 'output', viewType: 'output', instanceId: localNodeId },
  ];
  local.ws.send(env('workbench.tabs', { nodeId: localNodeId, tabs: localCreatedTabs }));

  try {
    const received = await waitFor(vps.buf, 'workbench.tabs', 'vps receive local tabs', 10000);
    check('VPS received local tabs', !!received.tabs && received.tabs.length === 2);
    if (received.tabs?.length > 0) {
      check('Local→VPS: tab title preserved', received.tabs[0]?.title === 'system-info');
      check('Local→VPS: viewType preserved', received.tabs[1]?.viewType === 'output');
    }
  } catch (e) {
    console.log(`  ${e.message}`);
    check('VPS received local tabs (label-matching)', false);
  }

  // 6. Verify both sides see latest state
  console.log('\n6. Latest state check:');
  // VPS should have local's tabs (last writer wins)
  await delay(300);

  // A new VPS subscriber should get the latest persisted state
  const vps2 = await connect(VPS, 'VPS2');
  vps2.ws.send(env('workbench.subscribe', { nodeId: vpsNodeId }));
  try {
    const latest = await waitFor(vps2.buf, 'workbench.tabs', 'VPS2 latest', 5000);
    check('VPS2 new subscriber gets tabs', latest.tabs?.length === 2);
    check('VPS2 sees latest (local) state', latest.tabs[0]?.id === 'local_tab_1');
  } catch (e) {
    check('VPS2 gets persisted tabs', false);
  }
  vps2.ws.close();

  // Cleanup
  local.ws.close();
  vps.ws.close();
  await delay(300);

  console.log(`\n===== RESULTS: ${passed} passed, ${failed} failed =====`);
  if (failed === 0) console.log('  ✅ ALL REAL SCENARIO TESTS PASSED\n');
  else console.log(`  ❌ ${failed} test(s) failed\n`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
