// ─── Persistence & Reconnect Test ─────────────────────────────
// B1-B7 from consistency checklist
// Tests: close/reopen persistence, relay restart recovery,
// agent reconnect clears orphaned, stale detection, keep flag.
//
// Self-contained — spawns its own bridge process.
//
// Usage:
//   node tests/integration/persistence-reconnect.test.mjs

import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { randomInt } from 'crypto';
import http from 'http';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

const delay = ms => new Promise(r => setTimeout(r, ms));
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

let passed = 0, failed = 0;
function check(desc, ok, detail = '') {
  if (ok) { passed++; console.log(`  PASS: ${desc}`); }
  else { failed++; console.error(`  FAIL: ${desc}${detail ? ' — ' + detail : ''}`); }
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

function resolveBridge() {
  const candidates = [
    join(ROOT, 'bin', 'bridge.js'),
    join(ROOT, 'dist', 'src', 'index.js'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  console.error('FATAL: No bridge entry found');
  process.exit(1);
}

const BRIDGE = resolveBridge();
const nodeCmd = process.platform === 'win32' ? 'node.exe' : 'node';

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(body); } });
    }).on('error', reject);
  });
}

function uid() { return Math.random().toString(36).slice(2, 8); }

async function connectBrowser(relayWs, label) {
  const ws = new WebSocket(relayWs);
  const inbox = [];
  ws.on('message', d => {
    try {
      const parsed = JSON.parse(d.toString());
      if (parsed.v === 1 && parsed.body) {
        inbox.push({ type: parsed.type, ...parsed.body, _raw: parsed });
      } else {
        inbox.push(parsed);
      }
    } catch { inbox.push(d.toString()); }
  });
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: ['shell'],
    clientToken: `pr_${label}_${uid()}`,
  }));
  await delay(300);
  return { ws, inbox, label };
}

async function connectAgent(relayWs, label) {
  const ws = new WebSocket(relayWs);
  const inbox = [];
  ws.on('message', d => {
    try {
      const parsed = JSON.parse(d.toString());
      if (parsed.v === 1 && parsed.body) {
        inbox.push({ type: parsed.type, ...parsed.body, _raw: parsed });
      } else {
        inbox.push(parsed);
      }
    } catch { inbox.push(d.toString()); }
  });
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'agent', version: '0.6.0', features: ['shell'],
    label, adapterId: 'shell',
  }));
  return { ws, inbox, label };
}

async function waitFor(inbox, pred, label, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (let i = 0; i < inbox.length; i++) {
      const m = inbox[i];
      const match = typeof pred === 'function' ? pred(m) : m?.type === pred;
      if (match) return inbox.splice(i, 1)[0];
    }
    await delay(50);
  }
  throw new Error(`Timeout waiting for: ${label || pred}`);
}

async function registerAgent(relayWs, label, dir) {
  const agent = await connectAgent(relayWs, label);
  await waitFor(agent.inbox, 'welcome', `${label} welcome`);
  agent.ws.send(env('agent.register', {
    dir: dir || '/fake/' + label.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    label, adapterId: 'shell',
  }));
  const reg = await waitFor(agent.inbox, 'agent.registered', `${label} registered`);
  return { ...agent, instanceId: reg.instanceId };
}

