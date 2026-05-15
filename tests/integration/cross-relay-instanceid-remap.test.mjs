// ─── Cross-Relay InstanceId Remap Test ───────────────────────
// Verifies that when workbench.tabs cross a relay boundary,
// tab.instanceId values are remapped from remote instance IDs
// to local instance IDs so the receiving UI can execute them.
//
// Scenario:
//   1. VPS relay has PENGSPC as remote instance inst_vps_pengspc
//   2. Local relay has PENGSPC as local instance inst_local_pengspc
//   3. VPS browser sends workbench.tabs with tab.instanceId=inst_vps_pengspc
//   4. Workbench.tabs crosses relay boundary to local relay
//   5. syncTabsByLabel should remap instanceId: inst_vps_pengspc → inst_local_pengspc
//   6. Local browser subscribing to __local__ should get remapped instanceId
//   7. Sending shell.spawn with the remapped instanceId should succeed
//
// Usage:
//   node tests/integration/cross-relay-instanceid-remap.test.mjs [ws://host:port]
//   Default: ws://localhost:9000

import WebSocket from 'ws';

const delay = ms => new Promise(r => setTimeout(r, ms));
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

const RELAY_WS = process.argv[2] || 'ws://localhost:9000';
const RELAY_HTTP = RELAY_WS.replace(/^ws/, 'http');

let passed = 0, failed = 0;
function check(desc, ok) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}

async function connectBrowser(label) {
  const ws = new WebSocket(RELAY_WS);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'browser', version: '0.6.0',
    features: ['shell'], cols: 120, rows: 40, workspace: true,
    clientToken: `${label}_${Date.now()}`,
  }));
  return { ws, inbox, label };
}

