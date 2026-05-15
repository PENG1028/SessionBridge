// ─── VPS Workbench Tab Sync Test ─────────────────────────────
// Verifies that workbench.tabs propagate correctly between
// browser connections through the VPS relay.
//
// Usage:
//   node tests/integration/vps-tab-sync.test.mjs [ws://host:port]
//   Default: ws://43.160.241.180:8080

import WebSocket from 'ws';

const RELAY_WS = process.argv[2] || 'ws://43.160.241.180:8080';
const delay = ms => new Promise(r => setTimeout(r, ms));
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

let passed = 0, failed = 0;
function check(desc, ok) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}

async function connect(label) {
  const ws = new WebSocket(RELAY_WS);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: [],
    cols: 120, rows: 40, workspace: true,
    clientToken: `${label}_${Date.now()}`,
  }));
  return { ws, inbox, label };
}

async function waitFor(inbox, pred, label, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (let i = 0; i < inbox.length; i++) {
      try {
        const m = JSON.parse(inbox[i]);
        const msg = m.v === 1 && m.body ? { ...m.body, type: m.type } : m;
        if (pred(msg)) { inbox.splice(i, 1); return msg; }
      } catch {}
    }
    await delay(50);
  }
  throw new Error(`Timeout: ${label}`);
}

async function main() {
  console.log(`\n===== VPS Tab Sync Test =====`);
  console.log(`  Relay: ${RELAY_WS}\n`);

  const nodeId = 'tab_sync_test_' + Date.now();
  console.log(`  NodeId: ${nodeId}`);

  // Connect two browsers
  const A = await connect('A');
  const B = await connect('B');
  await waitFor(A.inbox, m => m.type === 'welcome', 'A welcome');
  await waitFor(B.inbox, m => m.type === 'welcome', 'B welcome');
  check('Both browsers connected', true);

  // T1: Subscribe both to the same nodeId
  console.log('\n── T1: Subscribe to node, receive empty tabs ──');
  A.ws.send(env('workbench.subscribe', { nodeId }));
  B.ws.send(env('workbench.subscribe', { nodeId }));

  const aTabs = await waitFor(A.inbox, m => m.type === 'workbench.tabs' && m.nodeId === nodeId, 'A tabs');
  check('A gets workbench.tabs on subscribe', !!aTabs);
  check('A tabs is empty array', Array.isArray(aTabs.tabs) && aTabs.tabs.length === 0);

  // T2: A sends tabs → B receives them
  console.log('\n── T2: A sends tabs → B receives sync ──');

  // Clear inboxes
  A.inbox.length = 0;
  B.inbox.length = 0;

  const testTabs = [
    { id: 'tab-1', title: 'Terminal 1', viewType: 'terminal', instanceId: 'inst-test-1' },
    { id: 'tab-2', title: 'Editor', viewType: 'editor', instanceId: 'inst-test-2' },
    { id: 'tab-3', title: 'Settings', viewType: 'settings' },
  ];

  A.ws.send(env('workbench.tabs', { nodeId, tabs: testTabs }));

  const bSync = await waitFor(B.inbox, m =>
    m.type === 'workbench.tabs' && m.nodeId === nodeId, 'B sync', 8000);
  check('B receives workbench.tabs from A sync', !!bSync);
  check('B received 3 tabs', Array.isArray(bSync.tabs) && bSync.tabs.length === 3);

  const tab1 = (bSync.tabs || []).find(t => t.id === 'tab-1');
  check('B tab-1 title preserved', tab1?.title === 'Terminal 1');
  check('B tab-1 viewType preserved', tab1?.viewType === 'terminal');
  check('B tab-1 instanceId preserved', tab1?.instanceId === 'inst-test-1');

  const tab2 = (bSync.tabs || []).find(t => t.id === 'tab-2');
  check('B tab-2 title preserved', tab2?.title === 'Editor');
  check('B tab-2 viewType preserved', tab2?.viewType === 'editor');

  const tab3 = (bSync.tabs || []).find(t => t.id === 'tab-3');
  check('B tab-3 title preserved', tab3?.title === 'Settings');

  // T3: A updates tabs → B gets update
  console.log('\n── T3: A updates tabs (remove one) → B gets update ──');

  A.inbox.length = 0;
  B.inbox.length = 0;

  const updatedTabs = [
    { id: 'tab-1', title: 'Terminal 1 (modified)', viewType: 'terminal', instanceId: 'inst-test-1' },
    { id: 'tab-3', title: 'Settings', viewType: 'settings' },
  ];

  A.ws.send(env('workbench.tabs', { nodeId, tabs: updatedTabs }));

  const bUpdate = await waitFor(B.inbox, m =>
    m.type === 'workbench.tabs' && m.nodeId === nodeId, 'B update', 8000);
  check('B receives updated tabs', !!bUpdate);
  check('B updated tabs count = 2', Array.isArray(bUpdate.tabs) && bUpdate.tabs.length === 2);
  check('B tab-1 title updated',
    (bUpdate.tabs || []).find(t => t.id === 'tab-1')?.title === 'Terminal 1 (modified)');
  check('B tab-2 removed', !(bUpdate.tabs || []).find(t => t.id === 'tab-2'));

  // T4: Late subscriber C gets stored tabs
  console.log('\n── T4: Late subscriber gets stored tabs ──');
  const C = await connect('C');
  await waitFor(C.inbox, m => m.type === 'welcome', 'C welcome');
  C.ws.send(env('workbench.subscribe', { nodeId }));

  const cTabs = await waitFor(C.inbox, m =>
    m.type === 'workbench.tabs' && m.nodeId === nodeId, 'C tabs', 8000);
  check('C receives stored tabs on subscribe', !!cTabs);
  check('C gets 2 tabs', Array.isArray(cTabs.tabs) && cTabs.tabs.length === 2);

  // T5: Different nodeId has independent tabs
  console.log('\n── T5: Different nodeId has independent tabs ──');
  const otherNode = 'other_node_' + Date.now();

  A.inbox.length = 0;
  B.inbox.length = 0;

  B.ws.send(env('workbench.subscribe', { nodeId: otherNode }));
  const bOther = await waitFor(B.inbox, m =>
    m.type === 'workbench.tabs' && m.nodeId === otherNode, 'B other node', 8000);
  check('B gets empty tabs for new nodeId', Array.isArray(bOther.tabs) && bOther.tabs.length === 0);

  A.ws.send(env('workbench.subscribe', { nodeId: otherNode }));
  await delay(100);
  A.inbox.length = 0;
  B.inbox.length = 0;

  const otherTabs = [{ id: 'other-1', title: 'Other Tab', viewType: 'terminal' }];
  A.ws.send(env('workbench.tabs', { nodeId: otherNode, tabs: otherTabs }));

  const bOtherSync = await waitFor(B.inbox, m =>
    m.type === 'workbench.tabs' && m.nodeId === otherNode, 'B other sync', 8000);
  check('B receives tabs for other nodeId', !!bOtherSync);
  check('B other tabs has 1 tab', Array.isArray(bOtherSync.tabs) && bOtherSync.tabs.length === 1);
  check('B other tab title correct',
    (bOtherSync.tabs || [])[0]?.title === 'Other Tab');

  // T6: Unsubscribe stops sync
  console.log('\n── T6: Unsubscribe stops sync ──');
  B.ws.send(env('workbench.unsubscribe', { nodeId }));

  A.inbox.length = 0;
  B.inbox.length = 0;

  A.ws.send(env('workbench.tabs', { nodeId, tabs: testTabs }));

  // B should NOT receive tabs after unsubscribe
  let bGotTabs = false;
  try {
    await waitFor(B.inbox, m =>
      m.type === 'workbench.tabs' && m.nodeId === nodeId, 'B should not get tabs', 3000);
    bGotTabs = true;
  } catch { /* expected */ }
  check('B does NOT receive tabs after unsubscribe', !bGotTabs);

  // Cleanup: send empty tabs
  A.ws.send(env('workbench.tabs', { nodeId, tabs: [] }));
  A.ws.send(env('workbench.tabs', { nodeId: otherNode, tabs: [] }));
  await delay(100);

  [A, B, C].forEach(c => { try { c.ws.close(); } catch {} });

  console.log(`\n===== RESULTS: ${passed}/${passed + failed} passed =====`);
  if (failed) {
    console.log(`  FAIL: ${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`  PASS: All VPS tab sync tests passed`);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
