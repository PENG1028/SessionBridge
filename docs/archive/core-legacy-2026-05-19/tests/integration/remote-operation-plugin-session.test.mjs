// ─── Remote Plugin Operation Test ────────────────────────────
// Validates: unified operation.start protocol for non-terminal
// remote execution (plugin commands, adapter commands, tasks).
//
// Architecture:
//   Browser A ──┐
//               ├── Relay ── Mock Agent (simulates remote B device)
//   Browser B ──┘
//
//   The mock agent supports a fake "mock-echo" plugin.
//   Browser A starts a plugin operation on B's node.
//   The relay validates the target, forwards to agent, and
//   broadcasts output/status/result to all subscribers.
//
// Test cases (11):
//   T1: Agent registers as remote device
//   T2: operation.start kind=plugin → relay validates + forwards to agent
//   T3: Agent receives relay.operation.start with correct fields
//   T4: Agent sends agent.operation.output → A and B receive operation.output
//   T5: Agent sends agent.operation.result → A and B receive operation.result
//   T6: B also subscribes → B receives same operation.output
//   T7: Late joiner C gets replay via operation.subscribe
//   T8: Browser D (no subscribe) does NOT receive operation.output
//   T9: bad nodeId → TARGET_NOT_FOUND
//   T10: Agent disconnected → AGENT_DISCONNECTED
//   T11: operation without nodeId → MISSING_NODE error
//
// Usage:
//   node tests/integration/remote-operation-plugin-session.test.mjs [ws://host:port]
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
    clientToken: `plugin_integ_${label}_${Date.now()}`,
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
    features: ['shell', 'crypto_v1'],
    label, adapterId,
  }));
  return { ws, inbox, label };
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

// ── Main ─────────────────────────────────────────────────────

