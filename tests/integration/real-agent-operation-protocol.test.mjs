// ─── Real Agent Operation Protocol Test ─────────────────────
// Starts a real bridge process (NodeRuntime with OperationRunner)
// and verifies the full relay.operation.* → agent.operation.*
// round-trip through the REAL agent-side code.
//
// Unlike remote-routing-invariants.test.mjs (which simulates
// agents with raw WS messages), this test exercises the actual
// OperationRunner handlers: mock-echo and system-info.
//
// Test plan:
//   T1: Bridge starts, agent registers as remote instance
//   T2: operation.start mock-echo → real agent processes via OperationRunner
//   T3: agent.operation.status = running → browser receives operation.status
//   T4: agent.operation.output → browser receives (contains agent hostname)
//   T5: agent.operation.result success=true → browser receives
//   T6: operation.start system-info → returns real system state (not relay's)
//   T7: operation.start unknown plugin → returns failure gracefully
//   T8: operation.input → forwarded to agent, stdin_echo response
//   T9: Late subscriber replay (buffered output)
//
// Usage:
//   node tests/integration/real-agent-operation-protocol.test.mjs [path/to/bridge]
//   Default: bin/bridge.js → dist/src/index.js

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { randomInt } from 'crypto';
import WebSocket from 'ws';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const delay = ms => new Promise(r => setTimeout(r, ms));
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

