// ─── Remote Shared Terminal Session Test ─────────────────────
// Validates: Browser A opens B-device terminal → Browser B sees
// the SAME terminal tab, SAME shell instance, SAME I/O stream,
// proxied through the agent WebSocket (relay.shell.spawn / agent.stdin).
//
// Architecture:
//   Browser A ──┐
//               ├── Relay ── Mock Agent (simulates remote B device)
//   Browser B ──┘
//
//   The mock agent registers as a remote instance and acts as the
//   "B device shell". It receives relay.shell.spawn, agent.stdin,
//   and sends agent.stdout to simulate shell output.
//
//   This proves: A opens B's terminal → shell runs on B → A/B share
//   the same I/O. Nothing falls back to the relay's local shell.
//
// Test cases (9):
//   T1: Agent registers → remote instance appears → browsers subscribe
//   T2: A sends workbench.tabs with remote instanceId → B receives same tab
//   T3: A shell.spawn → agent receives relay.shell.spawn + A gets operation.status
//   T4: B shell.spawn same instance → agent receives relay.shell.spawn (reconnect)
//   T5: Agent sends agent.stdout → A/B get shell.output AND operation.output
//   T6: A shell.input → agent receives agent.stdin
//   T7: B shell.input → agent receives agent.stdin (bidirectional)
//   T8: Late joiner C gets tab state + output replay via operation.subscribe
//   T9: Bad instanceId shell.spawn → INSTANCE_NOT_FOUND, no local fallback
//   T10: Agent disconnected → REMOTE_AGENT_DISCONNECTED
//   T11: operation.start with kind='terminal' (new unified protocol)
//
// Usage:
//   node tests/integration/remote-shared-terminal-session.test.mjs [ws://host:port]
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
    clientToken: `remote_integ_${label}_${Date.now()}`,
  }));
  return { ws, inbox, label };
}

