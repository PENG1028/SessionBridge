// ─── Real Agent Operation Protocol Test ─────────────────────
// Verifies that a real agent (using OperationRunner from agent-core)
// handles relay.operation.* messages correctly end-to-end.
//
// This test does NOT mock the agent's operation handling — it uses
// the actual OperationRunner module that ships in the agent runtime.
// The browser side sends operation.start via the relay, and the
// OperationRunner on the agent side processes it and sends back
// agent.operation.{status,output,result}.
//
// Usage:
//   npx tsx tests/integration/real-agent-operation-protocol.test.ts [ws://host:port]
//   Default: ws://localhost:9000

import WebSocket from 'ws';
import { OperationRunner } from '../../agent-core/operation-runner';

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
    clientToken: `realagent_${label}_${Date.now()}`,
  }));
  return { ws, inbox, label };
}

async function connectAgentWithRunner(label) {
  const ws = new WebSocket(RELAY_WS);
  const inbox = [];
  const sentMessages = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));

  // Create the real OperationRunner with a transport that sends via this WS
  const transport = {
    send(type, body) {
      const msg = env(type, body);
      sentMessages.push(JSON.parse(msg));
      ws.send(msg);
    },
  };
  const runner = new OperationRunner(transport);

  // On incoming messages, dispatch relay.operation.* to the runner
  const origOnMessage = ws.onmessage;
  ws.on('message', (d) => {
    // inbox already handled above via separate listener
    try {
      const raw = d.toString();
      const m = JSON.parse(raw);
      const msg = m.v === 1 && m.body ? { ...m.body, type: m.type } : m;
      if (msg.type === 'relay.operation.start'
        || msg.type === 'relay.operation.input'
        || msg.type === 'relay.operation.cancel') {
        runner.handleMessage(msg);
      }
    } catch {}
  });

  // Register as agent
  ws.send(env('hello', {
    role: 'agent', version: '0.6.0',
    features: ['shell', 'crypto_v1'],
    label, adapterId: 'shell',
  }));

  // Wait for welcome, then send agent.register (mimics RelayConnection)
  await waitFor(inbox, m => m.type === 'welcome', `${label} welcome`, 5000);
  ws.send(env('agent.register', {
    dir: process.cwd(),
    label,
    role: 'leaf',
  }));

  return { ws, inbox, runner, sentMessages, label };
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

async function collectMatching(inbox, predicate, minCount, timeout = 5000) {
  const start = Date.now();
  const collected = [];
  while (collected.length < minCount && Date.now() - start < timeout) {
    for (let i = 0; i < inbox.length; i++) {
      try {
        const m = JSON.parse(inbox[i]);
        const msg = m.v === 1 && m.body ? { ...m.body, type: m.type } : m;
        if (predicate(msg)) { collected.push(msg); inbox.splice(i, 1); break; }
      } catch {}
    }
    if (collected.length < minCount) await delay(100);
  }
  return collected;
}

async function listInstances() {
  try {
    const res = await fetch(`${RELAY_HTTP}/api/instances`);
    const data = await res.json();
    return Array.isArray(data) ? data : (data.instances || []);
  } catch { return []; }
}

// ── Main Test ────────────────────────────────────────────────

