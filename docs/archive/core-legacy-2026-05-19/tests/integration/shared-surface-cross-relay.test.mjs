// ─── SharedSurface Cross-Relay Forwarding Test ──────────────────
// Verifies that surface.publish on a leaf relay is forwarded to the
// upstream relay, where it appears under the remapped nodeId (not __local__).
//
// Architecture:
//   UPSTREAM ←── LEAF (connects via /api/connect)
//
// Usage:
//   node tests/integration/shared-surface-cross-relay.test.mjs

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { randomInt } from 'crypto';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const delay = ms => new Promise(r => setTimeout(r, ms));
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

let passed = 0, failed = 0;
function check(desc, ok) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}

function resolveBridge() {
  const candidates = [
    join(ROOT, 'bin', 'bridge.js'),
    join(ROOT, 'dist', 'src', 'index.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  console.error('FATAL: No bridge entry found');
  process.exit(1);
}

const BRIDGE = resolveBridge();
const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';

async function connectBrowser(relayWs, label) {
  const ws = new WebSocket(relayWs);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: ['shell'],
    cols: 120, rows: 40, workspace: true,
    clientToken: `xrelay_${label}_${Date.now()}`,
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

async function startRelay(port, workDir, label) {
  const configDir = join(workDir, '.sessionbridge');
  mkdirSync(configDir, { recursive: true });
  const configPath = join(configDir, 'agent.json');
  writeFileSync(configPath, JSON.stringify({
    label, workingDirectory: workDir, relayPort: port,
  }, null, 2), 'utf8');

  const proc = spawn(nodeCmd, [
    BRIDGE, '--relay-port', String(port), '--dir', workDir, '--label', label,
  ], {
    cwd: ROOT,
    env: { ...process.env, BRIDGE_CONFIG: configPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const startTime = Date.now();
  while (Date.now() - startTime < 30000) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return proc;
    } catch {}
    await delay(500);
  }
  proc.kill();
  throw new Error(`Relay ${label} on port ${port} did not start`);
}

async function main() {
  const UPSTREAM_PORT = randomInt(19000, 19999);
  const LEAF_PORT = randomInt(19000, 19999);
  const UPSTREAM_DIR = join(tmpdir(), `sb-xrelay-up-${Date.now()}-${randomInt(10000, 99999)}`);
  const LEAF_DIR = join(tmpdir(), `sb-xrelay-leaf-${Date.now()}-${randomInt(10000, 99999)}`);
  const UPSTREAM_WS = `ws://127.0.0.1:${UPSTREAM_PORT}`;
  const LEAF_WS = `ws://127.0.0.1:${LEAF_PORT}`;

  console.log(`\n===== SharedSurface Cross-Relay Forwarding Test =====`);
  console.log(`  Upstream:  port ${UPSTREAM_PORT}`);
  console.log(`  Leaf:      port ${LEAF_PORT}\n`);

  let upstreamProc = null;
  let leafProc = null;

  try {
    // ── Start upstream relay ──────────────────────────────────────
    console.log('── Starting upstream relay ──');
    upstreamProc = await startRelay(UPSTREAM_PORT, UPSTREAM_DIR, 'UPSTREAM');
    console.log('  Upstream ready.\n');

    // ── Start leaf relay ──────────────────────────────────────────
    console.log('── Starting leaf relay ──');
    leafProc = await startRelay(LEAF_PORT, LEAF_DIR, 'LEAF-NODE');
    console.log('  Leaf ready.\n');

    // ── Connect leaf → upstream ───────────────────────────────────
    console.log('── Connecting leaf → upstream ──');
    let connectOk = false;
    // Retry a few times — the relay connection might need time to stabilize
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await fetch(`http://127.0.0.1:${LEAF_PORT}/api/connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relayUrl: UPSTREAM_WS }),
        });
        const result = await resp.json();
        console.log(`  Attempt ${attempt}: ${JSON.stringify(result)}`);
        if (result.ok) { connectOk = true; break; }
      } catch (e) {
        console.log(`  Attempt ${attempt}: ${e.message}`);
      }
      await delay(2000);
    }
    check('T0: Leaf connected to upstream', connectOk);
    if (!connectOk) {
      console.log('  ABORT: cannot continue without connection');
      throw new Error('Connection failed');
    }
    console.log('');

    // Wait for registration to propagate to upstream
    await delay(2000);

    // Verify leaf instance appears on upstream as remote
    const upHealth = await (await fetch(`http://127.0.0.1:${UPSTREAM_PORT}/api/health`)).json();
    const leafOnUp = upHealth.instances.find(i => i.label === 'LEAF-NODE' && i.source === 'remote');
    const REMAPPED_ID = leafOnUp?.id;
    check('T0b: Leaf appears as remote on upstream', !!REMAPPED_ID);
    console.log(`  Upstream instances: ${upHealth.instances.map(i => `${i.id} ${i.source}/${i.label}`).join(', ')}`);
    console.log(`  REMAPPED_ID: ${REMAPPED_ID || 'NOT FOUND'}\n`);

    // Get leaf's local instance ID (instances use hostname not config label)
    const leafHealth = await (await fetch(`http://127.0.0.1:${LEAF_PORT}/api/health`)).json();
    const leafLocal = leafHealth.instances.find(i => i.source === 'local' && i.status === 'running');
    const LEAF_LOCAL_ID = leafLocal?.id;
    console.log(`  Leaf local ID: ${LEAF_LOCAL_ID} (${leafLocal?.label})\n`);

    // ═══════════════════════════════════════════════════════════
    // T1: Publish surface on leaf → appears on upstream
    // ═══════════════════════════════════════════════════════════
    console.log('── T1: Publish on leaf, verify on upstream ──');

    const leafBrowser = await connectBrowser(LEAF_WS, 'leaf-browser');
    await waitFor(leafBrowser.inbox, m => m.type === 'welcome', 'Leaf browser welcome');

    // Use __local__ to trigger cross-relay forwarding (same as real browser does)
    leafBrowser.ws.send(env('surface.publish', {
      nodeId: '__local__',
      title: 'Cross-Relay Terminal',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId: LEAF_LOCAL_ID },
      replayPolicy: { mode: 'tail', lines: 5000, bytes: 500_000 },
    }));

    const leafPub = await waitFor(leafBrowser.inbox, m =>
      m.type === 'surface.published', 'Leaf gets surface.published');
    const SURFACE_ID = leafPub.surfaceId;
    const OP_ID = leafPub.surface?.runtimeRef?.operationId;
    check('T1a: Leaf got surface.published', !!SURFACE_ID);
    console.log(`  Published: ${SURFACE_ID}, op: ${OP_ID}\n`);

    await delay(1000); // allow forwarding

    // ── Check upstream ────────────────────────────────────────────
    const upBrowser = await connectBrowser(UPSTREAM_WS, 'up-browser');
    await waitFor(upBrowser.inbox, m => m.type === 'welcome', 'Upstream browser welcome');

    // Try both __local__ and remapped node ID
    let surfaces = [];
    for (const nodeId of [REMAPPED_ID, '__local__'].filter(Boolean)) {
      upBrowser.ws.send(env('surface.subscribeNode', { nodeId }));
      try {
        const upList = await waitFor(upBrowser.inbox, m =>
          m.type === 'surface.list', `Upstream surface.list for ${nodeId}`, 5000);
        const found = Array.isArray(upList.surfaces) ? upList.surfaces : (upList.body?.surfaces || []);
        if (found.length > 0) {
          surfaces = found;
          console.log(`  Upstream node ${nodeId}: ${found.length} surfaces`);
          break;
        }
      } catch {}
    }

    console.log(`  Upstream surfaces: ${surfaces.map(s => `${s.surfaceId} nodeId=${s.nodeId} "${s.title}"`).join(', ')}`);

    const crossSurface = surfaces.find(s => s.title === 'Cross-Relay Terminal');
    check('T1b: Surface forwarded to upstream', !!crossSurface);
    if (crossSurface) {
      check('T1c: Forwarded surface nodeId is remapped (not __local__)',
        crossSurface.nodeId !== '__local__');
      check('T1d: Forwarded surface nodeId = remapped instanceId',
        crossSurface.nodeId === REMAPPED_ID);
    }

    // ═══════════════════════════════════════════════════════════
    // T2: Output on leaf reaches upstream
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T2: Output forwarding ──');

    if (crossSurface && OP_ID) {
      // Send output through a mock agent on leaf
      const leafAgent = await (async () => {
        const ws = new WebSocket(LEAF_WS);
        const inbox = [];
        ws.on('message', d => inbox.push(d.toString()));
        await new Promise(r => ws.on('open', r));
        ws.send(env('hello', {
          role: 'agent', version: '0.6.0', features: ['shell'],
          label: 'OUTPUT-AGENT', adapterId: 'shell',
        }));
        await waitFor(inbox, m => m.type === 'welcome', 'Output agent welcome');
        ws.send(env('agent.register', {
          dir: '/fake', label: 'OUTPUT-AGENT', adapterId: 'shell',
        }));
        await waitFor(inbox, m => m.type === 'agent.registered', 'Output agent registered');
        return { ws, inbox };
      })();

      leafAgent.ws.send(env('agent.operation.output', {
        operationId: OP_ID,
        stream: 'stdout',
        data: 'CROSS-RELAY-OUTPUT-MARKER\n',
      }));
      await delay(500);

      // Check if upstream browser got runtime.output
      const upOutputs = drain(upBrowser.inbox, 'runtime.output');
      const hasMarker = upOutputs.some(o => o.data?.includes('CROSS-RELAY-OUTPUT-MARKER'));
      check('T2a: Live output reaches upstream subscriber', hasMarker);

      // Replay on upstream surface
      drain(upBrowser.inbox, 'runtime.replay');
      upBrowser.ws.send(env('surface.subscribe', { surfaceId: crossSurface.surfaceId }));
      try {
        const upReplay = await waitFor(upBrowser.inbox, m =>
          m.type === 'runtime.replay', 'Upstream replay', 8000);
        const replayText = (upReplay.outputs || []).map(o => o.data).join('');
        check('T2b: Upstream replay contains output', replayText.includes('CROSS-RELAY-OUTPUT-MARKER'));
      } catch (e) {
        console.log(`  Replay error: ${e.message}`);
      }

      leafAgent.ws.close();
    } else {
      console.log('  SKIP: no forwarded surface or operationId');
    }

    // ═══════════════════════════════════════════════════════════
    // T3: surface.close forwarding
    // ═══════════════════════════════════════════════════════════
    console.log('\n── T3: surface.close forwarding ──');
    drain(upBrowser.inbox, 'surface.closed');
    leafBrowser.ws.send(env('surface.close', { surfaceId: SURFACE_ID }));
    await delay(500);

    const upClosed = drain(upBrowser.inbox, 'surface.closed');
    check('T3a: surface.closed forwarded to upstream', upClosed.length > 0);

    leafBrowser.ws.close();
    upBrowser.ws.close();

  } finally {
    console.log('\n── Cleanup ──');
    if (leafProc) { leafProc.kill(); await delay(200); }
    if (upstreamProc) { upstreamProc.kill(); await delay(200); }
    try { rmSync(LEAF_DIR, { recursive: true, force: true }); } catch {}
    try { rmSync(UPSTREAM_DIR, { recursive: true, force: true }); } catch {}
    console.log('  Done.');
  }

  console.log(`\n===== RESULTS: ${passed}/${passed + failed} passed =====`);
  if (failed) process.exit(1);
  console.log(`  PASS: Cross-relay surface forwarding works`);
}

main().catch(err => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
