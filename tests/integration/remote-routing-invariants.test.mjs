// ─── Remote Routing Invariants Test ───────────────────────────
// Validates the 6 global invariants that ALL remote operations
// must obey. These are enforced at ONE choke point
// (RemoteOperationManager.validateTarget) and apply to terminal,
// plugin, adapter_command, and task operations equally.
//
// Invariants tested:
//   I1: TARGET_NOT_FOUND / INSTANCE_NOT_FOUND → no local fallback
//   I2: AGENT_DISCONNECTED / REMOTE_AGENT_DISCONNECTED → no silent success
//   I3: All remote output scoped to operationId/instanceId subscribers
//   I4: No global broadcast() used for operation output
//   I5: workbench.tabs preserves instanceId
//   I6: Late subscriber gets full replay (status + outputBuffer + result)
//
// Safety rules:
//   - All test nodeIds use test_ prefix; no __local__ or real inst_xxx
//   - All tests wrapped in try/finally with cleanup
//   - Only test-created instances are deleted
//
// Usage:
//   node tests/integration/remote-routing-invariants.test.mjs [ws://host:port]
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
    clientToken: `invariants_${label}_${Date.now()}`,
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
  console.log(`\n===== Remote Routing Invariants Test =====`);
  console.log(`  Relay: ${RELAY_WS}\n`);

  const conns = [];
  let testInstanceId = null;    // the agent's registered instanceId
  let createdInstanceIds = [];  // track for safe cleanup

  // Snapshot pre-existing instances so we only delete our own
  const preExistingIds = new Set((await listInstances()).map(i => i.id));
  console.log(`  Pre-existing instances: ${preExistingIds.size}`);

  try {
    // ── T1: Agent registers as remote device ────────────────
    console.log('── T1: Agent registers as remote device ──');

    const agent = await connectAgent('TEST-INVARIANTS-AGENT', 'shell');
    conns.push(agent);

    await waitFor(agent.inbox, m => m.type === 'welcome', 'Agent welcome');

    agent.ws.send(env('agent.register', {
      dir: process.cwd(),
      label: 'TEST-INVARIANTS-AGENT',
      adapterId: 'shell',
    }));

    const agentReg = await waitFor(agent.inbox, m =>
      m.type === 'agent.registered', 'Agent registered');
    testInstanceId = agentReg.instanceId;
    createdInstanceIds.push(testInstanceId);

    check('Agent registered with instanceId', typeof testInstanceId === 'string' && testInstanceId.length > 0);
    console.log(`  Test remote instanceId: ${testInstanceId.slice(0, 20)}...`);

    // Verify it appears in instance list
    const instsAfterReg = await listInstances();
    const remoteInst = instsAfterReg.find(i => i.id === testInstanceId);
    check('Remote instance in instance list', !!remoteInst);
    check('Remote instance source = "remote"', remoteInst?.source === 'remote');

    // Connect browsers
    const a = await connectBrowser('A'); conns.push(a);
    const b = await connectBrowser('B'); conns.push(b);

    await waitFor(a.inbox, m => m.type === 'welcome', 'A welcome');
    await waitFor(b.inbox, m => m.type === 'welcome', 'B welcome');

    const nodeId = testInstanceId;
    a.ws.send(env('workbench.subscribe', { nodeId }));
    b.ws.send(env('workbench.subscribe', { nodeId }));
    await waitFor(a.inbox, m => m.type === 'workbench.tabs' && m.nodeId === nodeId, 'A tabs');
    await waitFor(b.inbox, m => m.type === 'workbench.tabs' && m.nodeId === nodeId, 'B tabs');

    // ── I3+I4: Scoped broadcast — operation.output only to subscribers ──
    console.log('\n── I3: Scoped broadcast — operation.output only to subscribers ──');
    console.log('── I4: No global broadcast() for operation output ──');

    drain(agent.inbox, 'relay.operation.start');

    // A starts operation; A is auto-subscribed. B does NOT subscribe.
    a.ws.send(env('operation.start', {
      nodeId,
      kind: 'plugin',
      pluginId: 'invariant-test-plugin',
      command: 'scoped-echo',
      input: { text: 'scoped-test-data' },
    }));

    const relayOpStart = await waitFor(agent.inbox, m =>
      m.type === 'relay.operation.start',
    'Agent receives relay.operation.start', 8000);
    const scopedOpId = relayOpStart.operationId;
    check('Agent received relay.operation.start', !!scopedOpId);

    // Wait for operation.status on A
    const aStatusRunning = await waitFor(a.inbox, m =>
      m.type === 'operation.status' && m.status === 'running',
    'A receives operation.status running', 5000);
    check('A receives operation.status = running', !!aStatusRunning);

    // Clear inboxes before scoped output test
    drain(a.inbox, 'operation.output');
    drain(b.inbox, 'operation.output');
    drain(b.inbox, 'operation.status');
    drain(b.inbox, 'operation.result');

    // Agent emits output. Only A (subscriber) should receive it.
    agent.ws.send(env('agent.operation.output', {
      operationId: scopedOpId,
      stream: 'structured',
      data: JSON.stringify({ result: 'scoped-output-1' }),
    }));

    // A (subscribed) receives it
    const aOut1 = await waitFor(a.inbox, m =>
      m.type === 'operation.output' && m.operationId === scopedOpId,
    'A receives operation.output (subscriber)', 5000);
    check('A (subscriber) received operation.output', !!aOut1);
    check('A output data correct', (aOut1.data || '').includes('scoped-output-1'));

    // B (NOT subscribed) must NOT receive it
    await delay(300);
    const bScopedOutput = drain(b.inbox, 'operation.output');
    const bFiltered = bScopedOutput.filter(m => m.operationId === scopedOpId);
    check('B (no subscribe) does NOT receive scoped operation.output', bFiltered.length === 0);

    // B also must NOT receive operation.status updates for this operation
    const bScopedStatus = drain(b.inbox, 'operation.status');
    const bStatusFiltered = bScopedStatus.filter(m => m.operationId === scopedOpId);
    check('B (no subscribe) does NOT receive scoped operation.status', bStatusFiltered.length === 0);

    // Agent emits more output — B still must not receive it
    agent.ws.send(env('agent.operation.output', {
      operationId: scopedOpId,
      stream: 'stdout',
      data: 'extra output line\n',
    }));

    const aOut2 = await waitFor(a.inbox, m =>
      m.type === 'operation.output' && m.operationId === scopedOpId && (m.data || '').includes('extra'),
    'A receives second operation.output', 5000);
    check('A (subscriber) received second operation.output', !!aOut2);

    await delay(200);
    const bScopedOutput2 = drain(b.inbox, 'operation.output');
    const bFiltered2 = bScopedOutput2.filter(m => m.operationId === scopedOpId);
    check('B still does NOT receive scoped operation.output (second message)', bFiltered2.length === 0);

    // Agent emits result
    drain(a.inbox, 'operation.result');
    drain(a.inbox, 'operation.status');
    drain(b.inbox, 'operation.result');
    drain(b.inbox, 'operation.status');

    agent.ws.send(env('agent.operation.result', {
      operationId: scopedOpId,
      success: true,
      data: { echoed: 'scoped-test-data' },
      exitCode: 0,
    }));

    const aResult = await waitFor(a.inbox, m =>
      m.type === 'operation.result' && m.operationId === scopedOpId,
    'A receives operation.result', 5000);
    check('A (subscriber) received operation.result', aResult?.success === true);

    const aCompleted = await waitFor(a.inbox, m =>
      m.type === 'operation.status' && m.status === 'completed' && m.operationId === scopedOpId,
    'A receives operation.status completed', 5000);
    check('A received status = completed', !!aCompleted);

    await delay(200);
    const bResult = drain(b.inbox, 'operation.result');
    const bResultFiltered = bResult.filter(m => m.operationId === scopedOpId);
    check('B (no subscribe) does NOT receive operation.result', bResultFiltered.length === 0);

    // ── I6a: Late subscriber replay (in-progress operation) ──
    console.log('\n── I6a: Late subscriber replay — buffered output + live output ──');

    // Start a fresh operation with output history
    drain(agent.inbox, 'relay.operation.start');

    a.ws.send(env('operation.start', {
      nodeId,
      kind: 'plugin',
      pluginId: 'invariant-replay-plugin',
      command: 'multi-step',
    }));

    const relayOpReplay = await waitFor(agent.inbox, m =>
      m.type === 'relay.operation.start' && m.command === 'multi-step',
    'Agent receives relay.operation.start for replay', 8000);
    const replayOpId = relayOpReplay.operationId;
    check('Replay operation created', !!replayOpId);

    // A is auto-subscribed; get status
    await waitFor(a.inbox, m =>
      m.type === 'operation.status' && m.operationId === replayOpId && m.status === 'running',
    'A gets operation.status running', 5000);

    // Agent emits 3 buffered output messages
    drain(a.inbox, 'operation.output');
    agent.ws.send(env('agent.operation.output', { operationId: replayOpId, stream: 'structured', data: JSON.stringify({ seq: 1 }) }));
    agent.ws.send(env('agent.operation.output', { operationId: replayOpId, stream: 'structured', data: JSON.stringify({ seq: 2 }) }));
    agent.ws.send(env('agent.operation.output', { operationId: replayOpId, stream: 'structured', data: JSON.stringify({ seq: 3 }) }));
    await delay(200);

    // Verify A got them
    const aBuffered = drain(a.inbox, 'operation.output');
    check('A received 3 buffered outputs', aBuffered.filter(m => m.operationId === replayOpId).length >= 3);

    // Late joiner C connects
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
    check('C replay status = running', cStatus?.status === 'running');

    // C should get buffered output replay (3 messages)
    await delay(300);
    const cReplayOutput = drain(c.inbox, 'operation.output');
    const cReplayFiltered = cReplayOutput.filter(m => m.operationId === replayOpId);
    check('C received buffered output replay', cReplayFiltered.length >= 3);
    check('C replay seq values ascending', (() => {
      const seqs = cReplayFiltered.map(m => m.seq).filter(s => typeof s === 'number');
      for (let i = 1; i < seqs.length; i++) {
        if (seqs[i] <= seqs[i - 1]) return false;
      }
      return seqs.length >= 3;
    })());

    // C should also get live output after subscribing
    drain(a.inbox, 'operation.output');
    drain(c.inbox, 'operation.output');

    agent.ws.send(env('agent.operation.output', { operationId: replayOpId, stream: 'structured', data: JSON.stringify({ seq: 'live' }) }));

    const cLive = await waitFor(c.inbox, m =>
      m.type === 'operation.output' && m.operationId === replayOpId && (m.data || '').includes('live'),
    'C receives live output after subscribe', 5000);
    check('C received live output (not just replay)', !!cLive);

    // Complete the operation
    agent.ws.send(env('agent.operation.result', { operationId: replayOpId, success: true, data: { steps: 4 } }));
    await delay(200);

    // ── I6b: Late subscriber replay for completed operation ──
    console.log('\n── I6b: Late subscriber replay — completed operation includes result ──');

    // Start another operation and complete it immediately
    drain(agent.inbox, 'relay.operation.start');

    a.ws.send(env('operation.start', {
      nodeId,
      kind: 'plugin',
      pluginId: 'invariant-completed-plugin',
      command: 'fast-job',
    }));

    const relayOpDone = await waitFor(agent.inbox, m =>
      m.type === 'relay.operation.start' && m.command === 'fast-job',
    'Agent receives relay.operation.start for completed replay', 8000);
    const completedOpId = relayOpDone.operationId;

    // A gets status
    await waitFor(a.inbox, m =>
      m.type === 'operation.status' && m.operationId === completedOpId && m.status === 'running',
    'A gets status running for fast-job', 5000);

    // Agent emits output + result immediately
    drain(a.inbox, 'operation.output');
    agent.ws.send(env('agent.operation.output', { operationId: completedOpId, stream: 'stdout', data: 'fast-job-output-1\n' }));
    agent.ws.send(env('agent.operation.output', { operationId: completedOpId, stream: 'stdout', data: 'fast-job-output-2\n' }));
    await delay(100);
    agent.ws.send(env('agent.operation.result', {
      operationId: completedOpId,
      success: true,
      data: { fast: true },
      exitCode: 0,
    }));
    await delay(200);

    // Confirm A got result + completed status
    const aDoneResult = drain(a.inbox, 'operation.result');
    const aDoneStatus = drain(a.inbox, 'operation.status');
    check('A received completed operation result',
      aDoneResult.some(m => m.operationId === completedOpId && m.success === true));
    check('A received completed operation status',
      aDoneStatus.some(m => m.operationId === completedOpId && m.status === 'completed'));

    // Late joiner D connects AFTER operation completed
    const d_browser = await connectBrowser('D'); conns.push(d_browser);
    await waitFor(d_browser.inbox, m => m.type === 'welcome', 'D welcome');

    drain(d_browser.inbox, 'operation.status');
    drain(d_browser.inbox, 'operation.output');
    drain(d_browser.inbox, 'operation.result');

    d_browser.ws.send(env('operation.subscribe', { operationId: completedOpId }));

    // D must get: operation.status (completed) + outputBuffer replay + operation.result
    const dStatus = await waitFor(d_browser.inbox, m =>
      m.type === 'operation.status' && m.operationId === completedOpId,
    'D receives operation.status on subscribe (completed op)', 5000);
    check('D received operation.status for completed operation', !!dStatus);
    check('D status = completed', dStatus?.status === 'completed');

    // D must get output replay
    await delay(300);
    const dOutputs = drain(d_browser.inbox, 'operation.output');
    const dOutputFiltered = dOutputs.filter(m => m.operationId === completedOpId);
    check('D received output replay for completed operation', dOutputFiltered.length >= 2);
    check('D output contains fast-job-output', dOutputFiltered.some(m => (m.data || '').includes('fast-job-output')));

    // D must get result
    const dResult = drain(d_browser.inbox, 'operation.result');
    const dResultFiltered = dResult.filter(m => m.operationId === completedOpId);
    check('D received operation.result for completed operation', dResultFiltered.length >= 1);
    check('D result success = true', dResultFiltered.some(m => m.success === true));

    // ── I5: workbench.tabs preserves instanceId ──────────────
    console.log('\n── I5: workbench.tabs preserves instanceId ──');

    drain(a.inbox, 'workbench.tabs');
    drain(b.inbox, 'workbench.tabs');

    const verifyTab = {
      id: 'invariants-tab-1',
      title: 'Invariants Test Tab',
      viewType: 'terminal',
      instanceId: testInstanceId,
    };

    a.ws.send(env('workbench.tabs', { nodeId, tabs: [verifyTab] }));

    const bTabs = await waitFor(b.inbox, m =>
      m.type === 'workbench.tabs' && m.nodeId === nodeId,
    'B receives workbench.tabs', 5000);
    check('B received workbench.tabs sync', !!bTabs);

    const bReceivedTab = (bTabs.tabs || []).find(t => t.id === 'invariants-tab-1');
    check('B received tab with same id', !!bReceivedTab);
    check('B tab instanceId preserved', bReceivedTab?.instanceId === testInstanceId);
    check('B tab title preserved', bReceivedTab?.title === 'Invariants Test Tab');
    check('B tab viewType preserved', bReceivedTab?.viewType === 'terminal');

    // NOTE: The relay does NOT echo tabs back to the sender
    // (broadcastTabs excludes the sending ws). This is correct behavior
    // — otherwise the sender would get its own tabs back as a loop.

    // Send empty tabs to clean up workbench tab store for this node
    a.ws.send(env('workbench.tabs', { nodeId, tabs: [] }));
    await delay(100);

    // ── T8+I1: TARGET_NOT_FOUND for operation.start ─────────
    console.log('\n── I1a: TARGET_NOT_FOUND — operation.start with bad nodeId ──');

    const badNodeId = 'test_invariants_nonexistent_op_' + Date.now();
    const beforeBadOp = new Set((await listInstances()).map(i => i.id));

    drain(a.inbox, 'error');
    a.ws.send(env('operation.start', {
      nodeId: badNodeId,
      kind: 'plugin',
      pluginId: 'no-such-plugin',
      command: 'nothing',
    }));

    let gotTargetNotFound = false;
    try {
      const errMsg = await waitFor(a.inbox, m =>
        m.type === 'error' && m.code === 'TARGET_NOT_FOUND',
      'TARGET_NOT_FOUND for operation.start', 8000);
      gotTargetNotFound = true;
      check('TARGET_NOT_FOUND received for bad nodeId (operation.start)', true);
      check('Error message references bad nodeId', (errMsg.message || '').includes(badNodeId));
    } catch {
      const errs = drain(a.inbox, 'error');
      console.log(`  Errors: ${errs.map(e => `${e.code}: ${e.message}`).join(', ')}`);
      gotTargetNotFound = errs.some(e => e.code === 'TARGET_NOT_FOUND');
      check('TARGET_NOT_FOUND received (operation.start)', gotTargetNotFound);
    }

    // INVARIANT: No new instance was created
    const afterBadOp = new Set((await listInstances()).map(i => i.id));
    const newOpIds = [...afterBadOp].filter(id => !beforeBadOp.has(id));
    check('No local instance created for bad nodeId (operation.start)', newOpIds.length === 0);

    // ── I1b: INSTANCE_NOT_FOUND for shell.spawn ─────────────
    console.log('\n── I1b: INSTANCE_NOT_FOUND — shell.spawn with bad instanceId ──');

    const badInstId = 'test_invariants_nonexistent_shell_' + Date.now();
    const beforeBadShell = new Set((await listInstances()).map(i => i.id));

    drain(a.inbox, 'error');
    a.ws.send(env('shell.spawn', { instanceId: badInstId }));

    let gotInstNotFound = false;
    try {
      const errMsg = await waitFor(a.inbox, m =>
        m.type === 'error' && m.code === 'INSTANCE_NOT_FOUND',
      'INSTANCE_NOT_FOUND for shell.spawn', 8000);
      gotInstNotFound = true;
      check('INSTANCE_NOT_FOUND received for bad instanceId (shell.spawn)', true);
      check('Error message references bad instanceId', (errMsg.message || '').includes(badInstId));
    } catch {
      const errs = drain(a.inbox, 'error');
      console.log(`  Errors: ${errs.map(e => `${e.code}: ${e.message}`).join(', ')}`);
      gotInstNotFound = errs.some(e => e.code === 'INSTANCE_NOT_FOUND');
      check('INSTANCE_NOT_FOUND received (shell.spawn)', gotInstNotFound);
    }

    // INVARIANT: No local instance created as fallback
    const afterBadShell = new Set((await listInstances()).map(i => i.id));
    const newShellIds = [...afterBadShell].filter(id => !beforeBadShell.has(id));
    check('No local instance created for bad instanceId (shell.spawn)', newShellIds.length === 0);

    // Must not have double-sent INTERNAL_ERROR after INSTANCE_NOT_FOUND
    if (gotInstNotFound) {
      const remainingErrs = drain(a.inbox, 'error');
      const extraInternal = remainingErrs.filter(e => e.code === 'INTERNAL_ERROR');
      check('No extra INTERNAL_ERROR after INSTANCE_NOT_FOUND', extraInternal.length === 0);
    }

    // ── Multiple concurrent operations (I6 extended) ────────
    console.log('\n── Multiple concurrent operations on same node ──');

    drain(agent.inbox, 'relay.operation.start');
    drain(a.inbox, 'operation.status');
    drain(a.inbox, 'operation.output');
    drain(b.inbox, 'operation.output');

    // Start operation alpha
    a.ws.send(env('operation.start', { nodeId, kind: 'plugin', pluginId: 'alpha', command: 'alpha-cmd' }));
    const alphaStart = await waitFor(agent.inbox, m =>
      m.type === 'relay.operation.start' && m.pluginId === 'alpha',
    'Agent receives alpha operation.start', 8000);
    const alphaId = alphaStart.operationId;

    // Start operation beta (same node, concurrent)
    a.ws.send(env('operation.start', { nodeId, kind: 'plugin', pluginId: 'beta', command: 'beta-cmd' }));
    const betaStart = await waitFor(agent.inbox, m =>
      m.type === 'relay.operation.start' && m.pluginId === 'beta',
    'Agent receives beta operation.start', 8000);
    const betaId = betaStart.operationId;

    check('Alpha and beta have different operationIds', alphaId !== betaId);

    // Emit output for alpha
    drain(a.inbox, 'operation.output');
    agent.ws.send(env('agent.operation.output', { operationId: alphaId, stream: 'stdout', data: 'alpha-output\n' }));

    const aAlphaOut = await waitFor(a.inbox, m =>
      m.type === 'operation.output' && m.operationId === alphaId,
    'A receives alpha output', 5000);
    check('A received alpha output', (aAlphaOut?.data || '').includes('alpha-output'));

    // Emit output for beta
    drain(a.inbox, 'operation.output');
    agent.ws.send(env('agent.operation.output', { operationId: betaId, stream: 'stdout', data: 'beta-output\n' }));

    const aBetaOut = await waitFor(a.inbox, m =>
      m.type === 'operation.output' && m.operationId === betaId,
    'A receives beta output', 5000);
    check('A received beta output', (aBetaOut?.data || '').includes('beta-output'));

    // B (not subscribed to either) must not receive
    await delay(200);
    const bConcurrent = drain(b.inbox, 'operation.output');
    const bAlpha = bConcurrent.filter(m => m.operationId === alphaId);
    const bBeta = bConcurrent.filter(m => m.operationId === betaId);
    check('B did not receive alpha output (not subscribed)', bAlpha.length === 0);
    check('B did not receive beta output (not subscribed)', bBeta.length === 0);

    // Complete both
    agent.ws.send(env('agent.operation.result', { operationId: alphaId, success: true, data: { cmd: 'alpha-cmd' } }));
    agent.ws.send(env('agent.operation.result', { operationId: betaId, success: true, data: { cmd: 'beta-cmd' } }));
    await delay(200);

    // ── operation.cancel ────────────────────────────────────
    console.log('\n── operation.cancel — status → cancelled ──');

    drain(agent.inbox, 'relay.operation.start');
    drain(a.inbox, 'operation.status');

    a.ws.send(env('operation.start', { nodeId, kind: 'plugin', pluginId: 'cancel-test', command: 'long-job' }));
    const cancelStart = await waitFor(agent.inbox, m =>
      m.type === 'relay.operation.start' && m.pluginId === 'cancel-test',
    'Agent receives cancel-test operation.start', 8000);
    const cancelOpId = cancelStart.operationId;

    await waitFor(a.inbox, m =>
      m.type === 'operation.status' && m.operationId === cancelOpId && m.status === 'running',
    'A gets running status for cancel test', 5000);

    // Cancel the operation
    drain(a.inbox, 'operation.status');
    a.ws.send(env('operation.cancel', { operationId: cancelOpId }));

    const cancelStatus = await waitFor(a.inbox, m =>
      m.type === 'operation.status' && m.operationId === cancelOpId,
    'A receives cancelled status', 5000);
    check('Cancel status received', !!cancelStatus);
    check('Cancel status = cancelled', cancelStatus?.status === 'cancelled');
    check('Cancel detail mentions user', (cancelStatus?.detail || '').includes('Cancelled'));

    // Cancelling again should fail
    drain(a.inbox, 'error');
    a.ws.send(env('operation.cancel', { operationId: cancelOpId }));
    await delay(200);
    const cancelAgainErrors = drain(a.inbox, 'error');
    check('Double cancel returns error',
      cancelAgainErrors.some(e => e.code === 'OPERATION_NOT_FOUND' || e.code === 'OPERATION_ALREADY_TERMINAL'));

    // ── I2a: Agent disconnect → instance cleaned up → TARGET_NOT_FOUND ──
    // The relay auto-cleans up remote instances when the agent WebSocket
    // closes (sets agentConnection=null, kills instance, broadcasts
    // instance.removed). The AGENT_DISCONNECTED invariant fires when the
    // instance STILL EXISTS but agentConnection is dead — a race-window
    // scenario. In normal operation, the instance is gone before the next
    // request. Both paths are safe: the key invariant is that NO fallback
    // to local execution occurs.
    console.log('\n── I2a: Agent disconnect → instance cleaned → TARGET_NOT_FOUND (no fallback) ──');

    const beforeDiscOp = new Set((await listInstances()).map(i => i.id));

    // Close agent WebSocket — relay will auto-cleanup the instance
    agent.ws.close();
    await delay(500);

    // Instance should be gone (auto-cleanup)
    const instAfterClose = (await listInstances()).find(i => i.id === testInstanceId);
    // Either gone (auto-cleanup) or still present with dead agentConnection (race)
    console.log(`  Instance after close: ${instAfterClose ? 'present' : 'removed'}`);

    // Try operation.start on the disconnected agent's node
    drain(a.inbox, 'error');
    a.ws.send(env('operation.start', {
      nodeId: testInstanceId,
      kind: 'plugin',
      pluginId: 'disconnected-plugin',
      command: 'should-fail',
    }));

    // Accept either: TARGET_NOT_FOUND (instance auto-cleaned) or
    // AGENT_DISCONNECTED (instance still present but agent dead)
    let gotDiscError = false;
    try {
      const errMsg = await waitFor(a.inbox, m =>
        m.type === 'error' && (m.code === 'AGENT_DISCONNECTED' || m.code === 'TARGET_NOT_FOUND'),
      'AGENT_DISCONNECTED or TARGET_NOT_FOUND for operation.start', 8000);
      gotDiscError = true;
      check('Error received after agent disconnect (operation.start)',
        errMsg.code === 'AGENT_DISCONNECTED' || errMsg.code === 'TARGET_NOT_FOUND');
      console.log(`  Got: ${errMsg.code}`);
    } catch {
      const errs = drain(a.inbox, 'error');
      console.log(`  Errors: ${errs.map(e => `${e.code}: ${e.message}`).join(', ')}`);
      gotDiscError = errs.some(e => e.code === 'AGENT_DISCONNECTED' || e.code === 'TARGET_NOT_FOUND');
      check('Error received after agent disconnect (operation.start)', gotDiscError);
    }

    // INVARIANT: No fallback local instance created
    const afterDiscOp = new Set((await listInstances()).map(i => i.id));
    const discNewOpIds = [...afterDiscOp].filter(id => !beforeDiscOp.has(id));
    check('No local instance created after agent disconnect (operation.start)', discNewOpIds.length === 0);

    // ── I2b: shell.spawn after agent disconnect ────
    console.log('\n── I2b: shell.spawn after agent disconnect → error, no fallback ──');

    const beforeDiscShell = new Set((await listInstances()).map(i => i.id));

    drain(a.inbox, 'error');
    a.ws.send(env('shell.spawn', { instanceId: testInstanceId }));

    let gotShellDiscError = false;
    try {
      const errMsg = await waitFor(a.inbox, m =>
        m.type === 'error' && (m.code === 'REMOTE_AGENT_DISCONNECTED' || m.code === 'INSTANCE_NOT_FOUND'),
      'REMOTE_AGENT_DISCONNECTED or INSTANCE_NOT_FOUND for shell.spawn', 8000);
      gotShellDiscError = true;
      check('Error received after agent disconnect (shell.spawn)',
        errMsg.code === 'REMOTE_AGENT_DISCONNECTED' || errMsg.code === 'INSTANCE_NOT_FOUND');
      console.log(`  Got: ${errMsg.code}`);
    } catch {
      const errs = drain(a.inbox, 'error');
      console.log(`  Errors: ${errs.map(e => `${e.code}: ${e.message}`).join(', ')}`);
      gotShellDiscError = errs.some(e => e.code === 'REMOTE_AGENT_DISCONNECTED' || e.code === 'INSTANCE_NOT_FOUND');
      check('Error received after agent disconnect (shell.spawn)', gotShellDiscError);
    }

    // INVARIANT: No fallback local shell
    const afterDiscShell = new Set((await listInstances()).map(i => i.id));
    const discNewShellIds = [...afterDiscShell].filter(id => !beforeDiscShell.has(id));
    check('No local instance created after agent disconnect (shell.spawn)', discNewShellIds.length === 0);

  } finally {
    // ── Cleanup ──────────────────────────────────────────────
    console.log('\n── Cleanup ──');

    // Close all browser connections
    for (const c of conns) {
      try { if (c.ws.readyState === WebSocket.OPEN) c.ws.close(); } catch {}
    }
    await delay(200);

    // Only delete instances we created (NOT pre-existing user instances)
    const currentInstances = await listInstances();
    const currentIds = new Set(currentInstances.map(i => i.id));

    for (const id of createdInstanceIds) {
      if (currentIds.has(id)) {
        try {
          const resp = await fetch(`${RELAY_HTTP}/api/instances/${id}`, { method: 'DELETE' });
          const deleted = resp.ok;
          console.log(`  Delete test instance ${id.slice(0, 20)}...: ${deleted ? 'OK' : 'FAILED'}`);
        } catch (e) {
          console.log(`  Delete test instance ${id.slice(0, 20)}...: ERROR ${e.message}`);
        }
      }
    }

    // Verify no pre-existing instances were deleted
    const afterCleanupIds = new Set((await listInstances()).map(i => i.id));
    const missingPreExisting = [...preExistingIds].filter(id => !afterCleanupIds.has(id));
    if (missingPreExisting.length > 0) {
      console.log(`  WARNING: ${missingPreExisting.length} pre-existing instances went missing!`);
    } else {
      console.log('  All pre-existing instances preserved');
    }
  }

  console.log(`\n===== RESULTS: ${passed}/${total} passed, ${failed}/${total} failed =====`);
  if (failed === 0) console.log('  ✅ ALL ROUTING INVARIANTS TESTS PASSED\n');
  else console.log(`  ❌ ${failed} test(s) failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