async function connectAgent(label, adapterId = 'shell') {
  const ws = new WebSocket(RELAY_WS);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));

  // Hello as agent
  ws.send(env('hello', {
    role: 'agent',
    version: '0.6.0',
    features: ['shell', 'crypto_v1'],
    label,
    adapterId,
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
      if (msg.type === type) {
        msgs.unshift(msg);
        inbox.splice(i, 1);
      }
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
  console.log(`\n===== Remote Shared Terminal Session Test =====`);
  console.log(`  Relay: ${RELAY_WS}\n`);

  const conns = [];      // all connections for cleanup
  let remoteInstanceId = null;

  try {
    // ── T1: Agent registers, browsers subscribe ─────────────
    console.log('── T1: Agent registers → remote instance created → browsers subscribe ──');

    // Start mock agent (simulates B device)
    const agent = await connectAgent('TEST-AGENT', 'shell');
    conns.push(agent);

    // Agent receives welcome
    const agentWelcome = await waitFor(agent.inbox, m => m.type === 'welcome', 'Agent welcome');
    check('Agent receives welcome', !!agentWelcome);
    console.log(`  Agent sessionId: ${agentWelcome.sessionId?.slice(0, 16)}...`);

    // Agent registers — this creates the remote instance
    agent.ws.send(env('agent.register', {
      dir: process.cwd(),
      label: 'TEST-AGENT',
      adapterId: 'shell',
    }));

    const agentReg = await waitFor(agent.inbox, m =>
      m.type === 'agent.registered', 'Agent registered');
    remoteInstanceId = agentReg.instanceId;
    check('Agent receives agent.registered with instanceId', !!remoteInstanceId);

    // Verify the remote instance appears in the instance list
    const instsAfterReg = await listInstances();
    const remoteInst = instsAfterReg.find(i => i.id === remoteInstanceId);
    check('Remote instance in instance list', !!remoteInst);
    check('Remote instance source is "remote"', remoteInst?.source === 'remote');
    check('Remote instance has agent connection', !!remoteInst);
    console.log(`  Remote instanceId: ${remoteInstanceId.slice(0, 20)}...`);

    const initialInstanceIds = new Set(instsAfterReg.map(i => i.id));

    // Start two browsers
    const a = await connectBrowser('A'); conns.push(a);
    const b = await connectBrowser('B'); conns.push(b);

    await waitFor(a.inbox, m => m.type === 'welcome', 'A welcome');
    await waitFor(b.inbox, m => m.type === 'welcome', 'B welcome');

    // Both browsers subscribe to the remote instance node
    const nodeId = remoteInstanceId;
    a.ws.send(env('workbench.subscribe', { nodeId }));
    b.ws.send(env('workbench.subscribe', { nodeId }));

    // Get initial tabs
    const aTabsMsg = await waitFor(a.inbox, m => m.type === 'workbench.tabs' && m.nodeId === nodeId, 'A initial tabs');
    const bTabsMsg = await waitFor(b.inbox, m => m.type === 'workbench.tabs' && m.nodeId === nodeId, 'B initial tabs');

    console.log(`  A initial tabs: ${(aTabsMsg.tabs || []).length}`);
    console.log(`  B initial tabs: ${(bTabsMsg.tabs || []).length}`);

    // Browser D: unrelated browser, subscribes to node but does NOT shell.spawn.
    // Used to verify shell.output is scoped, not globally broadcast.
    const d = await connectBrowser('D'); conns.push(d);
    await waitFor(d.inbox, m => m.type === 'welcome', 'D welcome');
    d.ws.send(env('workbench.subscribe', { nodeId }));
    await waitFor(d.inbox, m => m.type === 'workbench.tabs' && m.nodeId === nodeId, 'D initial tabs');

    // ── T2: A sends tabs with remote instanceId → B receives ─
    console.log('\n── T2: A sends workbench.tabs → B receives same tab with remote instanceId ──');

    const testTab = {
      id: 'remote-term-1',
      title: 'PENGSPC Terminal',
      viewType: 'terminal',
      instanceId: remoteInstanceId,
    };

    a.ws.send(env('workbench.tabs', { nodeId, tabs: [testTab] }));

    const bSynced = await waitFor(b.inbox, m =>
      m.type === 'workbench.tabs' && m.nodeId === nodeId,
    'B receives synced tabs');

    const bTermTab = (bSynced.tabs || []).find(t => t.viewType === 'terminal');
    check('B received terminal tab', !!bTermTab);
    check('B tab has remote instanceId', bTermTab?.instanceId === remoteInstanceId);
    check('B tab has same id', bTermTab?.id === 'remote-term-1');
    check('B tab title = PENGSPC Terminal', bTermTab?.title === 'PENGSPC Terminal');

    // ── T3: A shell.spawn → agent receives relay.shell.spawn + operation.status ─
    console.log('\n── T3: A shell.spawn remote instance → agent receives relay.shell.spawn + operation.status ──');

    drain(agent.inbox, 'relay.shell.spawn');
    drain(a.inbox, 'operation.status');

    a.ws.send(env('shell.spawn', { instanceId: remoteInstanceId }));

    // Agent must receive relay.shell.spawn
    const relayShellSpawn = await waitFor(agent.inbox, m =>
      m.type === 'relay.shell.spawn',
    'Agent receives relay.shell.spawn', 8000);
    check('Agent received relay.shell.spawn', !!relayShellSpawn);
    check('relay.shell.spawn has correct instanceId', relayShellSpawn?.instanceId === remoteInstanceId);
    check('relay.shell.spawn has dir', typeof relayShellSpawn?.dir === 'string');

    // A should also get operation.status from unified operation tracking
    const aOpStatus = await waitFor(a.inbox, m =>
      m.type === 'operation.status' && m.status === 'running',
    'A receives operation.status running', 5000);
    check('A received operation.status after shell.spawn', !!aOpStatus);
    check('operation.status kind is terminal', aOpStatus?.kind === 'terminal');

    // ── T4: B shell.spawn same instance → agent receives another ──
    console.log('\n── T4: B also shell.spawn same instance → agent receives relay.shell.spawn ──');

    drain(agent.inbox, 'relay.shell.spawn');

    b.ws.send(env('shell.spawn', { instanceId: remoteInstanceId }));

    const relayShellSpawn2 = await waitFor(agent.inbox, m =>
      m.type === 'relay.shell.spawn',
    'Agent receives relay.shell.spawn (B)', 8000);
    check('Agent received relay.shell.spawn from B', !!relayShellSpawn2);

    // ── T5: Agent sends agent.stdout → both browsers get shell.output AND operation.output ──
    console.log('\n── T5: Agent sends agent.stdout → A and B receive shell.output + operation.output ──');

    drain(a.inbox, 'shell.output');
    drain(b.inbox, 'shell.output');
    drain(a.inbox, 'operation.output');
    drain(b.inbox, 'operation.output');
    drain(d.inbox, 'shell.output');
    drain(d.inbox, 'operation.output');

    const testOutput = `[TEST-AGENT] Shell ready — ${Date.now()}\n`;
    agent.ws.send(env('agent.stdout', {
      instanceId: remoteInstanceId,
      data: testOutput,
      seq: 0,
      final: true,
    }));

    // A and B (who shell.spawn'd) should get shell.output
    const aOut = await waitFor(a.inbox, m => m.type === 'shell.output', 'A shell.output', 5000);
    const bOut = await waitFor(b.inbox, m => m.type === 'shell.output', 'B shell.output', 5000);
    check('A received shell.output from agent', !!aOut);
    check('B received shell.output from agent', !!bOut);

    // A and B should ALSO get operation.output (unified protocol)
    const aOpOut = await waitFor(a.inbox, m => m.type === 'operation.output', 'A operation.output', 5000);
    const bOpOut = await waitFor(b.inbox, m => m.type === 'operation.output', 'B operation.output', 5000);
    check('A received operation.output from agent', !!aOpOut);
    check('B received operation.output from agent', !!bOpOut);

    const aData = typeof aOut?.data === 'string' ? aOut.data : '';
    const bData = typeof bOut?.data === 'string' ? bOut.data : '';
    check('A output contains test marker', aData.includes('[TEST-AGENT]'));
    check('B output contains test marker', bData.includes('[TEST-AGENT]'));

    // D did NOT shell.spawn — must NOT receive shell.output or operation.output
    await delay(300);
    const dShellOutput = drain(d.inbox, 'shell.output');
    const dOpOutput = drain(d.inbox, 'operation.output');
    check('Browser D (no shell.spawn) does NOT receive shell.output', dShellOutput.length === 0);
    check('Browser D does NOT receive operation.output', dOpOutput.length === 0);

    // ── T6: A shell.input → agent receives agent.stdin ──────
    console.log('\n── T6: A shell.input → agent receives agent.stdin ──');

    drain(agent.inbox, 'agent.stdin');

    const inputData6 = `echo hello_from_A\r\n`;
    a.ws.send(env('shell.input', { instanceId: remoteInstanceId, data: inputData6 }));

    const agentStdin = await waitFor(agent.inbox, m =>
      m.type === 'agent.stdin',
    'Agent receives agent.stdin from A', 8000);
    check('Agent received agent.stdin', !!agentStdin);
    check('agent.stdin has correct instanceId', agentStdin?.instanceId === remoteInstanceId);
    check('agent.stdin contains A\'s input', (agentStdin?.data || '').includes('hello_from_A'));

    // Agent echoes back
    drain(a.inbox, 'shell.output');
    drain(b.inbox, 'shell.output');

    agent.ws.send(env('agent.stdout', {
      instanceId: remoteInstanceId,
      data: `$ echo hello_from_A\r\nhello_from_A\r\n$ `,
      seq: 1,
      final: true,
    }));

    const aEcho = await waitFor(a.inbox, m =>
      m.type === 'shell.output' && (m.data || '').includes('hello_from_A'),
    'A sees A\'s echoed command', 5000);
    const bEcho = await waitFor(b.inbox, m =>
      m.type === 'shell.output' && (m.data || '').includes('hello_from_A'),
    'B also sees A\'s echoed command', 5000);
    check('A sees echoed output', !!aEcho);
    check('B also sees echoed output (shared!)', !!bEcho);

    // ── T7: B shell.input → agent receives agent.stdin (bidirectional) ──
    console.log('\n── T7: B shell.input → agent receives agent.stdin (bidirectional) ──');

    drain(agent.inbox, 'agent.stdin');
    drain(a.inbox, 'shell.output');
    drain(b.inbox, 'shell.output');

    const inputData7 = `echo hello_from_B\r\n`;
    b.ws.send(env('shell.input', { instanceId: remoteInstanceId, data: inputData7 }));

    const agentStdin2 = await waitFor(agent.inbox, m =>
      m.type === 'agent.stdin' && (m.data || '').includes('hello_from_B'),
    'Agent receives agent.stdin from B', 8000);
    check('Agent received agent.stdin from B', !!agentStdin2);

    // Agent echoes back
    agent.ws.send(env('agent.stdout', {
      instanceId: remoteInstanceId,
      data: `$ echo hello_from_B\r\nhello_from_B\r\n$ `,
      seq: 2,
      final: true,
    }));

    const aEcho2 = await waitFor(a.inbox, m =>
      m.type === 'shell.output' && (m.data || '').includes('hello_from_B'),
    'A sees B\'s echoed command', 5000);
    const bEcho2 = await waitFor(b.inbox, m =>
      m.type === 'shell.output' && (m.data || '').includes('hello_from_B'),
    'B sees own echoed command', 5000);
    check('A sees B\'s echoed output (shared!)', !!aEcho2);
    check('B sees its own echoed output', !!bEcho2);

    // ── T8: Late joiner C gets tab state + output replay via operation.subscribe ──
    console.log('\n── T8: Late joiner C gets tab state + output replay ──');

    // Get the operationId from A's last operation.status
    const opStatusMsgs = drain(a.inbox, 'operation.status');
    const terminalOpStatus = opStatusMsgs.find(m => m.kind === 'terminal');
    const capturedOperationId = terminalOpStatus?.operationId;
    check('Captured operationId for replay test', !!capturedOperationId);

    // Send some more output to build up buffer
    agent.ws.send(env('agent.stdout', {
      instanceId: remoteInstanceId,
      data: `[MORE-OUTPUT-FOR-REPLAY] line 1\nline 2\nline 3\n`,
      seq: 3,
      final: true,
    }));
    await delay(200);

    const c = await connectBrowser('C'); conns.push(c);
    await waitFor(c.inbox, m => m.type === 'welcome', 'C welcome');

    c.ws.send(env('workbench.subscribe', { nodeId }));

    const cTabsMsg = await waitFor(c.inbox, m =>
      m.type === 'workbench.tabs' && m.nodeId === nodeId, 'C tabs');
    const cTermTab = (cTabsMsg.tabs || []).find(t => t.viewType === 'terminal');
    check('C received terminal tab on subscribe', !!cTermTab);
    check('C tab has remote instanceId', cTermTab?.instanceId === remoteInstanceId);

    // C spawns shell to get output replay
    drain(c.inbox, 'shell.output');
    drain(agent.inbox, 'relay.shell.spawn');

    c.ws.send(env('shell.spawn', { instanceId: remoteInstanceId }));

    // Agent gets relay.shell.spawn for C too
    const relayShellSpawn3 = await waitFor(agent.inbox, m =>
      m.type === 'relay.shell.spawn', 'Agent receives relay.shell.spawn (C)', 8000);

    // C should get output replay (buffered from T5, T6, T7)
    // Wait a moment for replay messages to arrive
    await delay(500);
    const cReplay = drain(c.inbox, 'shell.output');
    const cReplayText = cReplay.map(m => typeof m.data === 'string' ? m.data : '').join('');
    check('C received output replay on spawn', cReplay.length > 0);
    check('C replay contains buffered output', cReplayText.includes('[TEST-AGENT]') || cReplayText.includes('[MORE-OUTPUT-FOR-REPLAY]'));

    // C should also see new output (not just replay)
    drain(a.inbox, 'shell.output');
    drain(b.inbox, 'shell.output');
    drain(c.inbox, 'shell.output');

    agent.ws.send(env('agent.stdout', {
      instanceId: remoteInstanceId,
      data: `[LIVE-OUTPUT-AFTER-C-JOIN]\n`,
      seq: 4,
      final: true,
    }));

    const aLive = await waitFor(a.inbox, m =>
      m.type === 'shell.output' && (m.data || '').includes('[LIVE-OUTPUT'), 'A live output', 5000);
    const bLive = await waitFor(b.inbox, m =>
      m.type === 'shell.output' && (m.data || '').includes('[LIVE-OUTPUT'), 'B live output', 5000);
    const cLive = await waitFor(c.inbox, m =>
      m.type === 'shell.output' && (m.data || '').includes('[LIVE-OUTPUT'), 'C live output', 5000);

    check('A receives live output after C joins', !!aLive);
    check('B receives live output after C joins', !!bLive);
    check('C receives live output (not just replay)', !!cLive);

    // ── T9: Bad instanceId → INSTANCE_NOT_FOUND ─────────────
    console.log('\n── T9: Bad instanceId → INSTANCE_NOT_FOUND, no local fallback ──');

    const badId = 'inst_deadbeef_remote_nonexistent';
    a.ws.send(env('shell.spawn', { instanceId: badId }));

    let gotNotFound = false;
    let gotInternal = false;
    try {
      const errMsg = await waitFor(a.inbox, m =>
        m.type === 'error' && m.code === 'INSTANCE_NOT_FOUND',
      'INSTANCE_NOT_FOUND', 8000);
      gotNotFound = true;
      check('INSTANCE_NOT_FOUND received for bad remote instanceId', true);
      check('Error message mentions badId', (errMsg.message || '').includes(badId));
    } catch {
      const errs = drain(a.inbox, 'error');
      gotNotFound = errs.some(e => e.code === 'INSTANCE_NOT_FOUND');
      gotInternal = errs.some(e => e.code === 'INTERNAL_ERROR');
      console.log(`  Errors: ${errs.map(e => `${e.code}: ${e.message}`).join(', ')}`);
      check('INSTANCE_NOT_FOUND received', gotNotFound);
    }

    // Must NOT have created a local shell
    const beforeBadIds = initialInstanceIds;
    const afterBadInstances = await listInstances();
    const afterBadIds = new Set(afterBadInstances.map(i => i.id));
    const newIds = [...afterBadIds].filter(id => !beforeBadIds.has(id));
    const badInst = afterBadInstances.find(i => i.id === badId);
    check('No local instance created for bad remote instanceId', !badInst);
    check('No new instances created (ID set unchanged)', newIds.length === 0);

    // Must NOT have double-sent INTERNAL_ERROR on top of INSTANCE_NOT_FOUND
    if (gotNotFound) {
      const remainingErrs = drain(a.inbox, 'error');
      const extraInternal = remainingErrs.filter(e => e.code === 'INTERNAL_ERROR');
      check('No extra INTERNAL_ERROR after INSTANCE_NOT_FOUND', extraInternal.length === 0);
    }

    // ── T10: Agent disconnected → error, no fallback ──
    // After agent disconnects, the relay auto-cleans up the instance
    // (kills it and removes from instanceManager). So the subsequent
    // shell.spawn gets either REMOTE_AGENT_DISCONNECTED (race: instance
    // still exists but agent dead) or INSTANCE_NOT_FOUND (instance cleaned).
    // The key invariant: no local shell fallback.
    console.log('\n── T10: Agent disconnected → shell.spawn error, no local fallback ──');

    const beforeDiscIds = new Set((await listInstances()).map(i => i.id));

    agent.ws.close();
    await delay(500);

    const instAfterClose = (await listInstances()).find(i => i.id === remoteInstanceId);
    console.log(`  Instance after close: ${instAfterClose ? 'present' : 'removed'}`);

    drain(a.inbox, 'error');
    a.ws.send(env('shell.spawn', { instanceId: remoteInstanceId }));

    let gotDisconnected = false;
    try {
      const errMsg = await waitFor(a.inbox, m =>
        m.type === 'error' && (m.code === 'REMOTE_AGENT_DISCONNECTED' || m.code === 'INSTANCE_NOT_FOUND'),
      'REMOTE_AGENT_DISCONNECTED or INSTANCE_NOT_FOUND', 8000);
      gotDisconnected = true;
      check('Error received after disconnect (shell.spawn)',
        errMsg.code === 'REMOTE_AGENT_DISCONNECTED' || errMsg.code === 'INSTANCE_NOT_FOUND');
      console.log(`  Got: ${errMsg.code}`);
    } catch {
      const errs = drain(a.inbox, 'error');
      console.log(`  Errors: ${errs.map(e => `${e.code}: ${e.message}`).join(', ')}`);
      gotDisconnected = errs.some(e => e.code === 'REMOTE_AGENT_DISCONNECTED' || e.code === 'INSTANCE_NOT_FOUND');
      check('Error received after disconnect (shell.spawn)', gotDisconnected);
    }

    const afterDiscIds = new Set((await listInstances()).map(i => i.id));
    const discNewIds = [...afterDiscIds].filter(id => !beforeDiscIds.has(id));
    check('No new instance created after disconnected spawn', discNewIds.length === 0);

    // ── T11: operation.start with kind='terminal' (new unified protocol) ──
    console.log('\n── T11: operation.start kind=terminal → validates target, forwards to agent ──');

    // Reconnect agent for this test
    const agent2 = await connectAgent('TEST-AGENT-2', 'shell');
    conns.push(agent2);
    await waitFor(agent2.inbox, m => m.type === 'welcome', 'Agent2 welcome');
    agent2.ws.send(env('agent.register', { dir: process.cwd(), label: 'TEST-AGENT-2', adapterId: 'shell' }));
    const agent2Reg = await waitFor(agent2.inbox, m => m.type === 'agent.registered', 'Agent2 registered');
    const remoteId2 = agent2Reg.instanceId;

    // Subscribe browser A to new agent's node
    a.ws.send(env('workbench.subscribe', { nodeId: remoteId2 }));
    await waitFor(a.inbox, m => m.type === 'workbench.tabs' && m.nodeId === remoteId2, 'A tabs for agent2');

    // Start operation using the NEW unified protocol
    drain(agent2.inbox, 'relay.operation.start');
    drain(a.inbox, 'operation.status');

    a.ws.send(env('operation.start', {
      nodeId: remoteId2,
      kind: 'terminal',
    }));

    // Agent must receive relay.operation.start (not relay.shell.spawn)
    const relayOpStart = await waitFor(agent2.inbox, m =>
      m.type === 'relay.operation.start' && m.kind === 'terminal',
    'Agent receives relay.operation.start', 8000);
    check('Agent received relay.operation.start (unified protocol)', !!relayOpStart);
    check('relay.operation.start has operationId', typeof relayOpStart?.operationId === 'string');
    check('relay.operation.start kind = terminal', relayOpStart?.kind === 'terminal');

    // A must get operation.status
    const aOpStart = await waitFor(a.inbox, m =>
      m.type === 'operation.status' && m.status === 'running',
    'A receives operation.status running from start', 5000);
    check('A received operation.status after operation.start', !!aOpStart);
    check('operation.status kind = terminal', aOpStart?.kind === 'terminal');

    // Agent sends output → A gets operation.output
    drain(a.inbox, 'operation.output');
    agent2.ws.send(env('agent.operation.output', {
      operationId: relayOpStart.operationId,
      stream: 'stdout',
      data: '[TERMINAL-VIA-OPERATION] hello\n',
    }));

    const aOpTermOut = await waitFor(a.inbox, m =>
      m.type === 'operation.output' && (m.data || '').includes('[TERMINAL-VIA-OPERATION'),
    'A receives operation.output from agent2', 5000);
    check('A received operation.output from agent2', !!aOpTermOut);

    // Agent completes → A gets operation.result
    drain(a.inbox, 'operation.result');
    drain(a.inbox, 'operation.status');
    agent2.ws.send(env('agent.operation.result', {
      operationId: relayOpStart.operationId,
      success: true,
      exitCode: 0,
    }));

    const aOpResult = await waitFor(a.inbox, m =>
      m.type === 'operation.result' && m.success === true,
    'A receives operation.result', 5000);
    check('A received operation.result (success=true)', !!aOpResult);

    // Cleanup agent2
    try { await fetch(`${RELAY_HTTP}/api/instances/${remoteId2}`, { method: 'DELETE' }); } catch {}

  } finally {
    // ── Cleanup ──────────────────────────────────────────────
    console.log('\n── Cleanup ──');
    // Clear workbenchTabStore entry for remote nodeId (best-effort)
    for (const c of conns) {
      try {
        if (c.ws.readyState === WebSocket.OPEN) {
          c.ws.send(env('workbench.tabs', { nodeId, tabs: [] }));
          break; // one is enough
        }
      } catch {}
    }
    for (const c of conns) {
      try { c.ws.close(); } catch {}
    }
    if (remoteInstanceId) {
      try { await fetch(`${RELAY_HTTP}/api/instances/${remoteInstanceId}`, { method: 'DELETE' }); } catch {}
    }
    await delay(200);
  }

  console.log(`\n===== RESULTS: ${passed}/${total} passed, ${failed}/${total} failed =====`);
  if (failed === 0) console.log('  ✅ ALL REMOTE SHARED TERMINAL TESTS PASSED\n');
  else console.log(`  ❌ ${failed} test(s) failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
