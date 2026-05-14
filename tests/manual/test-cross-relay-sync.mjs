// ─── Cross-relay workbench tab sync test ──────────────────────────
// Validates that tabs created on one relay propagate to another relay
// via the upstream agent connection.
//
// Setup:
//   Local relay (leaf)  → upstream → VPS relay (43.160.241.180:8080)
//   WS1 connects to local relay
//   WS2 connects to VPS relay
//   Both subscribe to the same nodeId
//   Tabs created on one side should appear on the other

import WebSocket from 'ws';

const delay = ms => new Promise(r => setTimeout(r, ms));
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

const LOCAL = 'ws://localhost:9000';
const VPS   = 'ws://43.160.241.180:8080';
const NODE_ID = 'cross_relay_test_' + Date.now();

let passed = 0, failed = 0;
function check(desc, ok) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}

async function connect(url, label) {
  const ws = new WebSocket(url);
  const buf = [];
  ws.on('message', d => buf.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  console.log(`  [${label}] Connected to ${url}`);

  // Auth
  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: [],
    cols: 120, rows: 40, workspace: true,
    clientToken: `${label}_${Date.now()}`,
  }));

  // Wait for welcome
  await waitFor(buf, 'welcome', `${label} welcome`, 5000);
  console.log(`  [${label}] Authenticated`);

  return { ws, buf };
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

async function main() {
  console.log(`\n===== Cross-Relay Workbench Sync Test =====`);
  console.log(`  Local: ${LOCAL}`);
  console.log(`  VPS:   ${VPS}`);
  console.log(`  Node:  ${NODE_ID}\n`);

  // 1. Connect both sides
  const c1 = await connect(LOCAL, 'C1(local)');
  const c2 = await connect(VPS,   'C2(VPS)');

  // 2. Both subscribe to same nodeId
  c1.ws.send(env('workbench.subscribe', { nodeId: NODE_ID }));
  c2.ws.send(env('workbench.subscribe', { nodeId: NODE_ID }));
  await waitFor(c1.buf, 'workbench.tabs', 'C1 initial subscribe', 5000);
  await waitFor(c2.buf, 'workbench.tabs', 'C2 initial subscribe', 5000);
  console.log('  [OK] Both subscribed\n');

  // 3. C1(Local) → C2(VPS): create tabs
  const tabs1 = [
    { id: 'tab_a', title: 'terminal', viewType: 'terminal', instanceId: 'inst_1' },
    { id: 'tab_b', title: 'files',   viewType: 'files',     instanceId: null },
  ];
  c1.ws.send(env('workbench.tabs', { nodeId: NODE_ID, tabs: tabs1 }));

  const r1 = await waitFor(c2.buf, 'workbench.tabs', 'C1→C2 receive', 10000);
  check('C1(local)→C2(VPS): tabs received', !!r1.tabs && r1.tabs.length === 2);
  check('C1→C2: tab_a title=terminal', r1.tabs[0]?.title === 'terminal');
  check('C1→C2: tab_b viewType=files', r1.tabs[1]?.viewType === 'files');
  check('C1→C2: IDs match', r1.tabs[0]?.id === 'tab_a' && r1.tabs[1]?.id === 'tab_b');

  // Verify no echo to C1
  await delay(500);
  const c1Tabs = c1.buf.filter(s => { try { const m = JSON.parse(s); return m.type === 'workbench.tabs'; } catch { return false; } });
  if (c1Tabs.length > 0) {
    try { console.log('  [DEBUG] C1 echo:', JSON.parse(c1Tabs[0]).type, JSON.parse(c1Tabs[0]).body?.tabs?.length); } catch {}
  }
  check('C1(sender) no echo from upstream', c1Tabs.length === 0);

  console.log();

  // 4. C2(VPS) → C1(Local): create different tabs
  const tabs2 = [
    { id: 'tab_c', title: 'system-info', viewType: 'system-info', instanceId: null },
    { id: 'tab_d', title: 'output',      viewType: 'output',      instanceId: 'inst_2' },
  ];
  c2.ws.send(env('workbench.tabs', { nodeId: NODE_ID, tabs: tabs2 }));

  const r2 = await waitFor(c1.buf, 'workbench.tabs', 'C2→C1 receive', 10000);
  check('C2(VPS)→C1(local): tabs received', !!r2.tabs && r2.tabs.length === 2);
  check('C2→C1: tab_c title=system-info', r2.tabs[0]?.title === 'system-info');
  check('C2→C1: tab_d viewType=output', r2.tabs[1]?.viewType === 'output');
  check('C2→C1: IDs match', r2.tabs[0]?.id === 'tab_c' && r2.tabs[1]?.id === 'tab_d');

  // Verify no echo to C2
  await delay(500);
  const c2Tabs = c2.buf.filter(s => { try { const m = JSON.parse(s); return m.type === 'workbench.tabs'; } catch { return false; } });
  if (c2Tabs.length > 0) {
    try { console.log('  [DEBUG] C2 echo:', JSON.parse(c2Tabs[0]).type, JSON.parse(c2Tabs[0]).body?.tabs?.length); } catch {}
  }
  check('C2(sender) no echo from downstream', c2Tabs.length === 0);

  console.log();

  // 5. New client subscribes on VPS — should get latest tabs (from C2's update)
  const c3 = await connect(VPS, 'C3(VPS)');
  c3.ws.send(env('workbench.subscribe', { nodeId: NODE_ID }));
  const r3 = await waitFor(c3.buf, 'workbench.tabs', 'C3 on VPS re-subscribe', 5000);
  check('C3(VPS) gets persisted tabs (from C2)', r3.tabs?.length === 2);
  check('C3 tabs are C2 version', r3.tabs[0]?.id === 'tab_c');

  // 6. New subscriber on local — should get same tabs (persisted via upstream forwarding)
  const c4 = await connect(LOCAL, 'C4(local)');
  c4.ws.send(env('workbench.subscribe', { nodeId: NODE_ID }));
  const r4 = await waitFor(c4.buf, 'workbench.tabs', 'C4 on local re-subscribe', 5000);
  check('C4(local) gets persisted tabs (from C2 via upstream sync)', r4.tabs?.length === 2);
  check('C4 tabs are C2 version', r4.tabs[0]?.id === 'tab_c');

  console.log();

  // Cleanup
  c1.ws.close();
  c2.ws.close();
  c3.ws.close();
  c4.ws.close();
  await delay(300);

  console.log(`\n===== RESULTS: ${passed} passed, ${failed} failed =====`);
  if (failed === 0) console.log('  ✅ ALL CROSS-RELAY TESTS PASSED\n');
  else console.log(`  ❌ ${failed} test(s) failed\n`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
