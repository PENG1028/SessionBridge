// Quick VPS bridge test — verifies shell-to-surface bridge with real PENGSPC agent
import WebSocket from 'ws';

const RELAY = 'ws://43.160.241.180:8080';
const INSTANCE_ID = 'inst_3_mp7obp76'; // PENGSPC

const delay = ms => new Promise(r => setTimeout(r, ms));
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

let passed = 0, failed = 0;
function check(desc, ok) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}

async function connect(label) {
  const ws = new WebSocket(RELAY);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: ['shell'],
    clientToken: `vps_test_${label}_${Date.now()}`,
  }));
  return { ws, inbox, label };
}

async function waitFor(inbox, predicate, label, timeout = 15000) {
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
  console.log('\n===== VPS Shell-to-Surface Bridge Test =====');
  console.log(`  Relay: ${RELAY}`);
  console.log(`  Instance: ${INSTANCE_ID}\n`);

  // T1: Connect Browser A, wait for welcome
  console.log('── T1: Browser A connects ──');
  const A = await connect('A');
  await waitFor(A.inbox, m => m.type === 'welcome', 'A welcome');
  check('T1: A received welcome', true);

  // T2: Publish surface for PENGSPC
  console.log('── T2: surface.publish for PENGSPC ──');
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
  check('T2a: surface.published received', !!SURFACE_ID);
  check('T2b: surface has operationId', !!OPERATION_ID);
  console.log(`  SurfaceId: ${SURFACE_ID}, OperationId: ${OPERATION_ID}\n`);

  // T3: Simulate agent.stdout → verify bridge to runtime.output
  console.log('── T3: agent.stdout → runtime.output bridge ──');

  A.ws.send(env('agent.stdout', {
    instanceId: INSTANCE_ID,
    data: 'PENGSPC:~$ ',
  }));
  await delay(300);

  const rtOutputs = drain(A.inbox, 'runtime.output');
  check('T3a: agent.stdout bridged to runtime.output', rtOutputs.length > 0);
  if (rtOutputs.length > 0) {
    check('T3b: runtime.output contains PENGSPC', rtOutputs.some(o => o.data.includes('PENGSPC')));
  }
  console.log(`  Got ${rtOutputs.length} runtime.output msgs\n`);

  // T4: Browser B late-join → gets replay
  console.log('── T4: Browser B late-join → replay ──');

  // First send more output
  A.ws.send(env('agent.stdout', { instanceId: INSTANCE_ID, data: 'whoami\r\n' }));
  await delay(50);
  A.ws.send(env('agent.stdout', { instanceId: INSTANCE_ID, data: 'peng\r\n' }));
  await delay(200);

  drain(A.inbox, 'runtime.output');

  const B = await connect('B');
  await waitFor(B.inbox, m => m.type === 'welcome', 'B welcome');

  B.ws.send(env('surface.subscribeNode', { nodeId: INSTANCE_ID }));
  await delay(200);

  const replay = await waitFor(B.inbox, m => m.type === 'runtime.replay', 'B gets runtime.replay', 15000);
  check('T4a: B received runtime.replay', !!replay);

  const outputs = replay.outputs || [];
  const replayText = outputs.map(o => o.data).join('');
  check('T4b: replay contains PENGSPC prompt', replayText.includes('PENGSPC'));
  check('T4c: replay contains whoami output', replayText.includes('peng'));
  console.log(`  Replay has ${outputs.length} output chunks\n`);

  // T5: Live sync after B subscribes
  console.log('── T5: Live output reaches both A and B ──');
  drain(A.inbox, 'runtime.output');
  drain(B.inbox, 'runtime.output');

  A.ws.send(env('agent.stdout', { instanceId: INSTANCE_ID, data: 'echo hello-vps\r\n' }));
  await delay(50);
  A.ws.send(env('agent.stdout', { instanceId: INSTANCE_ID, data: 'hello-vps\r\n' }));
  await delay(300);

  const aOut = drain(A.inbox, 'runtime.output');
  const bOut = drain(B.inbox, 'runtime.output');
  check('T5a: A gets live runtime.output', aOut.length > 0);
  check('T5b: B gets live runtime.output', bOut.length > 0);
  const bText = bOut.map(o => o.data).join('');
  check('T5c: B sees hello-vps via runtime.output', bText.includes('hello-vps'));
  console.log(`  A: ${aOut.length} msgs, B: ${bOut.length} msgs\n`);

  // T6: Exit → runtime.result
  console.log('── T6: Shell exit → runtime.result ──');
  A.ws.send(env('agent.instance.exit', { instanceId: INSTANCE_ID, exitCode: 0 }));
  await delay(300);

  const aResult = await waitFor(A.inbox, m => m.type === 'runtime.result', 'A result', 8000);
  const bResult = drain(B.inbox, 'runtime.result');
  check('T6a: A received runtime.result', !!aResult);
  check('T6b: B received runtime.result', bResult.length > 0);

  // Cleanup
  A.ws.close();
  B.ws.close();

  console.log(`\n===== RESULTS: ${passed}/${passed + failed} passed =====`);
  if (failed) {
    console.log(`  FAIL: ${failed} test(s) failed`);
    process.exit(1);
  }
  console.log(`  PASS: VPS shell-to-surface bridge verified`);
}

main().catch(err => {
  console.error(`\nFATAL: ${err.message}`);
  process.exit(1);
});