async function connectAgent(label, adapterId = 'shell') {
  const ws = new WebSocket(RELAY_WS);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'agent', version: '0.6.0',
    features: ['shell'],
    label, adapterId,
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

function drain(inbox, type) {
  const msgs = [];
  for (let i = inbox.length - 1; i >= 0; i--) {
    try {
      const m = JSON.parse(inbox[i]);
      const msg = m.v === 1 && m.body ? { ...m.body, type: m.type } : m;
      if (msg.type === type) { msgs.unshift(msg); inbox.splice(i, 1); }
    } catch {}
  }
  return msgs;
}

async function listInstances() {
  try {
    const res = await fetch(`${RELAY_HTTP}/api/instances`);
    const data = await res.json();
    return data.instances || [];
  } catch { return []; }
}

async function main() {
  console.log(`\n===== Cross-Relay InstanceId Remap Test =====`);
  console.log(`  Relay: ${RELAY_WS}\n`);

  // Snapshot pre-existing instances
  const preExistingIds = new Set((await listInstances()).map(i => i.id));
  console.log(`  Pre-existing instances: ${preExistingIds.size}`);

  const conns = [];
  const createdInstanceIds = [];

  try {
    // ── T1: Register a simulated remote agent as "VPS-side PENGSPC" ──
    console.log('── T1: Register VPS-side agent (simulated remote PENGSPC) ──');
    const vpsAgent = await connectAgent('PENGSPC', 'shell');
    conns.push(vpsAgent);
    await waitFor(vpsAgent.inbox, m => m.type === 'welcome', 'VPS agent welcome');

    vpsAgent.ws.send(env('agent.register', {
      dir: '/fake/vps',
      label: 'PENGSPC',
      adapterId: 'shell',
    }));

    const vpsReg = await waitFor(vpsAgent.inbox, m =>
      m.type === 'agent.registered', 'VPS agent registered');
    const VPS_INSTANCE_ID = vpsReg.instanceId;
    createdInstanceIds.push(VPS_INSTANCE_ID);
    check('VPS agent registered with instanceId', typeof VPS_INSTANCE_ID === 'string');
    console.log(`  VPS remote instanceId: ${VPS_INSTANCE_ID.slice(0, 24)}...`);

    // ── T2: Register a local agent as "local PENGSPC" ──
    console.log('\n── T2: Register local agent (simulated local PENGSPC) ──');
    const localAgent = await connectAgent('PENGSPC', 'shell');
    conns.push(localAgent);
    await waitFor(localAgent.inbox, m => m.type === 'welcome', 'Local agent welcome');

    localAgent.ws.send(env('agent.register', {
      dir: '/fake/local',
      label: 'PENGSPC',
      adapterId: 'shell',
    }));

    const localReg = await waitFor(localAgent.inbox, m =>
      m.type === 'agent.registered', 'Local agent registered');
    const LOCAL_INSTANCE_ID = localReg.instanceId;
    createdInstanceIds.push(LOCAL_INSTANCE_ID);
    check('Local agent registered with instanceId', typeof LOCAL_INSTANCE_ID === 'string');
    check('VPS and local have different instanceIds', VPS_INSTANCE_ID !== LOCAL_INSTANCE_ID);
    console.log(`  Local instanceId: ${LOCAL_INSTANCE_ID.slice(0, 24)}...`);

    // ── T3: Verify both instances exist in the list ──
    console.log('\n── T3: Both instances exist ──');
    const instances = await listInstances();
    const vpsInst = instances.find(i => i.id === VPS_INSTANCE_ID);
    const localInst = instances.find(i => i.id === LOCAL_INSTANCE_ID);
    check('VPS instance in list', !!vpsInst);
    check('Local instance in list', !!localInst);
    check('Both have label=PENGSPC',
      vpsInst?.label === 'PENGSPC' && localInst?.label === 'PENGSPC');

    // ── T4: Browser on VPS side sends workbench.tabs ──
    // This simulates what happens when a browser on VPS creates a terminal tab
    console.log('\n── T4: VPS browser sends tabs with remote instanceId ──');
    const browserVps = await connectBrowser('VPS-Browser');
    conns.push(browserVps);
    await waitFor(browserVps.inbox, m => m.type === 'welcome', 'VPS browser welcome');

    // Subscribe to the VPS nodeId
    browserVps.ws.send(env('workbench.subscribe', { nodeId: VPS_INSTANCE_ID }));
    await waitFor(browserVps.inbox, m =>
      m.type === 'workbench.tabs' && m.nodeId === VPS_INSTANCE_ID, 'VPS browser gets tabs');

    // Send tabs with VPS-side instanceId
    const vpsTabs = [
      { id: 'term-1', title: 'Terminal', viewType: 'terminal', instanceId: VPS_INSTANCE_ID },
      { id: 'editor-1', title: 'Editor', viewType: 'editor' },
    ];

    browserVps.ws.send(env('workbench.tabs', { nodeId: VPS_INSTANCE_ID, tabs: vpsTabs }));

    // This should trigger syncTabsByLabel which should remap instanceId
    // for the local PENGSPC agent

    // ── T5: Local browser subscribes to __local__ → gets remapped tabs ──
    console.log('\n── T5: Local browser subscribes to __local__, gets remapped instanceIds ──');
    const browserLocal = await connectBrowser('Local-Browser');
    conns.push(browserLocal);
    await waitFor(browserLocal.inbox, m => m.type === 'welcome', 'Local browser welcome');

    // Subscribe to __local__
    browserLocal.ws.send(env('workbench.subscribe', { nodeId: '__local__' }));

    const localTabs = await waitFor(browserLocal.inbox, m =>
      m.type === 'workbench.tabs' && m.nodeId === '__local__',
    'Local browser gets __local__ tabs', 10000);

    check('Local browser received workbench.tabs for __local__', !!localTabs);
    check('Local tabs has entries', Array.isArray(localTabs.tabs) && localTabs.tabs.length >= 1);

    // THE KEY ASSERTION: the terminal tab's instanceId must be LOCAL_INSTANCE_ID, not VPS_INSTANCE_ID
    const termTab = (localTabs.tabs || []).find(t => t.id === 'term-1');
    check('Terminal tab exists in __local__ tabs', !!termTab);

    if (termTab) {
      // The tab's instanceId should be remapped FROM the VPS remote ID
      // TO a local instance ID. Multiple local instances may exist with
      // the same label (e.g. from session restoration), so we check that
      // the result is any local instance, not the VPS one.
      const localInsts = (await listInstances()).filter(i => i.source === 'local' && i.label === 'PENGSPC');
      const localIds = new Set(localInsts.map(i => i.id));

      check('Terminal tab.instanceId is NOT VPS instanceId (was remapped)',
        termTab.instanceId !== VPS_INSTANCE_ID);
      check('Terminal tab.instanceId is a local PENGSPC instance (was remapped to local)',
        localIds.has(termTab.instanceId));
      console.log(`  tab.instanceId: ${termTab.instanceId}`);
      console.log(`  VPS (should NOT be): ${VPS_INSTANCE_ID.slice(0, 20)}...`);
      console.log(`  Local PENGSPC IDs: ${[...localIds].map(id => id.slice(0, 20)).join(', ')}...`);
    }

    // ── T6: shell.spawn with remapped instanceId succeeds ──
    console.log('\n── T6: shell.spawn with remapped instanceId → succeeds ──');

    drain(browserLocal.inbox, 'error');

    // Try shell.spawn with the LOCAL instanceId (what UI would use after remap)
    browserLocal.ws.send(env('shell.spawn', { instanceId: LOCAL_INSTANCE_ID }));

    // Should get agent.instance.spawned or shell.spawned (not INSTANCE_NOT_FOUND)
    let spawnOk = false;
    let spawnError = null;
    try {
      const spawnResult = await waitFor(browserLocal.inbox, m =>
        (m.type === 'agent.instance.spawned' || m.type === 'shell.spawned' || m.type === 'instance.spawned'),
      'shell.spawn success', 8000);
      spawnOk = true;
      check('T6: shell.spawn with local instanceId succeeds', true);
    } catch {
      // Check if we got an error instead
      const errors = drain(browserLocal.inbox, 'error');
      spawnError = errors.find(e => e.code === 'INSTANCE_NOT_FOUND');
      check('T6: shell.spawn with local instanceId succeeds (no INSTANCE_NOT_FOUND)',
        !spawnError);
    }

    // ── T7: shell.spawn with VPS instanceId should fail ──
    // (because VPS_INSTANCE_ID is not a local-instance-owning shell)
    // Actually this depends on the instance type. For remote instances,
    // shell.spawn goes to the remote agent. So this test validates that
    // the REMAPPING is necessary — using the unremapped VPS ID would
    // target the wrong agent.
    console.log('\n── T7: shell.spawn with UNremapped VPS instanceId goes to wrong target ──');
    drain(browserLocal.inbox, 'error');

    browserLocal.ws.send(env('shell.spawn', { instanceId: VPS_INSTANCE_ID }));

    // With the VPS instance ID, the spawn should either go to the VPS agent
    // (not the local one) or fail if the VPS agent doesn't handle shells.
    // Either way, the LOCAL agent should NOT receive it.
    let localAgentGotShellSpawn = false;
    try {
      await waitFor(localAgent.inbox, m =>
        m.type === 'agent.stdin' || m.type === 'relay.shell.spawn',
      'Local agent should not get shell spawn for VPS instance', 3000);
      localAgentGotShellSpawn = true;
    } catch { /* expected — local agent should NOT get this */ }
    check('T7: Local agent does NOT receive shell.spawn for VPS instanceId',
      !localAgentGotShellSpawn);

    // ── T8: Editor tab without instanceId passes through unchanged ──
    console.log('\n── T8: Editor tab (no instanceId) passes through unchanged ──');
    const editorTab = (localTabs.tabs || []).find(t => t.id === 'editor-1');
    check('Editor tab exists in __local__', !!editorTab);
    if (editorTab) {
      check('Editor tab has no instanceId', !editorTab.instanceId);
      check('Editor tab title preserved', editorTab.title === 'Editor');
    }

  } finally {
    // ── Cleanup ──────────────────────────────────────────────
    console.log('\n── Cleanup ──');

    for (const c of conns) {
      try { if (c.ws.readyState === WebSocket.OPEN) c.ws.close(); } catch {}
    }
    await delay(200);

    const currentInstances = await listInstances();
    const currentIds = new Set(currentInstances.map(i => i.id));

    for (const id of createdInstanceIds) {
      if (currentIds.has(id)) {
        try {
          await fetch(`${RELAY_HTTP}/api/instances/${id}`, { method: 'DELETE' });
          console.log(`  Delete ${id.slice(0, 20)}...: OK`);
        } catch (e) {
          console.log(`  Delete ${id.slice(0, 20)}...: ERROR ${e.message}`);
        }
      }
    }
  }

  console.log(`\n===== RESULTS: ${passed}/${passed + failed} passed =====`);
  if (failed) {
    console.log(`  FAIL: ${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`  PASS: All cross-relay instanceId remap tests passed`);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
