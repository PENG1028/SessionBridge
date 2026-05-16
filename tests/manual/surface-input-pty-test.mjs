// Surface Input → Real PTY Test
// Proves that operation.input for terminal surfaces actually reaches PENGSPC shell,
// not just stdin_echo. This is the critical missing verification for UI surface tabs.
//
// Expected behavior: operation.input → relay redirects to agent.stdin → PTY → real output
// Current reality:    operation.input → relay sends relay.operation.input → OperationRunner → stdin_echo
//
// Test flow:
// 1. Connect VPS relay, find PENGSPC
// 2. Browser A shell.spawn → real PowerShell on PENGSPC
// 3. Browser A surface.publish → surfaceId + operationId
// 4. Browser B surface.subscribeNode → gets surface list
// 5. Browser B sends operation.input { operationId, data: "echo SURFACE-INPUT-MARKER\r\n" }
// 6. Assert both A and B receive runtime.output with SURFACE-INPUT-MARKER
// 7. Assert output is NOT stdin_echo (no "STDIN_ECHO:" prefix)
// 8. Assert no ubuntu/VM-0-15 in output

import WebSocket from 'ws';

const RELAY = 'ws://43.160.241.180:8080';

const delay = ms => new Promise(r => setTimeout(r, ms));
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

let passed = 0, failed = 0;
function check(desc, ok, detail = '') {
  if (ok) passed++; else failed++;
  const detailStr = detail ? ` ${detail}` : '';
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}${detailStr}`);
}

async function connectBrowser(label) {
  const ws = new WebSocket(RELAY);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: ['shell'],
    clientToken: `surface_pty_${label}_${Date.now()}`,
  }));
  return { ws, inbox, label };
}

async function waitFor(inbox, predicate, label, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (let i = 0; i < inbox.length; i++) {
      try {
        const m = JSON.parse(inbox[i]);
        const msg = m.v === 1 && m.body ? { ...m.body, type: m.type } : m;
        if (predicate(msg)) { inbox.splice(i, 1); return msg; }
      } catch {}
    }
    await delay(100);
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

async function main() {
  console.log('\n===== Surface operation.input → Real PENGSPC PTY Test =====');
  console.log(`  Relay: ${RELAY}\n`);

  // Step 0: Find PENGSPC
  console.log('── Step 0: Find PENGSPC ──');
  const resp = await fetch('http://43.160.241.180:8080/api/health');
  const health = await resp.json();
  const peng = health.instances.find(i => i.label === 'PENGSPC');
  if (!peng) {
    console.log('  FAIL: PENGSPC agent not found. Start the agent first.');
    process.exit(1);
  }
  const INSTANCE_ID = peng.id;
  check('Step0: PENGSPC found', true, `instanceId=${INSTANCE_ID}`);
  console.log();

  // T1: Browser A spawns shell on PENGSPC
  console.log('── T1: Browser A spawns real shell on PENGSPC ──');
  const A = await connectBrowser('A');
  await waitFor(A.inbox, m => m.type === 'welcome', 'A welcome');

  A.ws.send(env('shell.spawn', { instanceId: INSTANCE_ID }));
  await delay(1000);

  // Wait for shell output (prompt)
  let shellReady = false;
  try { await waitFor(A.inbox, m => m.type === 'shell.ready' || m.type === 'shell_ready', 'shell.ready', 12000); shellReady = true; } catch {}
  if (!shellReady) {
    // Check for output anyway
    const hasOutput = A.inbox.some(s => s.includes('shell.output') || s.includes('shell_output'));
    shellReady = hasOutput;
  }
  check('T1: Shell spawned on PENGSPC', shellReady);
  drain(A.inbox, 'shell.output');
  drain(A.inbox, 'shell_output');
  console.log();

  // T2: surface.publish to create shared surface
  console.log('── T2: surface.publish → surfaceId + operationId ──');
  A.ws.send(env('surface.publish', {
    nodeId: INSTANCE_ID,
    title: 'Terminal (PENGSPC)',
    viewType: 'terminal',
    scope: 'node',
    shared: true,
    runtimeRef: { kind: 'terminal', instanceId: INSTANCE_ID },
    replayPolicy: { mode: 'tail', lines: 5000, bytes: 500000 },
  }));

  const published = await waitFor(A.inbox, m => m.type === 'surface.published', 'surface.published');
  const SURFACE_ID = published.surfaceId;
  const OPERATION_ID = published.surface?.runtimeRef?.operationId;
  check('T2a: surface.published received', !!SURFACE_ID, `surfaceId=${SURFACE_ID}`);
  check('T2b: operationId present', !!OPERATION_ID, `operationId=${OPERATION_ID}`);
  console.log();

  // T2c: surface.publish for terminal MUST NOT trigger a phantom
  // operation failure on the agent. Terminal surfaces use the shell PTY
  // (shell.spawn / relay.shell.spawn) and do NOT send relay.operation.start
  // to OperationRunner, which has no terminal handler.
  console.log('── T2c: No phantom terminal operation failure ──');
  await delay(3000); // Wait for any spurious operation failure to arrive

  const phantomFailure = A.inbox.find(s => {
    try {
      const m = JSON.parse(s);
      const msg = m.v === 1 && m.body ? { ...m.body, type: m.type } : m;
      if (msg.type === 'runtime.result' && msg.success === false) return true;
      if (msg.type === 'runtime.result' && msg.error) return true;
      if (msg.type === 'error') return true;
      const text = JSON.stringify(msg);
      if (text.includes('No handler registered') || text.includes('no handler')) return true;
    } catch { return false; }
  });
  const noFailureText = phantomFailure
    ? ` (found: ${phantomFailure.slice(0, 200)})`
    : '';
  check('T2c: No phantom operation failure after terminal surface.publish', !phantomFailure, noFailureText);

  // Drain initial runtime stuff
  drain(A.inbox, 'runtime.status');
  drain(A.inbox, 'runtime.output');
  drain(A.inbox, 'runtime.result');
  // T3: Browser B connects and subscribes to node
  console.log('── T3: Browser B subscribes to node ──');
  const B = await connectBrowser('B');
  await waitFor(B.inbox, m => m.type === 'welcome', 'B welcome');

  B.ws.send(env('surface.subscribeNode', { nodeId: INSTANCE_ID }));
  const surfaceList = await waitFor(B.inbox, m => m.type === 'surface.list', 'B surface.list');
  check('T3: B received surface.list', !!surfaceList);
  drain(B.inbox, 'runtime.replay');
  drain(B.inbox, 'runtime.status');
  drain(B.inbox, 'runtime.output');
  console.log();

  // T4: THE KEY TEST — B sends operation.input, assert it reaches real PTY
  // Use `cd` and `hostname` as commands — their output does NOT contain the command text,
  // so we can distinguish real PTY output from stdin_echo.
  console.log('── T4: operation.input → real PENGSPC PTY (KEY TEST) ──');
  drain(A.inbox, 'runtime.output');
  drain(B.inbox, 'runtime.output');
  drain(A.inbox, 'shell.output');
  drain(B.inbox, 'shell.output');

  // First send `cd` to get a clean prompt, then `hostname` for a reliable assertion
  B.ws.send(env('operation.input', {
    operationId: OPERATION_ID,
    data: 'cd\r\n',
  }));
  await delay(500);

  B.ws.send(env('operation.input', {
    operationId: OPERATION_ID,
    data: 'hostname\r\n',
  }));

  await delay(2000); // Wait for round-trip

  // Collect ALL output from both browsers
  const aRt = drain(A.inbox, 'runtime.output');
  const bRt = drain(B.inbox, 'runtime.output');
  const aShell = drain(A.inbox, 'shell.output');
  const bShell = drain(B.inbox, 'shell.output');

  const allA = [...aRt, ...aShell].map(o => o.data).join('');
  const allB = [...bRt, ...bShell].map(o => o.data).join('');

  console.log(`  A runtime.output: ${aRt.length} msgs`);
  console.log(`  A shell.output:   ${aShell.length} msgs`);
  console.log(`  B runtime.output: ${bRt.length} msgs`);
  console.log(`  B shell.output:   ${bShell.length} msgs`);
  console.log(`  All A output: ${JSON.stringify(allA.slice(0, 400))}`);
  console.log(`  All B output: ${JSON.stringify(allB.slice(0, 400))}`);

  // KEY: hostname output must be PENGSPC or the user's PC name
  // This proves the command actually RAN on the PTY, not just echo'd back
  const aHasHostname = allA.includes('PENGSPC');
  const bHasHostname = allB.includes('PENGSPC');
  check('T4a: A sees PENGSPC hostname via operation.input', aHasHostname,
    aHasHostname ? '' : ` (A output: "${allA.slice(0, 200)}")`);
  check('T4b: B sees PENGSPC hostname via operation.input', bHasHostname,
    bHasHostname ? '' : ` (B output: "${allB.slice(0, 200)}")`);

  // Must NOT be stdin_echo — the stream field reveals the truth
  const isStdinEcho = aRt.some(o => o.stream === 'stdin_echo') ||
    bRt.some(o => o.stream === 'stdin_echo') ||
    allA.includes('stdin_echo') || allB.includes('stdin_echo');
  check('T4c: Output stream is NOT stdin_echo (real PTY)', !isStdinEcho,
    isStdinEcho ? ' GOT stdin_echo stream — input NOT reaching real PTY!' : '');

  // Must NOT contain ubuntu
  const hasUbuntu = allA.toLowerCase().includes('ubuntu') || allB.toLowerCase().includes('ubuntu') ||
    allA.includes('VM-0-15') || allB.includes('VM-0-15');
  check('T4d: Output from PENGSPC, not VPS', !hasUbuntu,
    hasUbuntu ? ' Output contains ubuntu!' : ` (hostname expected=PENGSPC)`);
  console.log();

  // T5: Verify that shell.input STILL works (A sends via old path)
  console.log('── T5: shell.input still works (comparison) ──');
  drain(A.inbox, 'shell.output');
  drain(B.inbox, 'shell.output');
  drain(A.inbox, 'runtime.output');
  drain(B.inbox, 'runtime.output');

  const MARKER2 = `SHELL-INPUT-${Date.now().toString(36)}`;
  A.ws.send(env('shell.input', { instanceId: INSTANCE_ID, data: `echo ${MARKER2}\r\n` }));

  await delay(1500);

  const aShell2 = drain(A.inbox, 'shell.output');
  const bRt2 = drain(B.inbox, 'runtime.output');
  const allShell2 = aShell2.map(o => o.data).join('');
  const allRt2 = bRt2.map(o => o.data).join('');

  check('T5a: shell.input reaches PTY (known-good path)', allShell2.includes(MARKER2));
  check('T5b: B gets runtime.output bridged from shell.input', allRt2.includes(MARKER2));
  console.log();

  // Cleanup
  A.ws.close();
  B.ws.close();

  // Summary
  console.log(`\n===== RESULTS: ${passed}/${passed + failed} passed =====`);
  if (failed) {
    console.log(`\n  DIAGNOSIS: operation.input is NOT reaching real PTY.`);
    console.log(`  Fix needed: relay-server.ts operation.input handler must redirect`);
    console.log(`  terminal surface input to sendStdin() instead of OperationRunner echo.`);
    process.exit(1);
  }
  console.log(`  PASS: operation.input → real PENGSPC PTY verified`);
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
