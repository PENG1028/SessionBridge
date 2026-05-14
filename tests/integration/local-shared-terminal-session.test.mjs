// ─── Local Shared Terminal Session Test ─────────────────────
// Validates: two browsers connected to the same relay share a local
// shell instance — same instanceId, same I/O stream.
//
// Architecture:
//   Browser A ──┐
//               ├── Relay ── Local Shell (same relay machine)
//   Browser B ──┘
//
// Test cases (6):
//   T1: Tab sync with instanceId — A sends workbench.tabs, B receives same tab
//   T2: Shared output — A spawns shell, B also spawns same instance, both get output
//   T3: A input → B sees output
//   T4: B input → A sees output
//   T5: Late joiner C gets tab state + output replay
//   T6: Bad instanceId returns INSTANCE_NOT_FOUND (no local fallback)
//
// Usage:
//   node tests/integration/local-shared-terminal-session.test.mjs [ws://host:port]
//   Default: ws://localhost:9000

import WebSocket from 'ws';

const delay = ms => new Promise(r => setTimeout(r, ms));
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

const RELAY_WS = process.argv[2] || 'ws://localhost:9000';
const RELAY_HTTP = RELAY_WS.replace(/^ws/, 'http');

let passed = 0, failed = 0, total = 0;
function check(desc, ok) {
  total++;
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}

// ── Helpers ──────────────────────────────────────────────────

async function connectBrowser(label) {
  const ws = new WebSocket(RELAY_WS);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));

  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: ['crypto_v1', 'shell'],
    cols: 120, rows: 40, workspace: true,
    clientToken: `local_integ_${label}_${Date.now()}`,
  }));

  return { ws, inbox };
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

function drain(inbox, type) {
  const msgs = [];
  for (let i = inbox.length - 1; i >= 0; i--) {
    try {
      const m = JSON.parse(inbox[i]);
      const msg = m.v === 1 && m.body ? { ...m.body, type: m.type } : m;
      if (msg.type === type) {
        msgs.unshift(msg);
        inbox.splice(i, 1);
      }
    } catch {}
  }
  return msgs;
}

async function collectOutputUntilPrompt(inbox, timeout = 8000) {
  const chunks = [];
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const found = drain(inbox, 'shell.output');
    for (const m of found) {
      const data = typeof m.data === 'string' ? m.data : '';
      chunks.push(data);
    }
    const full = chunks.join('');
    const clean = full.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r?\n/g, '\n');
    if (clean.match(/[$#>]\s*$/m) || clean.includes('$ ') || clean.includes('> ')) {
      break;
    }
    if (found.length === 0) await delay(200);
  }
  return chunks;
}

