// ─── Cross-Relay Surface Pipeline Diagnostic ────────────────────
// Tests each step of the pipeline:
//   1. LOCAL relay: publish surface → does it succeed?
//   2. LOCAL relay: is surface stored locally?
//   3. VPS relay: does surface appear via surface.subscribeNode?
//   4. VPS relay: does surface appear under the REMAPPED node?
//
// Usage:
//   node tests/manual/diagnostic-cross-relay.mjs

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
    clientToken: `diag_${label}_${Date.now()}`,
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
  console.log('═══════════════════════════════════════════');
  console.log('Cross-Relay Pipeline Diagnostic');
  console.log('═══════════════════════════════════════════\n');

  // ═══════════════════════════════════════════
  // STEP 1: Gather state from both relays
  // ═══════════════════════════════════════════
  console.log('── Step 1: Gather relay state ──\n');

  let localHealth, vpsHealth;
  try {
    localHealth = await (await fetch('http://127.0.0.1:9000/api/health')).json();
    console.log(`  LOCAL: ${localHealth.instances.length} instances, activeId=${localHealth.activeInstanceId}`);
    for (const i of localHealth.instances) {
      console.log(`    ${i.id} ${i.source}/${i.label} [${i.status}]`);
    }
  } catch (e) {
    console.log(`  LOCAL: FAILED — ${e.message}`);
    process.exit(1);
  }

  console.log('');

  try {
    vpsHealth = await (await fetch('http://43.160.241.180:8080/api/health')).json();
    console.log(`  VPS: ${vpsHealth.instances.length} instances, activeId=${vpsHealth.activeInstanceId}`);
    for (const i of vpsHealth.instances) {
      console.log(`    ${i.id} ${i.source}/${i.label} [${i.status}]`);
    }
  } catch (e) {
    console.log(`  VPS: FAILED — ${e.message}`);
    process.exit(1);
  }

  console.log('');

  // ═══════════════════════════════════════════
  // STEP 2: Publish test surface on LOCAL
  // ═══════════════════════════════════════════
  console.log('── Step 2: Publish test surface on LOCAL ──\n');

  const localBrowser = await connectBrowser(LOCAL_WS, 'local');
  await waitFor(localBrowser.inbox, m => m.type === 'welcome', 'LOCAL welcome');

  // Use the actual local running instance as nodeId
  const localRunning = localHealth.instances.find(i => i.status === 'running' && i.source === 'local');
  if (!localRunning) {
    console.log('  FAIL: No running local instance on LOCAL relay');
    process.exit(1);
  }
  const NODE_ID = localRunning.id;
  console.log(`  Using nodeId: ${NODE_ID} (${localRunning.label})\n`);

  const testTitle = `Diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  localBrowser.ws.send(env('surface.publish', {
    nodeId: NODE_ID,
    title: testTitle,
    viewType: 'terminal',
    scope: 'node',
    shared: true,
    runtimeRef: { kind: 'terminal', instanceId: localRunning.id },
    replayPolicy: { mode: 'tail', lines: 5000, bytes: 500_000 },
  }));

  let localSurface = null;
  try {
    const pub = await waitFor(localBrowser.inbox, m =>
      m.type === 'surface.published', 'LOCAL surface.published', 10000);
    localSurface = pub.surface || pub;
    console.log(`  [PASS] LOCAL surface.published: ${pub.surfaceId}`);
    console.log(`    surfaceId: ${localSurface.surfaceId}`);
    console.log(`    nodeId: ${localSurface.nodeId}`);
    console.log(`    operationId: ${localSurface.runtimeRef?.operationId}`);
    console.log(`    title: ${localSurface.title}\n`);
  } catch (e) {
    console.log(`  [FAIL] LOCAL did not return surface.published: ${e.message}\n`);
    process.exit(1);
  }

  // ═══════════════════════════════════════════
  // STEP 3: Verify surface is stored locally
  // ═══════════════════════════════════════════
  console.log('── Step 3: Verify surface stored on LOCAL ──\n');

  const localBrowser2 = await connectBrowser(LOCAL_WS, 'local2');
  await waitFor(localBrowser2.inbox, m => m.type === 'welcome', 'LOCAL2 welcome');

  localBrowser2.ws.send(env('surface.subscribeNode', { nodeId: NODE_ID }));
  try {
    const list = await waitFor(localBrowser2.inbox, m =>
      m.type === 'surface.list', 'LOCAL surface.list', 5000);
    const surfaces = Array.isArray(list.surfaces) ? list.surfaces : (list.body?.surfaces || []);
    const found = surfaces.find(s => s.title === testTitle);
    if (found) {
      console.log(`  [PASS] Surface found locally: ${found.surfaceId} nodeId=${found.nodeId}\n`);
    } else {
      console.log(`  [FAIL] Surface NOT found locally!`);
      console.log(`  Local surfaces: ${surfaces.map(s => `${s.surfaceId} "${s.title}"`).join(', ')}\n`);
    }
  } catch (e) {
    console.log(`  [FAIL] surface.list error: ${e.message}\n`);
  }
  localBrowser2.ws.close();

  // ═══════════════════════════════════════════
  // STEP 4: Check if surface reached VPS
  // ═══════════════════════════════════════════
  console.log('── Step 4: Check VPS for forwarded surface ──\n');

  await delay(2000);

  const vpsBrowser = await connectBrowser(VPS_WS, 'vps');
  await waitFor(vpsBrowser.inbox, m => m.type === 'welcome', 'VPS welcome');

  // Find PENGSPC remote instance on VPS
  const pengOnVps = vpsHealth.instances.find(i => i.label === 'PENGSPC' && i.source === 'remote');
  const vpsLocalRunning = vpsHealth.instances.find(i => i.status === 'running' && i.source === 'local');

  let foundOnVps = false;
  for (const nodeId of [pengOnVps?.id, vpsLocalRunning?.id, '__local__'].filter(Boolean)) {
    vpsBrowser.ws.send(env('surface.subscribeNode', { nodeId }));
    try {
      const list = await waitFor(vpsBrowser.inbox, m =>
        m.type === 'surface.list', `VPS surface.list(${nodeId})`, 5000);
      const surfaces = Array.isArray(list.surfaces) ? list.surfaces : (list.body?.surfaces || []);
      const found = surfaces.find(s => s.title === testTitle);
      if (found) {
        console.log(`  [PASS] Surface found on VPS under node ${nodeId}: ${found.surfaceId} nodeId=${found.nodeId}\n`);
        foundOnVps = true;
        break;
      } else if (surfaces.length > 0) {
        console.log(`  Node ${nodeId}: ${surfaces.length} surfaces (not ours)`);
        for (const s of surfaces.slice(0, 3)) {
          console.log(`    ${s.surfaceId} nodeId=${s.nodeId} "${s.title}"`);
        }
      } else {
        console.log(`  Node ${nodeId}: 0 surfaces`);
      }
    } catch (e) {
      console.log(`  Node ${nodeId}: No response`);
    }
  }

  if (!foundOnVps) {
    console.log(`\n  [FAIL] Surface did NOT reach VPS. Forwarding is broken.\n`);

    // ═══════════════════════════════════════════
    // STEP 5 (debug): Try __local__ on LOCAL
    // to verify _sendUpstream path
    // ═══════════════════════════════════════════
    console.log('── Step 5: Debug — try __local__ nodeId ──\n');

    const testTitle2 = `Diag-__local__-${Date.now()}`;
    localBrowser.ws.send(env('surface.publish', {
      nodeId: '__local__',
      title: testTitle2,
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId: localRunning.id },
      replayPolicy: { mode: 'tail', lines: 5000, bytes: 500_000 },
    }));

    try {
      const pub2 = await waitFor(localBrowser.inbox, m =>
        m.type === 'surface.published' && m.surface?.title === testTitle2,
        'LOCAL surface.published (__local__)', 10000);
      console.log(`  LOCAL published: ${pub2.surfaceId}\n`);
    } catch (e) {
      console.log(`  LOCAL surface.published failed: ${e.message}\n`);
    }

    await delay(2000);

    // Check VPS again with __local__ node
    for (const nodeId of [pengOnVps?.id, vpsLocalRunning?.id, '__local__'].filter(Boolean)) {
      vpsBrowser.ws.send(env('surface.subscribeNode', { nodeId }));
      try {
        const list = await waitFor(vpsBrowser.inbox, m =>
          m.type === 'surface.list', `VPS2 surface.list(${nodeId})`, 5000);
        const surfaces = Array.isArray(list.surfaces) ? list.surfaces : (list.body?.surfaces || []);
        const found = surfaces.find(s => s.title === testTitle || s.title === testTitle2);
        if (found) {
          console.log(`  [PASS] Surface found on VPS (via __local__): ${found.surfaceId} nodeId=${found.nodeId}\n`);
          foundOnVps = true;
          break;
        } else {
          console.log(`  Node ${nodeId}: ${surfaces.length} surfaces`);
        }
      } catch (e) {
        console.log(`  Node ${nodeId}: No response`);
      }
    }

    if (!foundOnVps) {
      console.log(`\n  [CONFIRMED] Cross-relay forwarding is BROKEN.`);
      console.log(`  Most likely cause: _sendUpstream is null on LOCAL relay.`);
      console.log(`  The LOCAL relay was started before the fixes and hasn't restarted.`);
      console.log(`  Fix: restart LOCAL relay (Ctrl+C and 'npm run dev' on Windows side)\n`);
    }
  }

  // Cleanup
  localBrowser.ws.close();
  vpsBrowser.ws.close();

  console.log(`\n═══════════════════════════════════════════`);
  if (foundOnVps) {
    console.log(`  RESULT: Cross-relay forwarding WORKS`);
  } else {
    console.log(`  RESULT: Cross-relay forwarding BROKEN`);
    console.log(`  Action: Restart LOCAL relay to pick up fixes`);
  }
  console.log(`═══════════════════════════════════════════`);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}\n${err.stack}`);
  process.exit(1);
});