async function main() {
  console.log(`\n===== Remote Plugin Operation Test =====`);
  console.log(`  Relay: ${RELAY_WS}\n`);

  const conns = [];
  let remoteInstanceId = null;
  let operationsCreated = 0; // track for cleanup

  try {
    // ── T1: Agent registers as remote device ────────────────
    console.log('── T1: Agent registers as remote device ──');

    const agent = await connectAgent('PLUGIN-AGENT', 'shell');
    conns.push(agent);

    await waitFor(agent.inbox, m => m.type === 'welcome', 'Agent welcome');

    agent.ws.send(env('agent.register', {
      dir: process.cwd(),
      label: 'PLUGIN-AGENT',
      adapterId: 'shell',
    }));

    const agentReg = await waitFor(agent.inbox, m => m.type === 'agent.registered', 'Agent registered');
    remoteInstanceId = agentReg.instanceId;
    operationsCreated++;
    check('Agent registered with instanceId', !!remoteInstanceId);
    console.log(`  Remote instanceId: ${remoteInstanceId.slice(0, 20)}...`);

    const beforeBadIds = new Set((await listInstances()).map(i => i.id));
    const initialInstanceIds = new Set(beforeBadIds);

    // ── Connect browsers ────────────────────────────────────
    const a = await connectBrowser('A'); conns.push(a);
    const b = await connectBrowser('B'); conns.push(b);

    await waitFor(a.inbox, m => m.type === 'welcome', 'A welcome');
    await waitFor(b.inbox, m => m.type === 'welcome', 'B welcome');

    const nodeId = remoteInstanceId;
    a.ws.send(env('workbench.subscribe', { nodeId }));
    b.ws.send(env('workbench.subscribe', { nodeId }));
    await waitFor(a.inbox, m => m.type === 'workbench.tabs' && m.nodeId === nodeId, 'A tabs');
    await waitFor(b.inbox, m => m.type === 'workbench.tabs' && m.nodeId === nodeId, 'B tabs');

    // Browser D — will NOT subscribe to the operation
    const d = await connectBrowser('D'); conns.push(d);
    await waitFor(d.inbox, m => m.type === 'welcome', 'D welcome');
    d.ws.send(env('workbench.subscribe', { nodeId }));
    await waitFor(d.inbox, m => m.type === 'workbench.tabs' && m.nodeId === nodeId, 'D tabs');

    // ── T2: operation.start kind=plugin ─────────────────────
    console.log('\n── T2: operation.start kind=plugin → relay validates + forwards to agent ──');

    drain(agent.inbox, 'relay.operation.start');
    drain(a.inbox, 'operation.status');

    a.ws.send(env('operation.start', {
      nodeId: remoteInstanceId,
      kind: 'plugin',
      pluginId: 'mock-echo',
      command: 'echo',
      input: { text: 'hello-from-A' },
    }));

    // Relay should validate the target and forward to agent
    const relayOpStart = await waitFor(agent.inbox, m =>
      m.type === 'relay.operation.start',
    'Agent receives relay.operation.start', 8000);
    check('Agent received relay.operation.start', !!relayOpStart);
    const pluginOperationId = relayOpStart.operationId;
    check('relay.operation.start has operationId', typeof pluginOperationId === 'string');

    // ── T3: relay.operation.start has correct fields ────────
    console.log('\n── T3: relay.operation.start contains correct fields ──');

    check('relay.operation.start kind = plugin', relayOpStart?.kind === 'plugin');
    check('relay.operation.start pluginId = mock-echo', relayOpStart?.pluginId === 'mock-echo');
    check('relay.operation.start command = echo', relayOpStart?.command === 'echo');
    check('relay.operation.start has input', relayOpStart?.input?.text === 'hello-from-A');
    check('relay.operation.start has dir', typeof relayOpStart?.dir === 'string');

    // A should get operation.status starting→running
    const aOpStatus1 = await waitFor(a.inbox, m =>
      m.type === 'operation.status' && m.status === 'starting',
    'A receives operation.status starting', 5000);
    check('A received operation.status = starting', !!aOpStatus1);
    check('operation.status kind = plugin', aOpStatus1?.kind === 'plugin');

    const aOpStatus2 = await waitFor(a.inbox, m =>
      m.type === 'operation.status' && m.status === 'running',
    'A receives operation.status running', 5000);
    check('A received operation.status = running', !!aOpStatus2);

    // ── B subscribes to the operation ───────────────────────
    console.log('\n── B subscribes to the same operation ──');

    drain(b.inbox, 'operation.status');
    b.ws.send(env('operation.subscribe', { operationId: pluginOperationId }));

    const bOpStatus = await waitFor(b.inbox, m =>
      m.type === 'operation.status' && m.operationId === pluginOperationId,
    'B receives operation.status on subscribe', 5000);
    check('B received operation.status on subscribe', !!bOpStatus);

    // ── T4: Agent sends operation.output → A/B receive ──────
    console.log('\n── T4: Agent sends agent.operation.output → A and B receive operation.output ──');

    drain(a.inbox, 'operation.output');
    drain(b.inbox, 'operation.output');
    drain(d.inbox, 'operation.output');

    agent.ws.send(env('agent.operation.output', {
      operationId: pluginOperationId,
      stream: 'structured',
      data: JSON.stringify({ echo: 'hello-from-A' }),
    }));

    const aOut = await waitFor(a.inbox, m =>
      m.type === 'operation.output' && m.operationId === pluginOperationId,
    'A receives operation.output', 5000);
    const bOut = await waitFor(b.inbox, m =>
      m.type === 'operation.output' && m.operationId === pluginOperationId,
    'B receives operation.output', 5000);

    check('A received operation.output', !!aOut);
    check('B received operation.output (shared!)', !!bOut);
    check('A output stream = structured', aOut?.stream === 'structured');
    check('B output stream = structured', bOut?.stream === 'structured');

    // ── T5: Agent sends operation.result → A/B receive ──────
    console.log('\n── T5: Agent sends agent.operation.result → A/B receive operation.result + status completed ──');

    drain(a.inbox, 'operation.result');
    drain(b.inbox, 'operation.result');
    drain(a.inbox, 'operation.status');
    drain(b.inbox, 'operation.status');

    agent.ws.send(env('agent.operation.result', {
      operationId: pluginOperationId,
      success: true,
      data: { echo: 'hello-from-A', timestamp: Date.now() },
      exitCode: 0,
    }));

    const aResult = await waitFor(a.inbox, m =>
      m.type === 'operation.result' && m.operationId === pluginOperationId,
    'A receives operation.result', 5000);
    const bResult = await waitFor(b.inbox, m =>
      m.type === 'operation.result' && m.operationId === pluginOperationId,
    'B receives operation.result', 5000);
    check('A received operation.result (success=true)', aResult?.success === true);
    check('B received operation.result (success=true)', bResult?.success === true);

    // Both should also get operation.status = completed
    const aCompleted = await waitFor(a.inbox, m =>
      m.type === 'operation.status' && m.status === 'completed',
    'A receives operation.status completed', 5000);
    const bCompleted = await waitFor(b.inbox, m =>
      m.type === 'operation.status' && m.status === 'completed',
    'B receives operation.status completed', 5000);
    check('A received status = completed', !!aCompleted);
    check('B received status = completed', !!bCompleted);

    // ── T6: B also starts a plugin operation (bidirectional) ──
    console.log('\n── T6: B starts plugin operation → agent receives relay.operation.start ──');

    drain(agent.inbox, 'relay.operation.start');
    drain(b.inbox, 'operation.status');

    b.ws.send(env('operation.start', {
      nodeId: remoteInstanceId,
      kind: 'plugin',
      pluginId: 'mock-echo',
      command: 'status',
      input: { query: 'uptime' },
    }));

    const relayOpStart6 = await waitFor(agent.inbox, m =>
      m.type === 'relay.operation.start' && m.command === 'status',
    'Agent receives relay.operation.start from B', 8000);
    check('Agent received relay.operation.start from B', !!relayOpStart6);
    check('B\'s operation has different operationId', relayOpStart6?.operationId !== pluginOperationId);

    const bOpStatus6 = await waitFor(b.inbox, m =>
      m.type === 'operation.status' && m.status === 'running' && m.operationId === relayOpStart6.operationId,
    'B receives operation.status for own operation', 5000);
    check('B received operation.status for own operation', !!bOpStatus6);

    // Complete B's operation
    agent.ws.send(env('agent.operation.result', {
      operationId: relayOpStart6.operationId,
      success: true,
      data: { uptime: '2h 15m' },
    }));
    await delay(200);

    // ── T7: Late joiner C gets replay via operation.subscribe ──
    console.log('\n── T7: Late joiner C gets replay via operation.subscribe ──');

    // Start a fresh operation with output history for C to replay
    drain(agent.inbox, 'relay.operation.start');
    a.ws.send(env('operation.start', {
      nodeId: remoteInstanceId,
      kind: 'plugin',
      pluginId: 'mock-echo',
      command: 'multi-output',
      input: { steps: 3 },
    }));

    const relayOpStart7 = await waitFor(agent.inbox, m =>
      m.type === 'relay.operation.start' && m.command === 'multi-output',
    'Agent receives relay.operation.start for replay test', 8000);
    const replayOpId = relayOpStart7.operationId;

    // Agent emits multiple output messages
    agent.ws.send(env('agent.operation.output', { operationId: replayOpId, stream: 'structured', data: JSON.stringify({ step: 1 }) }));
    agent.ws.send(env('agent.operation.output', { operationId: replayOpId, stream: 'structured', data: JSON.stringify({ step: 2 }) }));
    agent.ws.send(env('agent.operation.output', { operationId: replayOpId, stream: 'structured', data: JSON.stringify({ step: 3 }) }));
    await delay(200);

    // Late joiner C connects and subscribes
    const c = await connectBrowser('C'); conns.push(c);
    await waitFor(c.inbox, m => m.type === 'welcome', 'C welcome');

    drain(c.inbox, 'operation.status');
    drain(c.inbox, 'operation.output');

    c.ws.send(env('operation.subscribe', { operationId: replayOpId }));

    // C should get operation.status first (replay)
    const cStatus = await waitFor(c.inbox, m =>
      m.type === 'operation.status' && m.operationId === replayOpId,
    'C receives operation.status on subscribe', 5000);
    check('C received operation.status (replay)', !!cStatus);

    // C should get buffered output replay (3 messages)
    await delay(300);
    const cReplayOutput = drain(c.inbox, 'operation.output');
    check('C received operation.output replay', cReplayOutput.length >= 3);

    // C should also get future live output
    drain(a.inbox, 'operation.output');
    drain(c.inbox, 'operation.output');
    agent.ws.send(env('agent.operation.output', { operationId: replayOpId, stream: 'structured', data: JSON.stringify({ step: 'live' }) }));

    const cLive = await waitFor(c.inbox, m =>
      m.type === 'operation.output' && (m.data || '').includes('live'),
    'C receives live operation.output', 5000);
    check('C received live operation.output (not just replay)', !!cLive);

    // Complete replay operation
    agent.ws.send(env('agent.operation.result', { operationId: replayOpId, success: true }));
    await delay(200);

    // ── T8: Browser D does NOT receive operation.output ──────
    console.log('\n── T8: Browser D (no subscribe) does NOT receive operation.output ──');

    drain(agent.inbox, 'relay.operation.start');
    drain(d.inbox, 'operation.output');
    drain(d.inbox, 'operation.status');
    drain(a.inbox, 'operation.output');
    drain(a.inbox, 'operation.status');

    a.ws.send(env('operation.start', {
      nodeId: remoteInstanceId,
      kind: 'plugin',
      pluginId: 'mock-echo',
      command: 'scoped-test',
    }));

    const relayOpStart8 = await waitFor(agent.inbox, m =>
      m.type === 'relay.operation.start' && m.command === 'scoped-test',
    'Agent receives relay.operation.start for scope test', 8000);

    // A subscribes and receives output. D shouldn't.
    a.ws.send(env('operation.subscribe', { operationId: relayOpStart8.operationId }));
    await delay(100);
    drain(a.inbox, 'operation.output');
    drain(d.inbox, 'operation.output');

    agent.ws.send(env('agent.operation.output', { operationId: relayOpStart8.operationId, stream: 'structured', data: JSON.stringify({ scoped: true }) }));

    const aScoped = await waitFor(a.inbox, m =>
      m.type === 'operation.output' && m.operationId === relayOpStart8.operationId,
    'A receives scoped output', 5000);
    check('A (subscribed) receives scoped output', !!aScoped);

    await delay(300);
    const dScoped = drain(d.inbox, 'operation.output');
    const dFiltered = dScoped.filter(m => m.operationId === relayOpStart8.operationId);
    check('Browser D (no subscribe) does NOT receive scoped operation.output', dFiltered.length === 0);

    // Complete
    agent.ws.send(env('agent.operation.result', { operationId: relayOpStart8.operationId, success: true }));

    // ── T9: bad nodeId → TARGET_NOT_FOUND ───────────────────
    console.log('\n── T9: Bad nodeId → TARGET_NOT_FOUND ──');

    const badNodeId = 'inst_deadbeef_plugin_nonexistent';
    drain(a.inbox, 'error');
    a.ws.send(env('operation.start', {
      nodeId: badNodeId,
      kind: 'plugin',
      pluginId: 'mock-echo',
      command: 'echo',
    }));

    let gotTargetNotFound = false;
    try {
      const errMsg = await waitFor(a.inbox, m =>
        m.type === 'error' && m.code === 'TARGET_NOT_FOUND',
      'TARGET_NOT_FOUND', 8000);
      gotTargetNotFound = true;
      check('TARGET_NOT_FOUND received for bad nodeId', true);
      check('Error message mentions bad nodeId', (errMsg.message || '').includes(badNodeId));
    } catch {
      const errs = drain(a.inbox, 'error');
      console.log(`  Errors: ${errs.map(e => `${e.code}: ${e.message}`).join(', ')}`);
      gotTargetNotFound = errs.some(e => e.code === 'TARGET_NOT_FOUND');
      check('TARGET_NOT_FOUND received', gotTargetNotFound);
    }

    // No new instance created
    const afterBadIds = new Set((await listInstances()).map(i => i.id));
    const newIds = [...afterBadIds].filter(id => !beforeBadIds.has(id));
    check('No local instance created for bad nodeId', newIds.length === 0);

    // ── T10: Agent disconnected → error, no fallback ─────
    // After agent disconnects, the relay auto-cleans up the instance.
    // Either AGENT_DISCONNECTED (race: instance exists, agent dead) or
    // TARGET_NOT_FOUND (instance cleaned). Key invariant: no fallback.
    console.log('\n── T10: Agent disconnected → error, no local fallback ──');

    const beforeDiscIds = new Set((await listInstances()).map(i => i.id));

    agent.ws.close();
    await delay(500);

    drain(a.inbox, 'error');
    a.ws.send(env('operation.start', {
      nodeId: remoteInstanceId,
      kind: 'plugin',
      pluginId: 'mock-echo',
      command: 'echo',
    }));

    let gotDisconnected = false;
    try {
      const errMsg = await waitFor(a.inbox, m =>
        m.type === 'error' && (m.code === 'AGENT_DISCONNECTED' || m.code === 'TARGET_NOT_FOUND'),
      'AGENT_DISCONNECTED or TARGET_NOT_FOUND', 8000);
      gotDisconnected = true;
      check('Error received after disconnect',
        errMsg.code === 'AGENT_DISCONNECTED' || errMsg.code === 'TARGET_NOT_FOUND');
      console.log(`  Got: ${errMsg.code}`);
    } catch {
      const errs = drain(a.inbox, 'error');
      console.log(`  Errors: ${errs.map(e => `${e.code}: ${e.message}`).join(', ')}`);
      gotDisconnected = errs.some(e => e.code === 'AGENT_DISCONNECTED' || e.code === 'TARGET_NOT_FOUND');
      check('Error received after disconnect', gotDisconnected);
    }

    // No fallback instance
    const afterDiscIds = new Set((await listInstances()).map(i => i.id));
    const discNewIds = [...afterDiscIds].filter(id => !beforeDiscIds.has(id));
    check('No local instance created after disconnected operation.start', discNewIds.length === 0);

    // ── T11: Missing nodeId → MISSING_NODE ──────────────────
    console.log('\n── T11: operation.start without nodeId → MISSING_NODE ──');

    drain(a.inbox, 'error');
    a.ws.send(env('operation.start', { kind: 'plugin', pluginId: 'mock-echo' }));

    const missErr = await waitFor(a.inbox, m =>
      m.type === 'error' && m.code === 'MISSING_NODE',
    'MISSING_NODE', 5000);
    check('MISSING_NODE received when nodeId missing', !!missErr);

  } finally {
    console.log('\n── Cleanup ──');
    for (const c of conns) {
      try { c.ws.close(); } catch {}
    }
    if (remoteInstanceId) {
      try { await fetch(`${RELAY_HTTP}/api/instances/${remoteInstanceId}`, { method: 'DELETE' }); } catch {}
    }
    await delay(200);
  }

  console.log(`\n===== RESULTS: ${passed}/${total} passed, ${failed}/${total} failed =====`);
  if (failed === 0) console.log('  ✅ ALL PLUGIN OPERATION TESTS PASSED\n');
  else console.log(`  ❌ ${failed} test(s) failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