async function listInstances() {
  try {
    const res = await fetch(`${RELAY_HTTP}/api/instances`);
    const data = await res.json();
    return data.instances || [];
  } catch { return []; }
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log(`\n===== Local Shared Terminal Session Test =====`);
  console.log(`  Relay: ${RELAY_WS}\n`);

  // Synthetic nodeId — NEVER pollute __local__
  const nodeId = `test_node_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  let shellInstanceId = null;
  let createdByTest = false;
  const conns = []; // track all connections for cleanup

  try {
    // ── Pre: Create shell instance via REST API ──────────────
    try {
      const res = await fetch(`${RELAY_HTTP}/api/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: process.cwd(), label: 'test-local-shared-term', adapterId: 'shell' }),
      });
      const data = await res.json();
      if (data.success) {
        shellInstanceId = data.instance.id;
        createdByTest = true;
        console.log(`  Created shell instance: ${shellInstanceId.slice(0, 20)}...\n`);
      }
    } catch (err) {
      console.log(`  [WARN] REST API unavailable: ${err.message}\n`);
    }

    if (!shellInstanceId) {
      // Fallback: look for existing shell instance (NOT created by test — won't be deleted)
      const insts = await listInstances();
      const shellInst = insts.find(i => i.adapterId === 'shell');
      if (shellInst) { shellInstanceId = shellInst.id; createdByTest = false; }
      if (!shellInstanceId) {
        console.log('  [FATAL] No shell instance available. Is the relay running with a shell adapter?\n');
        process.exit(1);
      }
      console.log(`  Using existing shell instance: ${shellInstanceId.slice(0, 20)}...\n`);
    }

    const initialInstances = await listInstances();
    const initialCount = initialInstances.length;

    // ── T1: Tab sync with instanceId ─────────────────────────
    console.log('── T1: Tab sync — A sends tabs, B receives same tab with same instanceId ──');

    const a = await connectBrowser('A'); conns.push(a);
    const b = await connectBrowser('B'); conns.push(b);

    await waitFor(a.inbox, m => m.type === 'welcome', 'A welcome');
    await waitFor(b.inbox, m => m.type === 'welcome', 'B welcome');

    // Both subscribe to the synthetic test node
    a.ws.send(env('workbench.subscribe', { nodeId }));
    b.ws.send(env('workbench.subscribe', { nodeId }));

    // Each gets initial tabs (should be empty for synthetic node)
    const aTabsMsg = await waitFor(a.inbox, m => m.type === 'workbench.tabs' && m.nodeId === nodeId, 'A initial tabs');
    const bTabsMsg = await waitFor(b.inbox, m => m.type === 'workbench.tabs' && m.nodeId === nodeId, 'B initial tabs');
    check('A initial tabs empty (synthetic node)', (aTabsMsg.tabs || []).length === 0);
    check('B initial tabs empty (synthetic node)', (bTabsMsg.tabs || []).length === 0);

    const testTab = {
      id: 'term-test-1',
      title: 'Test Terminal',
      viewType: 'terminal',
      instanceId: shellInstanceId,
    };

    // A sends workbench.tabs with terminal tab
    a.ws.send(env('workbench.tabs', { nodeId, tabs: [testTab] }));

    // B should receive the same tabs
    const bSynced = await waitFor(b.inbox, m =>
      m.type === 'workbench.tabs' && m.nodeId === nodeId,
    'B receives synced tabs');

    const bTermTab = (bSynced.tabs || []).find(t => t.viewType === 'terminal');
    check('B received terminal tab', !!bTermTab);
    check('B terminal tab has same instanceId', bTermTab?.instanceId === shellInstanceId);
    check('B terminal tab has same id', bTermTab?.id === 'term-test-1');

    // ── T2: Shared output — both spawn same instance ─────────
    console.log('\n── T2: Shared output — both spawn same instance, both get output ──');

    drain(a.inbox, 'shell.output');
    drain(b.inbox, 'shell.output');

    // A spawns shell
    a.ws.send(env('shell.spawn', { instanceId: shellInstanceId }));
    // B ALSO spawns the same shell instance to subscribe to shell output
    b.ws.send(env('shell.spawn', { instanceId: shellInstanceId }));

    // Both should get output
    let aOutput = null, bOutput = null;
    try { aOutput = await waitFor(a.inbox, m => m.type === 'shell.output', 'A shell.output', 10000); } catch (e) {}
    try { bOutput = await waitFor(b.inbox, m => m.type === 'shell.output', 'B shell.output', 10000); } catch (e) {}

    check('A received shell.output after spawn', !!aOutput);
    check('B received shell.output after spawn (shared subscription)', !!bOutput);

    const aChunks = await collectOutputUntilPrompt(a.inbox, 5000);
    const bChunks = await collectOutputUntilPrompt(b.inbox, 5000);
    check('Both A and B received shell output', aChunks.length > 0 && bChunks.length > 0);

    // ── T3: A input → B sees output ─────────────────────────
    console.log('\n── T3: A inputs command → B sees the output ──');

    drain(a.inbox, 'shell.output');
    drain(b.inbox, 'shell.output');

    const marker3 = `T3_MARKER_${Date.now()}`;
    const cmd3 = process.platform === 'win32'
      ? `echo ${marker3}\r\n`
      : `echo ${marker3}\n`;

    a.ws.send(env('shell.input', { instanceId: shellInstanceId, data: cmd3 }));

    const bChunks3 = await collectOutputUntilPrompt(b.inbox, 6000);
    const bText3 = bChunks3.join('').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    check('B sees output from A\'s input', bText3.includes(marker3));

    // ── T4: B input → A sees output ─────────────────────────
    console.log('\n── T4: B inputs command → A sees the output ──');

    drain(a.inbox, 'shell.output');
    drain(b.inbox, 'shell.output');

    const marker4 = `T4_MARKER_${Date.now()}`;
    const cmd4 = process.platform === 'win32'
      ? `echo ${marker4}\r\n`
      : `echo ${marker4}\n`;

    b.ws.send(env('shell.input', { instanceId: shellInstanceId, data: cmd4 }));

    const aChunks4 = await collectOutputUntilPrompt(a.inbox, 6000);
    const aText4 = aChunks4.join('').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    check('A sees output from B\'s input', aText4.includes(marker4));

    // ── T5: Late joiner C ───────────────────────────────────
    console.log('\n── T5: Late joiner C gets tab state + output replay ──');

    const c = await connectBrowser('C'); conns.push(c);
    await waitFor(c.inbox, m => m.type === 'welcome', 'C welcome');

    c.ws.send(env('workbench.subscribe', { nodeId }));

    const cTabsMsg = await waitFor(c.inbox, m => m.type === 'workbench.tabs' && m.nodeId === nodeId, 'C tabs');
    const cTermTab = (cTabsMsg.tabs || []).find(t => t.viewType === 'terminal');
    check('C received terminal tab on subscribe', !!cTermTab);
    check('C terminal tab has correct instanceId', cTermTab?.instanceId === shellInstanceId);

    // C spawns shell to get output replay
    c.ws.send(env('shell.spawn', { instanceId: shellInstanceId }));
    const cChunks = await collectOutputUntilPrompt(c.inbox, 8000);
    check('C received output replay from existing shell', cChunks.length > 0);

    // ── T6: Bad instanceId returns INSTANCE_NOT_FOUND ────────
    console.log('\n── T6: Bad instanceId returns INSTANCE_NOT_FOUND (no local fallback) ──');

    const badId = 'inst_deadbeef_nonexistent_999';
    a.ws.send(env('shell.spawn', { instanceId: badId }));

    let gotNotFound = false;
    let gotInternalError = false;
    try {
      const errMsg = await waitFor(a.inbox, m =>
        m.type === 'error' && m.code === 'INSTANCE_NOT_FOUND',
      'INSTANCE_NOT_FOUND error', 8000);
      gotNotFound = true;
      check('INSTANCE_NOT_FOUND error received', true);
      check('Error message contains bad instanceId', (errMsg.message || '').includes(badId));
    } catch {
      // Check any error
      const errs = drain(a.inbox, 'error');
      gotNotFound = errs.some(e => e.code === 'INSTANCE_NOT_FOUND');
      gotInternalError = errs.some(e => e.code === 'INTERNAL_ERROR');
      if (errs.length > 0) {
        console.log(`  Got error(s): ${errs.map(e => `${e.code}: ${e.message}`).join(', ')}`);
      }
      check('INSTANCE_NOT_FOUND error received', gotNotFound);
    }
    if (gotNotFound) {
      // Verify no extra INTERNAL_ERROR was sent for the same failure
      const remainingErrs = drain(a.inbox, 'error');
      const extraInternal = remainingErrs.filter(e => e.code === 'INTERNAL_ERROR');
      check('No extra INTERNAL_ERROR after INSTANCE_NOT_FOUND', extraInternal.length === 0 && !gotInternalError);
    }

    // Verify no new instance was created
    const afterBadIdInstances = await listInstances();
    const badInst = afterBadIdInstances.find(i => i.id === badId);
    check('No instance created for bad instanceId', !badInst);
    check('Instance count unchanged after bad spawn', afterBadIdInstances.length === initialCount);

    // ── T7: Double spawn reconnects, doesn't create duplicate ──
    console.log('\n── T7: Double spawn same instanceId reconnects, no duplicate ──');

    const beforeDupInstances = await listInstances();
    const beforeIds = new Set(beforeDupInstances.map(i => i.id));

    drain(a.inbox, 'shell.output');
    b.ws.send(env('shell.spawn', { instanceId: shellInstanceId }));
    const bReconnectChunks = await collectOutputUntilPrompt(b.inbox, 5000);
    check('B reconnected and got output', bReconnectChunks.length > 0);

    const afterDupInstances = await listInstances();
    const afterIds = new Set(afterDupInstances.map(i => i.id));

    // Same set of instance IDs, no new ones
    const newIds = [...afterIds].filter(id => !beforeIds.has(id));
    check('No new instance created on double spawn', newIds.length === 0);
    check('Instance list unchanged', afterDupInstances.length === beforeDupInstances.length);

  } finally {
    // ── Cleanup ──────────────────────────────────────────────
    console.log('\n── Cleanup ──');
    // Clear workbenchTabStore entry for synthetic nodeId (best-effort)
    try {
      const a = conns[0];
      if (a && a.ws.readyState === WebSocket.OPEN) {
        a.ws.send(env('workbench.tabs', { nodeId, tabs: [] }));
      }
    } catch {}
    for (const c of conns) {
      try { c.ws.close(); } catch {}
    }
    if (shellInstanceId && createdByTest) {
      try {
        await fetch(`${RELAY_HTTP}/api/instances/${shellInstanceId}`, { method: 'DELETE' });
        console.log(`  Deleted test instance: ${shellInstanceId.slice(0, 20)}...`);
      } catch { console.log('  (could not delete test instance via API)'); }
    } else if (shellInstanceId && !createdByTest) {
      console.log(`  (not deleting pre-existing instance: ${shellInstanceId.slice(0, 20)}...)`);
    }
    await delay(200);
  }

  console.log(`\n===== RESULTS: ${passed}/${total} passed, ${failed}/${total} failed =====`);
  if (failed === 0) console.log('  ✅ ALL LOCAL SHARED TERMINAL TESTS PASSED\n');
  else console.log(`  ❌ ${failed} test(s) failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
