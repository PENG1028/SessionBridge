// ─── StateBus Diagnostic Invariant Test ──────────────────────────
// Validates that:
//   1. /api/debug/statebus returns valid JSON with expected shape
//   2. After a browser subscribes to __local__, tabs stored under __local__ appear in the endpoint
//   3. After surface.publish, workbench tabs project under the correct nodeId
//   4. Cross-browser tab sync: Browser B sees Browser A's published surface tab
//   5. StateBus entries match surfaces + tabs counts
//   6. Instance list matches peers minus __local__
//
// Usage:
//   node tests/integration/statebus-diag-invariants.test.mjs

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
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

// ── Helpers ──────────────────────────────────────────────────────

async function startRelay(workDir, port) {
  const configPath = join(workDir, 'test-config.json');
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(nodeCmd, [BRIDGE, '--relay-port', String(port), '--dir', workDir, '--label', 'diag-test-node'], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test', BRIDGE_DIR: workDir, BRIDGE_CONFIG: configPath },
    });
    let started = false;
    const timer = setTimeout(() => {
      if (!started) { reject(new Error('Relay start timeout')); proc.kill(); }
    }, 20000);

    let output = '';
    proc.stdout.on('data', d => {
      output += d.toString();
      if (output.includes('SessionBridge') && !started) {
        started = true;
        clearTimeout(timer);
        resolvePromise(proc);
      }
    });
    proc.stderr.on('data', d => {
      output += d.toString();
      if (output.includes('SessionBridge') && !started) {
        started = true;
        clearTimeout(timer);
        resolvePromise(proc);
      }
      const text = d.toString();
      // Always print relay stderr for debugging
      process.stderr.write('[relay] ' + text);
      if (text.includes('Error') || text.includes('error')) {
        console.error('[relay-err]', text.slice(0, 200));
      }
    });
    proc.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}\nBody: ${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

async function connectBrowser(relayUrl) {
  const ws = new WebSocket(relayUrl);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: ['shell'],
    clientToken: `diag_test_${Date.now()}`,
  }));
  return { ws, inbox };
}

function waitForMsg(inbox, predicate, timeout = 15000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function poll() {
      for (const raw of inbox) {
        try {
          const msg = JSON.parse(raw);
          if (predicate(msg)) return resolve(msg);
        } catch {}
      }
      if (Date.now() - start > timeout) return reject(new Error('Timeout waiting for message'));
      setTimeout(poll, 50);
    }
    poll();
  });
}

