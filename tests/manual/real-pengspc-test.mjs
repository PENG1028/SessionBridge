// Real PENGSPC shell test — spawns shell on PENGSPC, types hostname/whoami,
// verifies output is from PENGSPC (Windows), and B late-joins with replay
import WebSocket from 'ws';

const RELAY = 'ws://43.160.241.180:8080';

const delay = ms => new Promise(r => setTimeout(r, ms));
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

let passed = 0, failed = 0;
function check(desc, ok) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}

async function connectBrowser(label) {
  const ws = new WebSocket(RELAY);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: ['shell'],
    clientToken: `real_peng_${label}_${Date.now()}`,
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
  console.log('\n===== Real PENGSPC Shell Test =====');
  console.log(`  Relay: ${RELAY}\n`);

  // First find PENGSPC instance
  console.log('── Step 0: Find PENGSPC instance ──');
  const resp = await fetch('http://43.160.241.180:8080/api/health');
  const health = await resp.json();
  const peng = health.instances.find(i => i.label === 'PENGSPC');
  if (!peng) {
    console.log('  FAIL: PENGSPC agent not found. Is the agent running?');
    process.exit(1);
  }
  const INSTANCE_ID = peng.id;
  check('Step0: PENGSPC found', peng.source === 'remote' && peng.label === 'PENGSPC');
  console.log(`  InstanceId: ${INSTANCE_ID}\n`);

  // T1: Browser A connects, spawns shell on PENGSPC
  console.log('── T1: Browser A spawns real shell on PENGSPC ──');
  const A = await connectBrowser('A');
  await waitFor(A.inbox, m => m.type === 'welcome', 'A welcome');

  A.ws.send(env('shell.spawn', { instanceId: INSTANCE_ID }));
  await delay(500);

  // Wait for shell.ready
  let ready = null;
  try { ready = await waitFor(A.inbox, m =>
    m.type === 'shell.ready' || m.type === 'shell_ready', 'shell.ready', 15000);
  } catch (e) {
    // Shell might already be spawned, check for output
    console.log(`  Note: shell.ready timeout, checking for output...`);
  }
  check('T1a: Shell spawned on PENGSPC', ready !== null || A.inbox.some(s => s.includes('shell.output')));

  // Drain any initial output (prompt etc.)
  drain(A.inbox, 'shell.output');
  drain(A.inbox, 'shell_output');
  await delay(500);

  // T2: Publish surface for PENGSPC
  console.log('── T2: surface.publish for PENGSPC terminal ──');
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
  check('T2a: surface.published received', !!SURFACE_ID);
  console.log(`  SurfaceId: ${SURFACE_ID}\n`);

  // T3: Type hostname on PENGSPC terminal
  console.log('── T3: hostname → doit venir de PENGSPC (Windows), pas Ubuntu ──');
  drain(A.inbox, 'shell.output');
  drain(A.inbox, 'runtime.output');

  A.ws.send(env('shell.input', { instanceId: INSTANCE_ID, data: 'hostname\r\n' }));
  await delay(1500); // Wait for command to execute

  const shellOutputs = drain(A.inbox, 'shell.output');
  const rtOutputs = drain(A.inbox, 'runtime.output');

  const shellText = shellOutputs.map(o => o.data).join('');
  const rtText = rtOutputs.map(o => o.data).join('');

  console.log(`  shell.output (${shellOutputs.length} msgs): ${JSON.stringify(shellText.slice(0, 200))}`);
  console.log(`  runtime.output (${rtOutputs.length} msgs): ${JSON.stringify(rtText.slice(0, 200))}`);

  // The key assertions: output must NOT contain 'ubuntu' or 'VM-0-15'
  const allOutput = shellText + rtText;
  const isNotUbuntu = !allOutput.toLowerCase().includes('ubuntu') && !allOutput.includes('VM-0-15');
  check('T3a: Output does NOT contain ubuntu (real PENGSPC)', isNotUbuntu);

  // Should contain some hostname-like output
  const hasHostname = allOutput.length > 0;
  check('T3b: Got shell output from PENGSPC', hasHostname);

  // T4: Type whoami
  console.log('\n── T4: whoami → doit venir de PENGSPC ──');
  drain(A.inbox, 'shell.output');
  drain(A.inbox, 'runtime.output');

  A.ws.send(env('shell.input', { instanceId: INSTANCE_ID, data: 'whoami\r\n' }));
  await delay(1500);

  const shellOut2 = drain(A.inbox, 'shell.output');
  const rtOut2 = drain(A.inbox, 'runtime.output');

  const shellText2 = shellOut2.map(o => o.data).join('');
  const rtText2 = rtOut2.map(o => o.data).join('');
  console.log(`  shell.output (${shellOut2.length} msgs): ${JSON.stringify(shellText2.slice(0, 200))}`);
  console.log(`  runtime.output (${rtOut2.length} msgs): ${JSON.stringify(rtText2.slice(0, 200))}`);

  const allOut2 = shellText2 + rtText2;
  check('T4a: whoami output received', allOut2.length > 0);
  check('T4b: Bridge from real shell to runtime.output works', rtOut2.length > 0);

  // T5: Browser B late-joins
  console.log('\n── T5: Browser B late-join → sees history ──');
  // Send one more command for history
  A.ws.send(env('shell.input', { instanceId: INSTANCE_ID, data: 'echo PENGSPC-TEST-MARKER\r\n' }));
  await delay(800);

  drain(A.inbox, 'shell.output');
  drain(A.inbox, 'runtime.output');

  const B = await connectBrowser('B');
  await waitFor(B.inbox, m => m.type === 'welcome', 'B welcome');

  B.ws.send(env('surface.subscribeNode', { nodeId: INSTANCE_ID }));
  const replay = await waitFor(B.inbox, m => m.type === 'runtime.replay', 'B replay', 15000);

  const replayOutputs = replay.outputs || [];
  const replayText = replayOutputs.map(o => o.data).join('');
  check('T5a: B received runtime.replay', !!replay);
  check('T5b: Replay has outputs from real shell', replayOutputs.length > 0);
  check('T5c: Replay does NOT contain ubuntu', !replayText.toLowerCase().includes('ubuntu'));
  check('T5d: Replay contains PENGSPC-TEST-MARKER (proves live output made it to replay)',
    replayText.includes('PENGSPC-TEST-MARKER'));
  console.log(`  Replay has ${replayOutputs.length} output chunks`);
  console.log(`  Replay text sample: ${JSON.stringify(replayText.slice(0, 200))}`);

  // Cleanup
  A.ws.close();
  B.ws.close();

  console.log(`\n===== RESULTS: ${passed}/${passed + failed} passed =====`);
  if (failed) {
    console.log(`  FAIL: ${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`  PASS: Real PENGSPC shell verified`);
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
