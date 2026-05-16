// ─── Live Cross-Relay Surface Forwarding Verification ──────────
// Connects to LOCAL relay (port 9000) and VPS relay, verifies
// surface.publish on LOCAL appears on VPS.
//
// Usage:
//   node tests/manual/verify-cross-relay-live.mjs

import WebSocket from 'ws';

const delay = ms => new Promise(r => setTimeout(r, ms));
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

const LOCAL_WS = 'ws://127.0.0.1:9000';
const VPS_WS = 'ws://43.160.241.180:8080';

async function connectBrowser(relayWs, label) {
  const ws = new WebSocket(relayWs);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: ['shell'],
    cols: 120, rows: 40, workspace: true,
    clientToken: `verify_${label}_${Date.now()}`,
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

async function main() {
  console.log('===== Live Cross-Relay Surface Verification =====\n');

  // Step 1: Check VPS for PENGSPC instance
  console.log('── Step 1: Find PENGSPC on VPS ──');
  const vpsHealth = await (await fetch('http://43.160.241.180:8080/api/health')).json();
  const pengOnVps = vpsHealth.instances.find(i => i.label === 'PENGSPC' && i.source === 'remote');
  if (!pengOnVps) {
    console.log('  FAIL: PENGSPC not found on VPS. Is local relay connected?');
    console.log(`  VPS instances: ${vpsHealth.instances.map(i => `${i.id} ${i.source}/${i.label}`).join(', ')}`);
    process.exit(1);
  }
  console.log(`  PENGSPC on VPS: ${pengOnVps.id}\n`);

  // Step 2: Connect to LOCAL, publish a test surface
  console.log('── Step 2: Publish surface on LOCAL ──');
  const localBrowser = await connectBrowser(LOCAL_WS, 'local');
  await waitFor(localBrowser.inbox, m => m.type === 'welcome', 'LOCAL welcome');

  const testTitle = `LiveTest-${Date.now()}`;
  localBrowser.ws.send(env('surface.publish', {
    nodeId: '__local__',
    title: testTitle,
    viewType: 'terminal',
    scope: 'node',
    shared: true,
    runtimeRef: { kind: 'terminal', instanceId: pengOnVps.id },
    replayPolicy: { mode: 'tail', lines: 5000, bytes: 500_000 },
  }));

  const localPub = await waitFor(localBrowser.inbox, m =>
    m.type === 'surface.published', 'LOCAL surface.published');
  console.log(`  Published: ${localPub.surfaceId}, title: ${localPub.surface?.title}\n`);

  // Step 3: Wait for forwarding, then check VPS
  await delay(2000);
  console.log('── Step 3: Check VPS for forwarded surface ──');

  const vpsBrowser = await connectBrowser(VPS_WS, 'vps');
  await waitFor(vpsBrowser.inbox, m => m.type === 'welcome', 'VPS welcome');

  let found = false;
  // Try the PENGSPC instance (where surface should appear after remapping)
  for (const nodeId of [pengOnVps.id, '__local__']) {
    vpsBrowser.ws.send(env('surface.subscribeNode', { nodeId }));
    try {
      const list = await waitFor(vpsBrowser.inbox, m =>
        m.type === 'surface.list', `VPS surface.list for ${nodeId}`, 5000);
      const surfaces = Array.isArray(list.surfaces) ? list.surfaces : (list.body?.surfaces || []);
      console.log(`  Node ${nodeId}: ${surfaces.length} surfaces`);
      for (const s of surfaces) {
        console.log(`    ${s.surfaceId} nodeId=${s.nodeId} "${s.title}"`);
      }
      const match = surfaces.find(s => s.title === testTitle);
      if (match) {
        console.log(`\n  SUCCESS: Surface forwarded! ${match.surfaceId} nodeId=${match.nodeId}`);
        found = true;
        break;
      }
    } catch (e) {
      console.log(`  Node ${nodeId}: no response`);
    }
  }

  if (!found) {
    console.log('\n  FAIL: Surface NOT forwarded to VPS');
    console.log('  This means _sendUpstream is still not set on the LOCAL relay.');
    console.log('  The LOCAL relay may be running old code — restart required.');
    process.exit(1);
  }

  // Cleanup
  localBrowser.ws.close();
  vpsBrowser.ws.close();
  console.log('\n  PASS: Cross-relay surface forwarding works on live setup!');
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