async function main() {
  console.log(`\n===== Real Agent Operation Protocol Test =====`);
  console.log(`  Relay: ${RELAY_WS}\n`);

  const conns = [];

  try {
    // ── T1: Agent with OperationRunner registers ──────────────
    console.log('── T1: Agent with OperationRunner registers as remote device ──');

    const agent = await connectAgentWithRunner('RealOpAgent');
    conns.push(agent);

    const agentRegistered = await waitFor(agent.inbox, m =>
      m.type === 'agent.registered' || m.type === 'welcome',
    'Agent receives welcome/registered', 8000);
    check('Agent registered with relay', !!agentRegistered);

    // Find the agent's instanceId from the relay's instance list
    const instances = await listInstances();
    const agentInst = instances.find(i => i.label === 'RealOpAgent' && i.source === 'remote');
    check('Remote agent instance in instance list', !!agentInst);

    if (!agentInst) {
      console.log('  FATAL: Agent instance not found in relay list. Aborting.');
      console.log('  Available instances:', instances.map(i => `${i.label} (${i.source})`).join(', '));
      return;
    }

    const nodeId = agentInst.id;
    console.log(`  Agent nodeId: ${nodeId}`);

    // ── T2: Browser sends operation.start → agent receives relay.operation.start ──
    console.log('\n── T2: operation.start mock-echo → agent processes via OperationRunner ──');

    const a = await connectBrowser('A');
    conns.push(a);
    await waitFor(a.inbox, m => m.type === 'welcome', 'A welcome', 5000);

    // Drain any stale messages
    drain(agent.inbox, 'relay.operation.start');
    drain(a.inbox, 'operation.status');
    drain(a.inbox, 'operation.output');
    drain(a.inbox, 'operation.result');

    a.ws.send(env('operation.start', {
      nodeId,
      kind: 'plugin',
      pluginId: 'mock-echo',
      command: 'echo',
      input: { text: 'hello-agent-world' },
    }));

    // T3: Browser receives operation.status = running
    const statusRunning = await waitFor(a.inbox, m =>
      m.type === 'operation.status' && m.status === 'running' && m.kind === 'plugin',
    'A receives operation.status = running', 8000);
    check('A received operation.status = running', !!statusRunning);
    check('operation.status kind = plugin', statusRunning?.kind === 'plugin');

    // T4: Browser receives operation.output from real agent
    const opOutput = await waitFor(a.inbox, m =>
      m.type === 'operation.output' && m.stream === 'structured',
    'A receives operation.output', 8000);
    check('A received operation.output', !!opOutput);

    let echoedData = null;
    try { echoedData = JSON.parse(opOutput?.data || '{}'); } catch {}
    check('A output contains echoed text', echoedData?.echoed === 'hello-agent-world');
    check('A output contains agent hostname', typeof echoedData?.node === 'string' && echoedData.node.length > 0);
    console.log(`  Agent hostname from output: ${echoedData?.node}`);

    // T5: Browser receives operation.result success=true
    const opResult = await waitFor(a.inbox, m =>
      m.type === 'operation.result' && m.success === true,
    'A receives operation.result success=true', 8000);
    check('A received operation.result', !!opResult);
    check('A result success = true', opResult?.success === true);
    check('A result data has echoed text', opResult?.data?.echoed === 'hello-agent-world');
    check('A result data has agent node', opResult?.data?.node === echoedData?.node);

    // Capture operationId for later tests
    const operationId = opOutput?.operationId || opResult?.operationId;
    check('operationId captured', !!operationId);
    console.log(`  operationId: ${operationId}`);

    // ── T6: Browser B subscribes → replay output + result ─────
    console.log('\n── T6: Browser B subscribes to completed operation → replay ──');

    const b = await connectBrowser('B');
    conns.push(b);
    await waitFor(b.inbox, m => m.type === 'welcome', 'B welcome', 5000);

    drain(b.inbox, 'operation.status');
    drain(b.inbox, 'operation.output');
    drain(b.inbox, 'operation.result');

    b.ws.send(env('operation.subscribe', { operationId }));

    // B should get status replay
    const bStatus = await waitFor(b.inbox, m =>
      m.type === 'operation.status' && m.operationId === operationId,
    'B receives operation.status on subscribe', 5000);
    check('B received operation.status (replay)', !!bStatus);

    // B should get output replay
    const bOutput = await waitFor(b.inbox, m =>
      m.type === 'operation.output' && m.operationId === operationId,
    'B receives operation.output replay', 5000);
    check('B received operation.output replay', !!bOutput);
    let bData = null;
    try { bData = JSON.parse(bOutput?.data || '{}'); } catch {}
    check('B replay contains echoed text', bData?.echoed === 'hello-agent-world');

    // B should get result replay
    const bResult = await waitFor(b.inbox, m =>
      m.type === 'operation.result' && m.operationId === operationId,
    'B receives operation.result replay', 5000);
    check('B received operation.result replay', !!bResult);
    check('B replay result success = true', bResult?.success === true);

    // ── T7: operation.input forwarded to agent ─────────────────
    console.log('\n── T7: operation.input reaches agent ──');

    // Start a fresh operation for input test
    drain(agent.inbox, 'relay.operation.start');
    drain(a.inbox, 'operation.status');
    drain(a.inbox, 'operation.output');
    drain(a.inbox, 'operation.result');

    a.ws.send(env('operation.start', {
      nodeId,
      kind: 'plugin',
      pluginId: 'mock-echo',
      command: 'echo',
      input: { text: 'input-test' },
    }));

    // Wait for the new operation to complete
    const inputOpOutput = await waitFor(a.inbox, m =>
      m.type === 'operation.output' && (m.data || '').includes('input-test'),
    'A receives output for input-test operation', 8000);
    const inputOpId = inputOpOutput?.operationId;
    check('Input test operation created', !!inputOpId);

    // Verify agent can receive relay.operation.input (the relay forwards input to agent)
    drain(agent.inbox, 'relay.operation.input');
    a.ws.send(env('operation.input', { operationId: inputOpId, data: 'stdin-data-from-browser' }));

    // Use waitFor instead of delay to tolerate WAN latency
    const relayInputMsg = await waitFor(agent.inbox, m =>
      m.type === 'relay.operation.input',
    'Agent receives relay.operation.input', 8000);
    check('Agent received relay.operation.input', !!relayInputMsg);
    check('relay.operation.input has correct operationId',
      relayInputMsg?.operationId === inputOpId);

    // ── T8: Bad nodeId → TARGET_NOT_FOUND, no fallback ────────
    console.log('\n── T8: Bad nodeId → TARGET_NOT_FOUND, no local fallback ──');

    const beforeIds = new Set((await listInstances()).map(i => i.id));
    drain(a.inbox, 'error');

    a.ws.send(env('operation.start', {
      nodeId: 'test_bad_node_xyz',
      kind: 'plugin',
      pluginId: 'mock-echo',
      command: 'echo',
      input: { text: 'should-not-execute' },
    }));

    const badError = await waitFor(a.inbox, m =>
      m.type === 'error' && m.code === 'TARGET_NOT_FOUND',
    'TARGET_NOT_FOUND for bad nodeId', 8000);
    check('TARGET_NOT_FOUND received for bad nodeId', !!badError);
    check('Error message mentions bad nodeId',
      (badError?.message || '').includes('test_bad_node_xyz'));

    // Verify no local fallback instance was created
    await delay(200);
    const afterIds = new Set((await listInstances()).map(i => i.id));
    const newIds = [...afterIds].filter(id => !beforeIds.has(id));
    check('No local instance created for bad nodeId (no fallback)',
      newIds.filter(id => id.startsWith('inst_')).length === 0);

    // ── T9: Agent disconnect → error, no fallback ─────────────
    console.log('\n── T9: Agent disconnect → error, no local fallback ──');

    const beforeDiscIds = new Set((await listInstances()).map(i => i.id));

    agent.ws.close();
    await delay(500);

    drain(a.inbox, 'error');
    a.ws.send(env('operation.start', {
      nodeId,
      kind: 'plugin',
      pluginId: 'mock-echo',
      command: 'echo',
      input: { text: 'after-disconnect' },
    }));

    const discError = await waitFor(a.inbox, m =>
      m.type === 'error' && (m.code === 'AGENT_DISCONNECTED' || m.code === 'TARGET_NOT_FOUND'),
    'Error after agent disconnect', 8000);
    check('Error received after agent disconnect (operation.start)',
      !!discError);
    console.log(`  Got: ${discError?.code}`);
    check('Error code is AGENT_DISCONNECTED or TARGET_NOT_FOUND',
      discError?.code === 'AGENT_DISCONNECTED' || discError?.code === 'TARGET_NOT_FOUND');

    // Verify no local fallback
    await delay(200);
    const afterDiscIds = new Set((await listInstances()).map(i => i.id));
    const newDiscIds = [...afterDiscIds].filter(id => !beforeDiscIds.has(id));
    check('No local instance created after agent disconnect (no fallback)',
      newDiscIds.filter(id => id.startsWith('inst_')).length === 0);

    // ── Results ───────────────────────────────────────────────
    console.log(`\n===== RESULTS: ${passed}/${total} passed, ${failed}/${total} failed =====`);
    if (failed > 0) {
      console.log(`  ❌ ${failed} test(s) failed`);
    } else {
      console.log(`  ✅ ALL REAL AGENT OPERATION PROTOCOL TESTS PASSED`);
    }

  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    console.log(`\n===== RESULTS: ${passed}/${total} passed, ${failed}/${total} failed =====`);
  } finally {
    // Cleanup
    for (const c of conns) {
      try { c.ws.close(); } catch {}
    }
    await delay(200);
    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
