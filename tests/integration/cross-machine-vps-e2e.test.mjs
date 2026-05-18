// ─── Cross-Machine VPS E2E Test ─────────────────────────
// Connects local → VPS relay via SSH tunnel (localhost:18080 → VPS:8080)
// to test tab lifecycle, terminal output, surface sync across real network.
//
// Topology:  Local Machine ──(SSH tunnel)──→ VPS Relay (:8080)
//
// Prerequisites:
//   npm run build
//   ssh -N -L 18080:localhost:8080 ubuntu@43.160.241.180
//
// Usage:
//   node tests/integration/cross-machine-vps-e2e.test.mjs
//
// Environment:
//   VPS_HOST=43.160.241.180  VPS_PORT=18080  — override VPS endpoint
//   VERBOSE=1                — print all debug output
//   NETWORK_DELAY=1          — measure and report RTT per operation

import { existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import http from 'http';
import WebSocket from 'ws';
import { performance } from 'perf_hooks';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const VERBOSE = process.env.VERBOSE === '1';
const REPORT_DELAY = process.env.NETWORK_DELAY === '1';

const VPS_HOST = process.env.VPS_HOST || 'localhost';
const VPS_PORT = parseInt(process.env.VPS_PORT || '18080', 10);
const VPS_BASE = `http://${VPS_HOST}:${VPS_PORT}`;
const VPS_WS   = `ws://${VPS_HOST}:${VPS_PORT}`;

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Test accounting ─────────────────────────────────────
let passed = 0, failed = 0;
let networkDelays = [];

function check(desc, ok) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}
function section(name) {
  console.log(`\n─── ${name} ───`);
}
function elapsed(label, ms) {
  if (REPORT_DELAY) {
    networkDelays.push({ label, ms: Math.round(ms) });
    console.log(`  [NET] ${label}: ${Math.round(ms)}ms`);
  }
}

// ── Envelope helpers ────────────────────────────────────
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

function parseMsg(raw) {
  try {
    const m = JSON.parse(raw);
    return m.v === 1 && m.body ? { ...m.body, type: m.type } : m;
  } catch { return null; }
}

// ── HTTP helper ─────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        elapsed(`HTTP GET ${url.replace(VPS_BASE, '')}`, performance.now() - start);
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}\n${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

// ── WebSocket client helper ─────────────────────────────
async function connectBrowser(label) {
  const start = performance.now();
  const ws = new WebSocket(VPS_WS);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  elapsed(`WS connect ${label}`, performance.now() - start);

  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: ['shell'],
    clientToken: `vps_${label}_${Date.now()}`,
  }));
  return { ws, inbox, label };
}

async function waitFor(inbox, predicate, label, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (let i = 0; i < inbox.length; i++) {
      const msg = parseMsg(inbox[i]);
      if (msg && predicate(msg)) { inbox.splice(i, 1); return msg; }
    }
    await delay(50);
  }
  throw new Error(`[${label}] Timeout (${timeout}ms) waiting for ${predicate.toString().slice(0, 80)}`);
}

function filterMsgs(inbox, type) {
  return inbox.map(m => parseMsg(m)).filter(m => m && m.type === type);
}