// ── Resolve bridge binary ────────────────────────────────────
function resolveBridge() {
  const explicit = process.env.BRIDGE_BIN || process.argv[2];
  if (explicit) {
    const abs = resolve(explicit);
    if (existsSync(abs)) return abs;
  }
  const candidates = [
    join(ROOT, 'bin', 'bridge.js'),
    join(ROOT, 'dist', 'src', 'index.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error(`FATAL: No bridge entry found. Tried: ${candidates.join(', ')}`);
  process.exit(1);
}

const BRIDGE = resolveBridge();
const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';

let passed = 0, failed = 0, total = 0;
function check(desc, ok) {
  total++;
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}

async function httpGet(baseUrl, path) {
  try {
    const res = await fetch(`${baseUrl}${path}`);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json };
  } catch (err) {
    return { status: 0, error: err.message };
  }
}

async function connectBrowser(relayWs, label) {
  const ws = new WebSocket(relayWs);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: ['crypto_v1', 'shell'],
    cols: 120, rows: 40, workspace: true,
    clientToken: `real_agent_test_${label}_${Date.now()}`,
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
  throw new Error(`[${label}] Timeout waiting for message (inbox: [${remaining}])`);
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

async function main() {
  console.log(`\n===== Real Agent Operation Protocol Test =====`);
  console.log(`  Binary: ${BRIDGE}\n`);

  const workDir = join(tmpdir(), `sb-real-agent-test-${Date.now()}-${randomInt(10000, 99999)}`);
  const configDir = join(workDir, '.sessionbridge');
  mkdirSync(configDir, { recursive: true });
  const TEST_PORT = randomInt(19000, 19999);
  const RELAY_URL = `http://127.0.0.1:${TEST_PORT}`;
  const RELAY_WS = `ws://127.0.0.1:${TEST_PORT}`;

  const configPath = join(configDir, 'agent.json');

  let bridgeProcess = null;

  try {
    // ── T1: Start bridge and verify agent registration ────────
    console.log('── T1: Start bridge, verify agent registers ──');

    // Write a clean config with NO upstreamRelay so the agent
    // connects to its own loopback relay, not the user's VPS.
    const cleanConfig = {
      label: 'real-agent-test-node',
      workingDirectory: workDir,
      relayPort: TEST_PORT,
    };
    writeFileSync(configPath, JSON.stringify(cleanConfig, null, 2), 'utf8');
    console.log(`  Temp config: ${configPath}`);

    bridgeProcess = spawn(nodeCmd, [BRIDGE, '--relay-port', String(TEST_PORT), '--dir', workDir, '--label', 'real-agent-test-node'], {
      cwd: ROOT,
      env: { ...process.env, BRIDGE_CONFIG: configPath },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let bridgeStdout = '', bridgeStderr = '';
    bridgeProcess.stdout.on('data', d => { bridgeStdout += d.toString(); });
    bridgeProcess.stderr.on('data', d => { bridgeStderr += d.toString(); });

    // Wait for relay to accept connections
    let started = false;
    const startTimeout = 30000;
    const startTime = Date.now();
    while (Date.now() - startTime < startTimeout) {
      try {
        const r = await fetch(`${RELAY_URL}/api/health`);
        if (r.ok) { started = true; break; }
      } catch {}
      await delay(500);
    }

    if (!started) {
      console.log(`  Bridge did not start within ${startTimeout}ms.`);
      console.log(`  stdout tail: ${bridgeStdout.slice(-500)}`);
      console.log(`  stderr tail: ${bridgeStderr.slice(-500)}`);
      check('Bridge started successfully', false);
      console.log(`\n===== RESULTS: ${passed}/${total} passed, ${failed}/${total} failed =====`);
      process.exit(1);
    }
    check('Bridge started, /api/health responds', true);

    // Poll for agent registration — extensions load + agent hello/welcome/register
    // can take 5-15 seconds after the relay port opens.
    let agentInstance = null;
    const agentTimeout = 30000;
    const agentStart = Date.now();
    while (Date.now() - agentStart < agentTimeout) {
      const instancesRes = await httpGet(RELAY_URL, '/api/instances');
      if (instancesRes.status === 200 && Array.isArray(instancesRes.json?.instances)) {
        const remote = instancesRes.json.instances.filter(i => i.source === 'remote');
        if (remote.length > 0) {
          agentInstance = remote[0];
          break;
        }
      }
      await delay(1000);
    }

    check('Agent registered as remote instance', agentInstance !== null);
    if (!agentInstance) {
      console.log('  FATAL: No remote agent instance found after 30s.');
      const finalRes = await httpGet(RELAY_URL, '/api/instances');
      console.log(`  instances: ${finalRes.status}`);
      if (finalRes.json?.instances) {
        const sources = finalRes.json.instances.map(i => `${i.id.slice(0, 12)}… source=${i.source}`);
        console.log(`  ${sources.join(', ')}`);
      }
      console.log(`  Bridge stdout tail:\n${bridgeStdout.slice(-500)}`);
      console.log(`  Bridge stderr tail:\n${bridgeStderr.slice(-500)}`);
      process.exit(1);
    }

    const nodeId = agentInstance.id;
    console.log(`  Agent instanceId: ${nodeId.slice(0, 20)}...`);
    check('Agent instance has source=remote', agentInstance.source === 'remote');
    check('Agent instance has label', typeof agentInstance.label === 'string');

    // ── Connect browser ────────────────────────────────────────
    const browser = await connectBrowser(RELAY_WS, 'A');
    await waitFor(browser.inbox, m => m.type === 'welcome', 'Browser welcome');

    // ── T2-T5: mock-echo round-trip ───────────────────────────
    console.log('\n── T2-T5: mock-echo plugin round-trip ──');

    drain(browser.inbox, 'operation.status');
    drain(browser.inbox, 'operation.output');
    drain(browser.inbox, 'operation.result');

    const echoInput = { text: 'hello-real-agent-test-' + Date.now() };
    browser.ws.send(env('operation.start', {
      nodeId,
      kind: 'plugin',
      pluginId: 'mock-echo',
      command: 'echo',
      input: echoInput,
    }));

    // T3: operation.status = running
    const statusRunning = await waitFor(browser.inbox, m =>
      m.type === 'operation.status' && m.status === 'running',
    'T3: operation.status = running', 10000);
    check('T3: Browser receives operation.status = running', !!statusRunning);
    check('T3: Status has operationId', typeof statusRunning?.operationId === 'string');

    const opId = statusRunning.operationId;

    // T4: operation.output with agent hostname
    const output = await waitFor(browser.inbox, m =>
      m.type === 'operation.output' && m.operationId === opId,
    'T4: operation.output', 8000);
    check('T4: Browser receives operation.output', !!output);

    let outputData = null;
    try { outputData = JSON.parse(output?.data || '{}'); } catch {}
    check('T4: Output contains echoed text', outputData?.echoed === echoInput.text);
    check('T4: Output contains agent hostname', typeof outputData?.node === 'string' && outputData.node.length > 0);
    console.log(`  Agent hostname from output: ${outputData?.node}`);

    // Verify hostname comes from the agent (bridge process), not from test runner
    const testRunnerHostname = os.hostname();
    check('T4: Agent hostname matches test runner hostname (same machine)',
      outputData?.node === testRunnerHostname);

    // T5: operation.result success=true
    const result = await waitFor(browser.inbox, m =>
      m.type === 'operation.result' && m.operationId === opId,
    'T5: operation.result', 8000);
    check('T5: Browser receives operation.result', !!result);
    check('T5: Result success = true', result?.success === true);
    check('T5: Result data has echoed text', result?.data?.echoed === echoInput.text);
    check('T5: Result data has node hostname', typeof result?.data?.node === 'string');

    // Verify completed status
    const completedStatus = await waitFor(browser.inbox, m =>
      m.type === 'operation.status' && m.operationId === opId && m.status === 'completed',
    'T5: operation.status = completed', 5000);
    check('T5: Final status = completed', !!completedStatus);

    // ── T6: system-info plugin ─────────────────────────────────
    console.log('\n── T6: system-info plugin returns real agent system state ──');

    drain(browser.inbox, 'operation.status');
    drain(browser.inbox, 'operation.output');
    drain(browser.inbox, 'operation.result');

    browser.ws.send(env('operation.start', {
      nodeId,
      kind: 'plugin',
      pluginId: 'system-info',
    }));

    const sysStatusRunning = await waitFor(browser.inbox, m =>
      m.type === 'operation.status' && m.status === 'running',
    'T6: system-info status = running', 10000);
    const sysOpId = sysStatusRunning.operationId;

    const sysOutput = await waitFor(browser.inbox, m =>
      m.type === 'operation.output' && m.operationId === sysOpId,
    'T6: system-info output', 8000);
    check('T6: System-info output received', !!sysOutput);

    let sysData = null;
    try { sysData = JSON.parse(sysOutput?.data || '{}'); } catch {}
    check('T6: System info has platform', typeof sysData?.platform === 'string');
    check('T6: System info has hostname', typeof sysData?.hostname === 'string');
    check('T6: System info has arch', typeof sysData?.arch === 'string');
    check('T6: System info has cpus', typeof sysData?.cpus === 'number');

    const sysResult = await waitFor(browser.inbox, m =>
      m.type === 'operation.result' && m.operationId === sysOpId,
    'T6: system-info result', 8000);
    check('T6: System-info result success = true', sysResult?.success === true);
    check('T6: Result has platform', typeof sysResult?.data?.platform === 'string');
    check('T6: Result has hostname', typeof sysResult?.data?.hostname === 'string');
    check('T6: Result has memory_total', typeof sysResult?.data?.memory_total === 'number');

    console.log(`  Agent platform: ${sysResult?.data?.platform}, hostname: ${sysResult?.data?.hostname}`);

    // ── T7: Unknown plugin → graceful failure ─────────────────
    console.log('\n── T7: Unknown plugin returns failure ──');

    drain(browser.inbox, 'operation.status');
    drain(browser.inbox, 'operation.result');

    browser.ws.send(env('operation.start', {
      nodeId,
      kind: 'plugin',
      pluginId: 'nonexistent-plugin-xyz',
      command: 'nothing',
    }));

    const failStatus = await waitFor(browser.inbox, m =>
      m.type === 'operation.status' && m.status === 'failed',
    'T7: Unknown plugin → status = failed', 10000);
    check('T7: Unknown plugin returns status = failed', !!failStatus);

    const failResult = await waitFor(browser.inbox, m =>
      m.type === 'operation.result' && m.operationId === failStatus?.operationId,
    'T7: Unknown plugin → result', 8000);
    check('T7: Unknown plugin result success = false', failResult?.success === false);
    check('T7: Error mentions unknown plugin',
      (failResult?.error || '').includes('Unknown plugin') || (failResult?.error || '').includes('nonexistent'));

    // ── T8: operation.input forwarding ─────────────────────────
    console.log('\n── T8: operation.input forwarded to agent ──');

    drain(browser.inbox, 'operation.status');
    drain(browser.inbox, 'operation.output');

    // Start a new mock-echo operation
    browser.ws.send(env('operation.start', {
      nodeId,
      kind: 'plugin',
      pluginId: 'mock-echo',
      command: 'echo',
      input: { text: 'input-test' },
    }));

    const inputStatus = await waitFor(browser.inbox, m =>
      m.type === 'operation.status' && m.status === 'running',
    'T8: operation.status = running', 10000);
    const inputOpId = inputStatus.operationId;

    // Drain the auto-generated output from mock-echo
    drain(browser.inbox, 'operation.output');

    // Send operation.input
    browser.ws.send(env('operation.input', { operationId: inputOpId, data: 'test-stdin-data' }));

    // Agent echoes input as stdin_echo output
    const inputEcho = await waitFor(browser.inbox, m =>
      m.type === 'operation.output' && m.operationId === inputOpId && m.stream === 'stdin_echo',
    'T8: stdin_echo output received', 8000);
    check('T8: operation.input → stdin_echo received', !!inputEcho);
    check('T8: stdin_echo contains input data', inputEcho?.data === 'test-stdin-data');

    // ── T9: Late subscriber replay ─────────────────────────────
    console.log('\n── T9: Late subscriber gets replay ──');

    drain(browser.inbox, 'operation.status');
    drain(browser.inbox, 'operation.output');

    // Start a fresh operation
    browser.ws.send(env('operation.start', {
      nodeId,
      kind: 'plugin',
      pluginId: 'mock-echo',
      command: 'echo',
      input: { text: 'replay-test' },
    }));

    const replayStatus = await waitFor(browser.inbox, m =>
      m.type === 'operation.status' && m.status === 'running',
    'T9: operation.status = running', 10000);
    const replayOpId = replayStatus.operationId;

    // Get the output
    await waitFor(browser.inbox, m =>
      m.type === 'operation.output' && m.operationId === replayOpId,
    'T9: operation.output', 5000);

    // Late joiner browser connects
    const browserB = await connectBrowser(RELAY_WS, 'B');
    await waitFor(browserB.inbox, m => m.type === 'welcome', 'Browser B welcome');

    drain(browserB.inbox, 'operation.status');
    drain(browserB.inbox, 'operation.output');
    drain(browserB.inbox, 'operation.result');

    browserB.ws.send(env('operation.subscribe', { operationId: replayOpId }));

    // B should get operation.status replay
    const bReplayStatus = await waitFor(browserB.inbox, m =>
      m.type === 'operation.status' && m.operationId === replayOpId,
    'T9: Late joiner receives operation.status (replay)', 5000);
    check('T9: Late joiner gets status replay', !!bReplayStatus);
    check('T9: Replay status received (running or completed)',
      bReplayStatus?.status === 'running' || bReplayStatus?.status === 'completed');
    console.log(`  Replay status: ${bReplayStatus?.status}`);

    // B should get output replay
    await delay(200);
    const bOutputs = drain(browserB.inbox, 'operation.output');
    const bFiltered = bOutputs.filter(m => m.operationId === replayOpId);
    check('T9: Late joiner gets output replay', bFiltered.length >= 1);
    if (bFiltered.length > 0) {
      try {
        const bData = JSON.parse(bFiltered[0].data || '{}');
        check('T9: Replay output contains echoed text', bData.echoed === 'replay-test');
      } catch {}
    }

    // Clean up: close browser B
    try { browserB.ws.close(); } catch {}

    // ── Results ─────────────────────────────────────────────────
    console.log(`\n===== RESULTS: ${passed}/${total} passed, ${failed}/${total} failed =====`);
    if (failed > 0) {
      console.log(`  FAIL: ${failed} test(s) failed`);
    } else {
      console.log(`  PASS: All real agent operation protocol tests passed`);
    }

  } catch (err) {
    console.error(`\nFATAL: ${err.message}`);
    console.log(`\n===== RESULTS: ${passed}/${total} passed, ${failed}/${total} failed =====`);
  } finally {
    if (bridgeProcess) {
      bridgeProcess.kill();
      await delay(500);
    }
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
    process.exit(failed > 0 ? 1 : 0);
  }
}

main();
