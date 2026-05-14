// Late-joiner test: VPS creates tabs, THEN local browser connects
// Simulates actual user workflow: VPS user creates tabs first, local user joins later

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

async function connect(url, label, waitPeerList = true) {
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
  let peers = [];
  if (waitPeerList) {
    const pl = await waitFor(buf, 'peer.list', `${label} peer.list`, 5000);
    peers = pl.peers || [];
  }
  return { ws, buf, peers };
}

async function main() {
  console.log(`\n===== Late-Joiner Cross-Relay Tab Sync Test =====`);
  console.log(`  Simulates: VPS creates tabs first, local joins later\n`);

  // ── Phase 1: VPS creates tabs BEFORE local connects ──
  console.log('Phase 1: VPS user creates tabs first...');
  const vps = await connect(VPS, 'VPS', true);
  const vpsPengspc = vps.peers.find(p => p.name === 'PENGSPC' && p.type === 'agent');
  check('VPS: PENGSPC found in peer list', !!vpsPengspc);
  if (!vpsPengspc) { vps.ws.close(); return; }

  const vpsNodeId = vpsPengspc.id;
  console.log(`  VPS PENGSPC nodeId: ${vpsNodeId}`);

  // Subscribe VPS to PENGSPC
  vps.ws.send(env('workbench.subscribe', { nodeId: vpsNodeId }));
  const initialVpsTabs = await waitFor(vps.buf, 'workbench.tabs', 'VPS initial tabs', 5000);
  console.log(`  VPS initial tabs: ${initialVpsTabs.tabs?.length || 0}`);

  // Create tabs on VPS
  const vpsTabs = [
    { id: 'vps_terminal', title: 'terminal', viewType: 'terminal', instanceId: vpsNodeId },
    { id: 'vps_files', title: 'files', viewType: 'files', instanceId: null },
  ];
  vps.ws.send(env('workbench.tabs', { nodeId: vpsNodeId, tabs: vpsTabs }));
  console.log('  VPS sent tabs to relay');
  await delay(1000);

  // ── Phase 2: Local browser connects AFTER VPS tabs were created ──
  console.log('\nPhase 2: Local user joins (after VPS tabs were created)...');
  const local = await connect(LOCAL, 'LOCAL', true);
  const localNode = local.peers.find(p => p.id === '__local__');
  check('Local: __local__ node found', !!localNode);

  const localNodeId = '__local__';

  // Subscribe local to PENGSPC
  local.ws.send(env('workbench.subscribe', { nodeId: localNodeId }));

  try {
    const localTabs = await waitFor(local.buf, 'workbench.tabs', 'local subscription response', 8000);
    const receivedTabs = localTabs.tabs || [];
    console.log(`  Local received tabs: ${receivedTabs.length}`);
    if (receivedTabs.length > 0) {
      console.log(`  Tabs: ${receivedTabs.map(t => `${t.id}(${t.title})`).join(', ')}`);
      check('Late-joiner: local sees VPS-created tabs', receivedTabs.length === 2);
      if (receivedTabs.length === 2) {
        check('Late-joiner: tab 1 id preserved', receivedTabs[0]?.id === 'vps_terminal');
        check('Late-joiner: tab 2 id preserved', receivedTabs[1]?.id === 'vps_files');
      }
    } else {
      check('Late-joiner: local sees VPS-created tabs', false);
    }
  } catch (e) {
    console.log(`  ${e.message}`);
    check('Late-joiner: local subscription response', false);
  }

  // ── Phase 3: Now test reverse — local creates tabs, VPS sees them ──
  console.log('\nPhase 3: Local creates tabs (both sides now connected)...');
  // Clear buffers
  vps.buf.length = 0;
  local.buf.length = 0;

  const localTabs = [
    { id: 'local_sysinfo', title: 'system-info', viewType: 'system-info', instanceId: null },
    { id: 'local_output', title: 'output', viewType: 'output', instanceId: localNodeId },
  ];
  local.ws.send(env('workbench.tabs', { nodeId: localNodeId, tabs: localTabs }));

  try {
    const received = await waitFor(vps.buf, 'workbench.tabs', 'VPS receive from local', 8000);
    check('VPS receives local tabs (reverse sync)', received.tabs?.length === 2);
    if (received.tabs?.length === 2) {
      check('Reverse: tab 1 id preserved', received.tabs[0]?.id === 'local_sysinfo');
      check('Reverse: tab 2 id preserved', received.tabs[1]?.id === 'local_output');
    }
  } catch (e) {
    console.log(`  ${e.message}`);
    check('VPS receives local tabs (reverse sync)', false);
  }

  // ── Phase 4: New VPS subscriber sees latest state ──
  console.log('\nPhase 4: New VPS subscriber gets persisted state...');
  const vps2 = await connect(VPS, 'VPS2', true);
  vps2.ws.send(env('workbench.subscribe', { nodeId: vpsNodeId }));
  try {
    const latest = await waitFor(vps2.buf, 'workbench.tabs', 'VPS2 late subscribe', 5000);
    check('VPS2 new subscriber gets tabs', latest.tabs?.length === 2);
    if (latest.tabs?.length === 2) {
      check('VPS2 sees latest (local) state', latest.tabs[0]?.id === 'local_sysinfo');
    }
  } catch (e) {
    check('VPS2 late subscribe gets tabs', false);
  }
  vps2.ws.close();

  // Cleanup
  local.ws.close();
  vps.ws.close();
  await delay(300);

  console.log(`\n===== RESULTS: ${passed} passed, ${failed} failed =====`);
  if (failed === 0) console.log('  ✅ ALL LATE-JOINER TESTS PASSED\n');
  else console.log(`  ❌ ${failed} test(s) failed\n`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