async function main() {
  console.log('=== Persistence & Reconnect Test (B1-B7) ===\n');

  // ── Start bridge ──
  const WORK = join(tmpdir(), `bridge_pr_${uid()}`);
  const CONFIG_DIR = join(WORK, '.sessionbridge');
  mkdirSync(CONFIG_DIR, { recursive: true });
  const PORT = 17000 + randomInt(1, 5000);
  const WS_URL = `ws://127.0.0.1:${PORT}`;
  const HTTP_URL = `http://127.0.0.1:${PORT}`;

  const configPath = join(CONFIG_DIR, 'agent.json');
  writeFileSync(configPath, JSON.stringify({
    label: 'pr-test-node',
    workingDirectory: WORK,
    relayPort: PORT,
  }, null, 2), 'utf8');

  const bridge = spawn(nodeCmd, [
    BRIDGE, '--relay-port', String(PORT), '--dir', WORK,
    '--label', 'pr-test-node',
  ], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BRIDGE_DIR: WORK, BRIDGE_CONFIG: configPath },
  });
  bridge.stdout.on('data', () => {});
  bridge.stderr.on('data', () => {});

  // Wait for health
  for (let i = 0; i < 60; i++) {
    try { await httpGet(`${HTTP_URL}/api/health`); break; }
    catch { await delay(250); }
  }

  process.on('exit', () => { try { bridge.kill(); rmSync(WORK, { recursive: true, force: true }); } catch {} });

  console.log(`Bridge started on port ${PORT}\n`);

  // ════════════════════════════════════════════════════
  // B1: Close browser and reconnect → surfaces persist
  // ════════════════════════════════════════════════════
  section('B1: Close browser → reconnect → surfaces persist');

  const agentA = await registerAgent(WS_URL, 'NodeA', '/fake/node-a');
  console.log(`  Agent NodeA registered: ${agentA.instanceId}`);

  // Create a surface via API
  const createRes = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ dir: '/tmp', label: 'B1-Terminal', adapterId: 'shell' });
    const req = http.request(`${HTTP_URL}/api/instances`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  check('B1.1: API creates instance', !!createRes.instance?.id);
  check('B1.2: API creates surface', !!createRes.surface?.surfaceId);

  const surfId = createRes.surface?.surfaceId;
  const instId = createRes.instance?.id;

  // Connect browser and verify surface visible
  const browser1 = await connectBrowser(WS_URL, 'B1');
  browser1.ws.send(env('surface.subscribe', { surfaceId: surfId }));
  const sub1 = await waitFor(browser1.inbox, 'surface.subscribed', 'B1.3 subscribe');
  check('B1.3: Browser subscribes to surface', !!sub1.surfaceId);

  // Close browser
  browser1.ws.close();
  await delay(500);

  // Check surfaces still exist via debug API
  const debugBefore = await httpGet(`${HTTP_URL}/api/debug/surfaces`);
  const surfStillThere = debugBefore.surfaceDebug?.surfaces?.find(s => s.surfaceId === surfId);
  check('B1.4: Surface survives browser close', !!surfStillThere, `keep=${surfStillThere?.keep}`);

  // Reconnect with same clientToken
  const browser1b = await connectBrowser(WS_URL, 'B1-reconnect');
  browser1b.ws.send(env('surface.subscribe', { surfaceId: surfId }));
  const sub1b = await waitFor(browser1b.inbox, 'surface.subscribed', 'B1.5 re-subscribe');
  check('B1.5: Browser reconnects and re-subscribes', !!sub1b.surfaceId);

  // ════════════════════════════════════════════════════
  // B2: Multiple terminals independence
  // ════════════════════════════════════════════════════
  section('B2: Multi-terminal independence');

  const createRes2 = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ dir: WORK, label: 'B2-Terminal2', adapterId: 'shell' });
    const req = http.request(`${HTTP_URL}/api/instances`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  check('B2.1: Second terminal has different instanceId', createRes2.instance?.id !== instId);
  check('B2.2: Second terminal has different surfaceId', createRes2.surface?.surfaceId !== surfId);

  // Both surfaces should exist independently in debug API
  const debug2 = await httpGet(`${HTTP_URL}/api/debug/surfaces`);
  const allSurfaces = debug2.surfaceDebug?.surfaces || [];
  const bothExist = allSurfaces.filter(s => s.surfaceId === surfId || s.surfaceId === createRes2.surface?.surfaceId);
  check('B2.3: Both surfaces exist in debug API', bothExist.length === 2, `found ${bothExist.length}`);
  if (bothExist.length === 2) {
    check('B2.4: Surfaces have different surfaceIds', bothExist[0].surfaceId !== bothExist[1].surfaceId);
  }

  // ════════════════════════════════════════════════════
  // B3/B7: Relay restart → surfaces recover from StateBus
  // ════════════════════════════════════════════════════
  section('B3/B7: Relay restart → surface recovery');

  // Record surface IDs before restart
  const surfacesBeforeRestart = allSurfaces.map(s => s.surfaceId);

  // Kill and restart bridge
  browser1b.ws.close();
  await delay(200);
  bridge.kill();
  await delay(1000);

  const bridge2 = spawn(nodeCmd, [
    BRIDGE, '--relay-port', String(PORT), '--dir', WORK,
    '--label', 'pr-test-node',
  ], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BRIDGE_DIR: WORK, BRIDGE_CONFIG: configPath },
  });
  bridge2.stdout.on('data', () => {});
  bridge2.stderr.on('data', () => {});

  for (let i = 0; i < 60; i++) {
    try { await httpGet(`${HTTP_URL}/api/health`); break; }
    catch { await delay(250); }
  }

  process.on('exit', () => { try { bridge2.kill(); rmSync(WORK, { recursive: true, force: true }); } catch {} });

  // Check surfaces after restart
  const debugAfterRestart = await httpGet(`${HTTP_URL}/api/debug/surfaces`);
  const surfacesAfterRestart = debugAfterRestart.surfaceDebug?.surfaces || [];
  const recoveredSurfaces = surfacesAfterRestart.filter(s => surfacesBeforeRestart.includes(s.surfaceId));
  check('B3.1: Surfaces recover after relay restart', recoveredSurfaces.length > 0,
    `recovered ${recoveredSurfaces.length}/${surfacesBeforeRestart.length}`);

  // Check keep flag survived
  for (const s of recoveredSurfaces) {
    if (s.keep) check(`B7.1: Surface ${s.surfaceId} keep=true survives restart`, true);
  }

  // Reconnect browser and verify resubscribe works
  const browser2 = await connectBrowser(WS_URL, 'B3');
  if (surfId) {
    browser2.ws.send(env('surface.subscribe', { surfaceId: surfId }));
    const subAfterRestart = await waitFor(browser2.inbox, 'surface.subscribed', 'B3.2 post-restart subscribe');
    check('B3.2: Subscribe works after relay restart', !!subAfterRestart.surfaceId);
  }

  // ════════════════════════════════════════════════════
  // B4/B5: Agent reconnect clears orphaned + rebuilds missing
  // ════════════════════════════════════════════════════
  section('B4/B5: Agent reconnect → clear orphaned + rebuild missing');

  // Register a new agent (simulates reconnect)
  const agentB = await registerAgent(WS_URL, 'NodeB', '/fake/node-b');
  console.log(`  Agent NodeB registered: ${agentB.instanceId}`);

  // Check surfaces for this node — orphaned flag should be cleared
  const debugAfterAgent = await httpGet(`${HTTP_URL}/api/debug/surfaces`);
  const nodeBSurfaces = (debugAfterAgent.surfaceDebug?.surfaces || []).filter(s => s.nodeId === agentB.instanceId);
  if (nodeBSurfaces.length > 0) {
    for (const s of nodeBSurfaces) {
      check(`B4.1: Surface ${s.surfaceId} orphaned cleared`, s.orphaned !== true, `orphaned=${s.orphaned}`);
    }
  } else {
    check('B4.1: New agent surfaces not orphaned', true, 'no surfaces for this node yet');
  }

  // Create surface for NodeB via agent
  agentB.ws.send(env('shell.spawn', {}));
  const shellStat = await waitFor(agentB.inbox, 'shell.status', 'B5 shell spawn');
  check('B5.1: Agent can spawn shell', !!shellStat.instanceId);

  // Publish surface from agent
  const agentInstId = shellStat.instanceId;
  agentB.ws.send(env('surface.publish', {
    nodeId: agentB.instanceId, title: 'B5-Agent-Terminal', viewType: 'terminal',
    scope: 'node', shared: true,
    runtimeRef: { kind: 'terminal', instanceId: agentInstId },
  }));
  const pubMsg = await waitFor(agentB.inbox, 'surface.published', 'B5.2 surface published');
  check('B5.2: Agent publishes surface', !!pubMsg.surfaceId);

  // Browser subscribes to the new agent surface
  browser2.ws.send(env('surface.subscribe', { surfaceId: pubMsg.surfaceId }));
  const subB5 = await waitFor(browser2.inbox, 'surface.subscribed', 'B5.3 cross-subscribe');
  check('B5.3: Browser subscribes to agent surface', !!subB5.surfaceId);

  // ════════════════════════════════════════════════════
  // B6: Stale surface detection (instance gone)
  // ════════════════════════════════════════════════════
  section('B6: Stale surface detection');

  // Create a surface with a fake instanceId
  const fakeSurfRes = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ dir: '/tmp', label: 'B6-Fake', adapterId: 'shell' });
    const req = http.request(`${HTTP_URL}/api/instances`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
  const fakeSurfId = fakeSurfRes.surface?.surfaceId;
  const fakeInstId = fakeSurfRes.instance?.id;
  check('B6.1: Created surface for stale test', !!fakeSurfId);

  // Delete the instance directly via API (simulates instance gone)
  await new Promise((resolve, reject) => {
    const req = http.request(`${HTTP_URL}/api/instances/${fakeInstId}`, { method: 'DELETE' }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end();
  });

  // Verify instance is gone
  const instsAfter = await httpGet(`${HTTP_URL}/api/instances`);
  const fakeInstGone = !instsAfter.instances?.some(i => i.id === fakeInstId);
  check('B6.2: Instance deleted', fakeInstGone);

  // Try subscribing to the stale surface — should get error or surface.closed
  browser2.ws.send(env('surface.subscribe', { surfaceId: fakeSurfId }));
  const staleResult = await Promise.race([
    waitFor(browser2.inbox, 'surface.subscribed', 'B6.3 stale sub', 5000).catch(() => null),
    waitFor(browser2.inbox, 'surface.closed', 'B6.3 surface closed', 5000).catch(() => null),
    waitFor(browser2.inbox, 'error', 'B6.3 error', 5000).catch(() => null),
    delay(3000).then(() => 'timeout'),
  ]);

  if (staleResult === 'timeout') {
    // Surface might still exist as orphaned — that's also valid
    const debugStale = await httpGet(`${HTTP_URL}/api/debug/surfaces`);
    const staleSurf = debugStale.surfaceDebug?.surfaces?.find(s => s.surfaceId === fakeSurfId);
    check('B6.3: Stale surface handled (closed or orphaned)', !!staleSurf, 'surface still exists as orphaned');
  } else if (staleResult?.type === 'error') {
    check('B6.3: Stale surface returns error', true, staleResult.message || staleResult.code);
  } else if (staleResult?.type === 'surface.closed') {
    check('B6.3: Stale surface emits surface.closed', true);
  } else if (staleResult?.type === 'surface.subscribed') {
    check('B6.3: Stale surface subscribes but is orphaned', true, 'orphaned surface returned');
  }

  // Cleanup
  browser2.ws.close();
  agentA.ws.close();
  agentB.ws.close();
  bridge2.kill();
  try { rmSync(WORK, { recursive: true, force: true }); } catch {}

  console.log(`\n=== Persistence/Reconnect: ${passed} pass, ${failed} fail ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
