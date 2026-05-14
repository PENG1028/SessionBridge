import WebSocket from 'ws';

const delay = ms => new Promise(r => setTimeout(r, ms));
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

async function testRelay(label, url) {
  console.log(`\n========================================`);
  console.log(`  Testing: ${label}`);
  console.log(`  URL:     ${url}`);
  console.log(`========================================\n`);

  const ws1 = new WebSocket(url);
  const ws2 = new WebSocket(url);
  const buf1 = [], buf2 = [];

  ws1.on('message', d => buf1.push(d.toString()));
  ws2.on('message', d => buf2.push(d.toString()));

  await Promise.all([
    new Promise(r => ws1.on('open', r)),
    new Promise(r => ws2.on('open', r)),
  ]);

  function send(ws, type, body) { ws.send(env(type, body)); }

  async function waitFor(inbox, type, timeout = 5000) {
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
    throw new Error(`[${label}] Timeout ${type}`);
  }

  const nodeId = 'sync_test_' + Date.now();
  const passed = [], failed = [];

  function check(desc, ok) { (ok ? passed : failed).push(desc); console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`); }

  try {
    // Auth
    send(ws1, 'hello', { role: 'browser', version: '0.6.0', features: [], cols: 120, rows: 40, workspace: true, clientToken: 't1_'+Date.now() });
    send(ws2, 'hello', { role: 'browser', version: '0.6.0', features: [], cols: 120, rows: 40, workspace: true, clientToken: 't2_'+Date.now() });
    await waitFor(buf1, 'welcome');
    await waitFor(buf2, 'welcome');
    console.log('  [OK] Both authenticated\n');

    // Both subscribe
    send(ws1, 'workbench.subscribe', { nodeId });
    send(ws2, 'workbench.subscribe', { nodeId });
    await waitFor(buf1, 'workbench.tabs');
    await waitFor(buf2, 'workbench.tabs');
    console.log('  [OK] Both subscribed\n');

    // ── Test 1: C1 creates tabs, verify C2 receives ──
    const testTabs1 = [
      { id: 'tab_a', title: 'terminal', viewType: 'terminal', instanceId: 'inst_1' },
      { id: 'tab_b', title: 'files', viewType: 'files', instanceId: null },
    ];
    send(ws1, 'workbench.tabs', { nodeId, tabs: testTabs1 });

    const recv1 = await waitFor(buf2, 'workbench.tabs');
    check('C1→C2: correct tab count', recv1.tabs.length === 2);
    check('C1→C2: tab_a title matches', recv1.tabs[0].title === 'terminal');
    check('C1→C2: tab_b viewType matches', recv1.tabs[1].viewType === 'files');
    check('C1→C2: tab IDs match', recv1.tabs[0].id === 'tab_a' && recv1.tabs[1].id === 'tab_b');

    // Verify no echo to sender
    await delay(300);
    const echo1 = buf1.filter(s => { try { return JSON.parse(s).type === 'workbench.tabs'; } catch { return false; } }).length;
    check('C1 no echo', echo1 === 0);

    // Verify C2 has exactly 2 tabs (no duplicate broadcasts)
    const totalC2Tabs = buf2.filter(s => { try { return JSON.parse(s).type === 'workbench.tabs'; } catch { return false; } }).length;
    check('C2 no extra broadcasts', totalC2Tabs === 0); // the one we got was already consumed by waitFor

    // ── Test 2: C2 creates different tabs, verify C1 receives ──
    const testTabs2 = [
      { id: 'tab_c', title: 'system-info', viewType: 'system-info', instanceId: null },
    ];
    send(ws2, 'workbench.tabs', { nodeId, tabs: testTabs2 });

    const recv2 = await waitFor(buf1, 'workbench.tabs');
    check('C2→C1: correct tab count', recv2.tabs.length === 1);
    check('C2→C1: tab title matches', recv2.tabs[0].title === 'system-info');
    check('C2→C1: tab_id matches', recv2.tabs[0].id === 'tab_c');

    // ── Test 3: New client subscribes, gets stored tabs (persistence) ──
    const ws3 = new WebSocket(url);
    const buf3 = [];
    ws3.on('message', d => buf3.push(d.toString()));
    await new Promise(r => ws3.on('open', r));
    send(ws3, 'hello', { role: 'browser', version: '0.6.0', features: [], cols: 120, rows: 40, workspace: true, clientToken: 't3_'+Date.now() });
    await waitFor(buf3, 'welcome');

    send(ws3, 'workbench.subscribe', { nodeId });
    const stored = await waitFor(buf3, 'workbench.tabs');
    check('C3 re-subscribe gets stored tabs (1 tab from C2)', stored.tabs.length === 1);
    check('C3 stored tab title matches', stored.tabs[0].title === 'system-info');
    check('C3 stored tab id matches', stored.tabs[0].id === 'tab_c');

    // ── Test 4: Re-subscribe after unsub ──
    send(ws1, 'workbench.unsubscribe', { nodeId });
    await delay(300);
    send(ws3, 'workbench.unsubscribe', { nodeId });
    await delay(300);
    send(ws2, 'workbench.unsubscribe', { nodeId });
    await delay(300);

    // Fresh subscribe should still get stored tabs
    const ws4 = new WebSocket(url);
    const buf4 = [];
    ws4.on('message', d => buf4.push(d.toString()));
    await new Promise(r => ws4.on('open', r));
    send(ws4, 'hello', { role: 'browser', version: '0.6.0', features: [], cols: 120, rows: 40, workspace: true, clientToken: 't4_'+Date.now() });
    await waitFor(buf4, 'welcome');
    send(ws4, 'workbench.subscribe', { nodeId });
    const stored2 = await waitFor(buf4, 'workbench.tabs');
    check('C4 fresh subscribe gets stored tabs', stored2.tabs.length === 1);
    check('C4 stored tabs survive unsub', stored2.tabs[0].id === 'tab_c');

    ws3.close();
    ws4.close();
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
  }

  ws1.close();
  ws2.close();

  console.log(`\n  Results: ${passed.length} passed, ${failed.length} failed`);
  if (failed.length > 0) {
    console.log(`  FAILED: ${failed.join(', ')}`);
  }
  return { passed: passed.length, failed: failed.length };
}

async function main() {
  const results = [];
  results.push(await testRelay('Local Relay', 'ws://localhost:8080'));
  await delay(1000);
  results.push(await testRelay('VPS Relay', 'ws://43.160.241.180:8080'));

  console.log(`\n\n========================================`);
  console.log(`  OVERALL SUMMARY`);
  console.log(`========================================`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const label = i === 0 ? 'Local Relay' : 'VPS Relay';
    console.log(`  ${label}: ${r.passed}/${r.passed + r.failed} passed`);
  }
  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalFailed = results.reduce((s, r) => s + r.failed, 0);
  console.log(`  Total: ${totalPassed}/${totalPassed + totalFailed} passed`);
  if (totalFailed === 0) console.log(`\n  ✅ ALL TESTS PASSED`);
  else console.log(`\n  ❌ ${totalFailed} test(s) failed`);
}

main().catch(console.error);