// ─── Main ────────────────────────────────────────────────
async function main() {
  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`  Cross-Machine VPS E2E Test`);
  console.log(`  VPS: ${VPS_HOST}:${VPS_PORT} → 43.160.241.180:8080`);
  console.log(`  Delay reporting: ${REPORT_DELAY}`);
  console.log(`══════════════════════════════════════════════════════\n`);

  // ── R0: Connectivity check ────────────────────────────
  section('R0: Connectivity');
  try {
    const info = await httpGet(`${VPS_BASE}/api/info`);
    check('R0.1: /api/info reachable', !!info.cwd);
    console.log(`  VPS cwd: ${info.cwd}`);
    console.log(`  VPS homeDir: ${info.homeDir}`);
    check('R0.2: homeDir is VPS home', info.homeDir === '/home/ubuntu');
  } catch (e) {
    check(`R0: VPS unreachable — ${e.message}`, false);
    console.error('  Cannot continue without VPS connectivity.');
    process.exit(1);
  }

  // ── R1: WebSocket connect + welcome ──────────────────
  section('R1: WebSocket lifecycle');
  const browserA = await connectBrowser('A');
  const welcome = await waitFor(browserA.inbox, m => m.type === 'welcome', 'A welcome');
  check('R1.1: Welcome received', !!welcome);
  check('R1.2: Welcome has sessionId', !!welcome.sessionId);
  check('R1.3: Welcome has features', Array.isArray(welcome.features));
  console.log(`  Session: ${welcome.sessionId}  Features: ${(welcome.features || []).join(', ')}`);

  // ── R2: Surface publish on VPS ───────────────────────
  section('R2: Surface publish via VPS');

  browserA.ws.send(env('surface.publish', {
    nodeId: '__local__',
    title: 'VPS Test Terminal',
    viewType: 'terminal',
    scope: 'node',
    shared: true,
    runtimeRef: { kind: 'terminal', instanceId: `r2_inst_${Date.now().toString(36)}` },
    replayPolicy: { mode: 'tail', lines: 5000, bytes: 500000 },
  }));
  const r2Pub = await waitFor(browserA.inbox, m => m.type === 'surface.published', 'A pub');
  check('R2.1: surface.published received', !!r2Pub.surfaceId);
  console.log(`  Surface ID: ${r2Pub.surfaceId}`);

  // Verify surface exists via HTTP API (surface.list is not a standalone request type;
  // it's only returned as a response to surface.subscribeNode)
  const r2State = await httpGet(`${VPS_BASE}/api/debug/statebus`);
  check('R2.2: StateBus reports surfaces', r2State.surfaces?.total > 0 || r2State.ok === true);

  // ── R3: Shell spawn on VPS ───────────────────────────
  section('R3: Remote terminal spawn');

  browserA.ws.send(env('shell.spawn', {}));
  const r3Status = await waitFor(browserA.inbox, m => m.type === 'operation.status', 'A op status');
  check('R3.1: operation.status received', !!r3Status.operationId);
  console.log(`  Op: ${r3Status.operationId}  status: ${r3Status.status}  kind: ${r3Status.kind}`);
  check('R3.2: Operation is terminal kind', !r3Status.kind || r3Status.kind === 'terminal');

  // Drain initial shell output
  await delay(1500);
  filterMsgs(browserA.inbox, 'shell.output');
  filterMsgs(browserA.inbox, 'runtime.output');
  filterMsgs(browserA.inbox, 'operation.output');

  // Get instanceId from debug API
  const r3Debug1 = await httpGet(`${VPS_BASE}/api/debug/statebus`);
  const r3Inst = r3Debug1.instances?.find(i => i.source === 'local' && i.status === 'running');
  const r3InstId = r3Inst?.id;
  check('R3.3: Shell instance created on VPS', !!r3InstId);
  console.log(`  VPS instance: ${r3InstId}`);

  // Publish surface linking to this instance
  browserA.ws.send(env('surface.publish', {
    nodeId: '__local__',
    title: 'R3 Remote Shell',
    viewType: 'terminal',
    scope: 'node',
    shared: true,
    runtimeRef: { kind: 'terminal', instanceId: r3InstId },
  }));
  const r3Pub = await waitFor(browserA.inbox, m => m.type === 'surface.published', 'A r3 pub');
  check('R3.4: Surface published for shell instance', !!r3Pub.surfaceId);
  const r3OpId = r3Pub.surface?.runtimeRef?.operationId;
  console.log(`  Surface: ${r3Pub.surfaceId}  Operation: ${r3OpId || '(none)'}`);

  // Subscribe to the surface
  browserA.ws.send(env('surface.subscribe', { surfaceId: r3Pub.surfaceId }));
  const r3Sub = await waitFor(browserA.inbox, m => m.type === 'surface.subscribed', 'A r3 sub');
  check('R3.5: Surface subscribed', !!r3Sub.surfaceId);

  // Send command via operation.input
  const r3Msg = `VPS_HELLO_${Date.now().toString(36)}`;
  const r3ActualOpId = r3OpId || r3Status.operationId;
  browserA.ws.send(env('operation.input', {
    operationId: r3ActualOpId,
    data: `echo ${r3Msg}\n`,
  }));

  // Wait for output (with generous timeout for network latency)
  const r3Start = Date.now();
  let r3Got = false;
  while (Date.now() - r3Start < 20000) {
    const outputs = filterMsgs(browserA.inbox, 'runtime.output')
      .concat(filterMsgs(browserA.inbox, 'shell.output'))
      .concat(filterMsgs(browserA.inbox, 'operation.output'));
    if (outputs.some(o => o.data && o.data.includes(r3Msg))) { r3Got = true; break; }
    await delay(100);
  }
  check('R3.6: Shell output received across network', r3Got);

  // ── R4: Second browser + surface sync ────────────────
  section('R4: Multi-browser sync on VPS');

  const browserB = await connectBrowser('B');
  const welcomeB = await waitFor(browserB.inbox, m => m.type === 'welcome', 'B welcome');
  check('R4.1: Browser B connected', !!welcomeB);

  // Subscribe to workbench tabs
  browserB.ws.send(env('workbench.subscribe', { nodeId: '__local__' }));
  const r4Tabs = await waitFor(browserB.inbox, m => m.type === 'workbench.tabs', 'B tabs');
  check('R4.2: workbench.tabs received', Array.isArray(r4Tabs.tabs));
  check('R4.3: R3 surface visible in tabs',
    r4Tabs.tabs.some(t => t._surfaceId === r3Pub.surfaceId));
  console.log(`  Tab count: ${r4Tabs.tabs?.length || 0}`);

  // Subscribe to R3 surface from B
  browserB.ws.send(env('surface.subscribe', { surfaceId: r3Pub.surfaceId }));
  const r4SubB = await waitFor(browserB.inbox, m => m.type === 'surface.subscribed', 'B sub');
  check('R4.4: Browser B subscribed to R3 surface', !!r4SubB.surfaceId);

  // ── R5: Workbench tab persistence ────────────────────
  section('R5: Tab persistence via statebus');

  // Verify via HTTP API that surfaces exist on VPS
  const r5State = await httpGet(`${VPS_BASE}/api/debug/statebus`);
  check('R5.1: StateBus responds', r5State.ok === true);

  if (r5State.surfaces) {
    check('R5.2: Surfaces reported', r5State.surfaces.total > 0);
    console.log(`  Total surfaces on VPS: ${r5State.surfaces.total}`);
  }

  // ── R6: Surface subscribeNode (node-level discovery) ─
  section('R6: Node-level surface discovery');

  // Use __local__ nodeId to discover all local surfaces
  browserB.ws.send(env('surface.subscribeNode', { nodeId: '__local__' }));
  const r6List = await waitFor(browserB.inbox, m => m.type === 'surface.list', 'B node');
  check('R6.1: Node surface list received', Array.isArray(r6List.surfaces));
  check('R6.2: R3 surface in node list',
    r6List.surfaces.some(s => s.surfaceId === r3Pub.surfaceId));
  console.log(`  Node surfaces: ${r6List.surfaces.length}`);

  // ── R7: Reconnect restore (tab + surface persistence) ─
  section('R7: Reconnect restore');

  // Close Browser A
  browserA.ws.close();
  await delay(1500);

  // Connect Browser C, subscribe to workbench + node
  const browserC = await connectBrowser('C');
  await waitFor(browserC.inbox, m => m.type === 'welcome', 'C welcome');

  browserC.ws.send(env('workbench.subscribe', { nodeId: '__local__' }));
  const r7Tabs = await waitFor(browserC.inbox, m => m.type === 'workbench.tabs', 'C tabs');
  check('R7.1: Tabs restored after reconnect', Array.isArray(r7Tabs.tabs));
  check('R7.2: R3 surface tab restored',
    r7Tabs.tabs.some(t => t._surfaceId === r3Pub.surfaceId));
  console.log(`  Tab count: ${r7Tabs.tabs?.length || 0}`);

  browserC.ws.send(env('surface.subscribeNode', { nodeId: '__local__' }));
  const r7Surf = await waitFor(browserC.inbox, m => m.type === 'surface.list', 'C node');
  check('R7.3: Node surfaces restored after reconnect', Array.isArray(r7Surf.surfaces));
  check('R7.4: R3 surface still in node list',
    r7Surf.surfaces.some(s => s.surfaceId === r3Pub.surfaceId));

  browserC.ws.close();

  // ── R8: Network round-trip measurements ──────────────
  if (REPORT_DELAY) {
    section('R8: Network delay report');
    console.log(`  Round-trip measurements (VPS ${VPS_HOST}:${VPS_PORT}):`);
    for (const d of networkDelays) {
      console.log(`    ${d.label.padEnd(40)} ${d.ms}ms`);
    }
    const avg = networkDelays.reduce((s, d) => s + d.ms, 0) / networkDelays.length;
    console.log(`  ${'─'.repeat(52)}`);
    console.log(`    ${'AVERAGE'.padEnd(40)} ${Math.round(avg)}ms`);
  }

  // ── Summary ──────────────────────────────────────────
  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  console.log(`══════════════════════════════════════════════════════\n`);

  // Cleanup
  browserB.ws.close();
  await delay(500);

  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