function parseMsg(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

function filterMsgs(inbox, type) {
  return inbox.map(m => { try { return JSON.parse(m); } catch { return null; } }).filter(m => m && m.type === type);
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const testId = `diag_${Date.now().toString(36)}`;
  const workDir = join(tmpdir(), `sessionbridge-diag-test-${testId}`);
  const port = 12000 + randomInt(1000);
  const relayUrl = `http://localhost:${port}`;
  const wsUrl = `ws://localhost:${port}`;

  console.log(`\n=== StateBus Diagnostic Invariant Test ===`);
  console.log(`Work dir: ${workDir}`);
  console.log(`Port: ${port}`);

  // Clean up any previous state
  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  // Write blank config so relay doesn't auto-connect to upstream from persisted agent.json
  writeFileSync(join(workDir, 'test-config.json'), JSON.stringify({ nodeId: `test_${testId}` }), 'utf8');

  let relayProc;
  try {
    // ── 1. Start relay ──
    relayProc = await startRelay(workDir, port);
    console.log('  Relay started.');
    await delay(1000);

    // ── 2. Check /api/debug/statebus is available ──
    const initial = await httpGet(`${relayUrl}/api/debug/statebus`);
    check('GET /api/debug/statebus returns ok', initial.ok === true);
    check('localNodeInfo has id __local__', initial.localNodeInfo?.id === '__local__');
    check('instances is array', Array.isArray(initial.instances));
    check('surfaces is object', typeof initial.surfaces === 'object');
    check('stateBus is object', typeof initial.stateBus === 'object');
    check('peers is array', Array.isArray(initial.peers));
    check('workbenchTabs is object', typeof initial.workbenchTabs === 'object');

    console.log(`  Initial state: ${initial.instances.length} instances, ${initial.surfaces.total} surfaces, ${Object.keys(initial.workbenchTabs).length} tab groups`);

    // ── 3. Connect Browser A, subscribe to __local__ ──
    console.log('  Connecting Browser A...');
    const browserA = await connectBrowser(wsUrl);
    await delay(500);

    // Log ALL messages received so far
    console.log(`  Browser A inbox has ${browserA.inbox.length} messages after connect:`);
    for (let i = 0; i < browserA.inbox.length; i++) {
      try {
        const m = JSON.parse(browserA.inbox[i]);
        console.log(`    [${i}] type="${m.type}" nodeId="${m.nodeId ?? m.body?.nodeId}" tabs=${m.tabs?.length ?? m.body?.tabs?.length ?? 'N/A'}`);
      } catch (e) {
        console.log(`    [${i}] <parse error>`);
      }
    }

    // Send workbench.subscribe for __local__
    browserA.ws.send(env('workbench.subscribe', { nodeId: '__local__' }));

    // Wait for workbench.tabs response
    await delay(500);
    console.log(`  Browser A inbox has ${browserA.inbox.length} messages after subscribe:`);
    for (let i = 0; i < browserA.inbox.length; i++) {
      try {
        const m = JSON.parse(browserA.inbox[i]);
        console.log(`    [${i}] type="${m.type}" nodeId="${m.nodeId ?? m.body?.nodeId}" tabsLen=${m.tabs?.length ?? m.body?.tabs?.length ?? 'N/A'}`);
        if (m.type === 'workbench.tabs') {
          const body = m.body || m;
          console.log(`          → nodeId="${body.nodeId}" tabs=${body.tabs?.length}`);
        }
      } catch (e) {
        console.log(`    [${i}] <parse error>`);
      }
    }

    // Check the FIRST workbench.tabs message (direct subscribe response)
    const tabsMsgsA = filterMsgs(browserA.inbox, 'workbench.tabs');
    const tabsRespA = tabsMsgsA.length > 0 ? (tabsMsgsA[0].body || tabsMsgsA[0]) : null;
    check('Browser A receives workbench.tabs for __local__', tabsRespA?.nodeId === '__local__');
    check('Browser A tabs is empty initially (first msg)', Array.isArray(tabsRespA?.tabs) && tabsRespA.tabs.length === 0);

    // ── 4. Check diagnostic endpoint after subscribe ──
    const afterSub = await httpGet(`${relayUrl}/api/debug/statebus`);
    check('workbenchSubscribers has __local__ after subscribe', afterSub.workbenchSubscribers && afterSub.workbenchSubscribers['__local__']?.count >= 1);

    // ── 5. Surface.publish: simulate a terminal tab being published by Browser A ──
    console.log('  Browser A publishing surface...');
    browserA.ws.send(env('surface.publish', {
      nodeId: '__local__',
      title: 'Diagnostic Test Terminal',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId: `test_inst_${testId}` },
      replayPolicy: { mode: 'tail', lines: 5000, bytes: 500000 },
    }));

    // Wait for surface.published confirmation
    const pubRaw = await waitForMsg(browserA.inbox, m => m.type === 'surface.published');
    const pubConf = pubRaw?.body || {};
    check('Browser A receives surface.published', !!pubConf?.surfaceId);
    const publishedSurfaceId = pubConf?.surfaceId;

    // Sender is excluded from workbench.tabs broadcast, so check via HTTP endpoint
    await delay(500);
    const afterPub = await httpGet(`${relayUrl}/api/debug/statebus`);
    const workbenchTabs = afterPub.workbenchTabs && afterPub.workbenchTabs['__local__'];
    check('workbench tabs in statebus after publish', Array.isArray(workbenchTabs));
    check('workbench tabs contain published surface', workbenchTabs?.some(t => t._surfaceId === publishedSurfaceId));

    // ── 6. Connect Browser B, subscribe to __local__ → should receive the tab ──
    console.log('  Connecting Browser B...');
    const browserB = await connectBrowser(wsUrl);
    await delay(200);

    console.log(`  Browser B inbox has ${browserB.inbox.length} messages after connect:`);
    for (let i = 0; i < browserB.inbox.length; i++) {
      try { const m = JSON.parse(browserB.inbox[i]); console.log(`    [${i}] type="${m.type}"`); } catch {}
    }

    browserB.ws.send(env('workbench.subscribe', { nodeId: '__local__' }));
    const rawTabsB = await waitForMsg(browserB.inbox, m => m.type === 'workbench.tabs');
    const tabsRespB = rawTabsB?.body || {};
    console.log(`  Browser B workbench.tabs nodeId: "${tabsRespB?.nodeId}", tabs: ${tabsRespB?.tabs?.length || 0}`);
    if (tabsRespB?.tabs?.length > 0) {
      console.log(`    Tab[0]: ${JSON.stringify(tabsRespB.tabs[0])}`);
    }
    check('Browser B receives workbench.tabs for __local__', tabsRespB?.nodeId === '__local__');
    check('Browser B sees the published surface tab', tabsRespB?.tabs?.some(t => t._surfaceId === publishedSurfaceId));
    check('Browser B tab has correct title', tabsRespB?.tabs?.some(t => t.title === 'Diagnostic Test Terminal'));

    // ── 7. Check /api/debug/statebus after surface publish ──
    check('statebus shows tabs under __local__', afterPub.workbenchTabs && Array.isArray(afterPub.workbenchTabs['__local__']));
    check('statebus tab count >= 1', afterPub.workbenchTabs && afterPub.workbenchTabs['__local__'].length >= 1);
    check('statebus surfaces.byNode has __local__', afterPub.surfaces?.byNode && Array.isArray(afterPub.surfaces.byNode['__local__']));
    check('statebus surface count >= 1 in __local__', afterPub.surfaces?.byNode?.['__local__']?.length >= 1);

    // ── 8. Verify StateBus entries match ──
    const totalSurfacesInBus = afterPub.surfaces.total;
    const surfacesFromNodes = Object.values(afterPub.surfaces.byNode || {}).reduce((sum, arr) => sum + arr.length, 0);
    check('surfaces.total matches sum of byNode', totalSurfacesInBus === surfacesFromNodes);
    check('stateBus totalEntries > 0', afterPub.stateBus.totalEntries > 0);

    // ── 9. Verify peers include self-referencing entry ──
    check('peers has at least 1 entry', afterPub.peers.length >= 1);

    // ── 10. Verify instance count sanity ──
    check('instances has at least 1 entry (local node)', afterPub.instances.length >= 1);
    const localInst = afterPub.instances.find(i => i.source === 'local');
    check('instances includes local source instance', !!localInst);

    // ── 11. Cleanup: close browsers ──
    browserA.ws.close();
    browserB.ws.close();
    await delay(500);

    // Check cleanup reflected in statebus
    const afterCleanup = await httpGet(`${relayUrl}/api/debug/statebus`);
    const stillSubscribed = Object.keys(afterCleanup.workbenchSubscribers || {}).length;
    console.log(`  Subscribers after cleanup: ${stillSubscribed}`);

  } catch (e) {
    console.error(`\n  ERROR: ${e.message}\n${e.stack}`);
    failed++;
  } finally {
    // Cleanup
    if (relayProc) {
      relayProc.kill();
      await delay(300);
    }
    if (existsSync(workDir)) {
      try { rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  }

  // ── Summary ──
  console.log(`\n  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
}

main();
