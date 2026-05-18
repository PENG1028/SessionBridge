// ─── Tab Lifecycle E2E Test ─────────────────────────────
// Tests the four core tab scenarios at the protocol level:
//
//   S1: Local tab creation — POST /api/instances creates instance + surface + workbench tab
//   S2: Cross-browser sync — two browsers connect; tabs broadcast between them
//   S3: Surface subscribeNode — agent-connected node surfaces discovered via protocol
//   S4: Tab restore on reconnect — disconnect/reconnect simulates page reload
//
// No browser needed — uses raw WebSocket + HTTP against a real relay.
//
// Usage:
//   node tests/integration/tab-lifecycle-e2e.test.mjs
//
// Environment:
//   VERBOSE=1   — print all relay output

import { mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import http from 'http';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const VERBOSE = process.env.VERBOSE === '1';

const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Envelope helper ─────────────────────────────────────
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

// ── Test accounting ─────────────────────────────────────
let passed = 0, failed = 0;
function check(desc, ok) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}
function section(name) {
  console.log(`\n─── ${name} ───`);
}

// ── Resolve bridge binary ───────────────────────────────
function resolveBridge() {
  const explicit = process.env.BRIDGE_BIN || process.argv[2];
  if (explicit && existsSync(explicit)) return explicit;
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

// ── HTTP helpers ────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}\n${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}\n${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── WebSocket helpers ───────────────────────────────────
async function connectBrowser(relayWs, label) {
  const ws = new WebSocket(relayWs);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: ['shell'],
    clientToken: `tab_e2e_${label}_${Date.now()}`,
  }));
  await waitFor(inbox, m => m.type === 'welcome', `${label} welcome`);
  return { ws, inbox, label };
}

async function connectAgent(relayWs, label) {
  const ws = new WebSocket(relayWs);
  const inbox = [];
  ws.on('message', d => inbox.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  ws.send(env('hello', {
    role: 'agent', version: '0.6.0', features: ['shell'],
    label, adapterId: 'shell',
  }));
  await waitFor(inbox, m => m.type === 'welcome', `${label} welcome`);
  ws.send(env('agent.register', {
    dir: `/home/${label.toLowerCase()}`,
    label,
    adapterId: 'shell',
  }));
  await waitFor(inbox, m => m.type === 'agent.registered', `${label} registered`);
  return { ws, inbox, label };
}

function parseMsg(raw) {
  try {
    const m = JSON.parse(raw);
    return m.v === 1 && m.body ? { ...m.body, type: m.type } : m;
  } catch { return null; }
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
  const remaining = inbox.map(s => { try { return JSON.parse(s).type ?? '?'; } catch { return '?'; } }).join(', ');
  throw new Error(`[${label}] Timeout (${timeout}ms) waiting for ${predicate.toString().slice(0, 80)} — inbox: [${remaining}]`);
}

function filterMsgs(inbox, type) {
  const result = [];
  for (let i = inbox.length - 1; i >= 0; i--) {
    const parsed = parseMsg(inbox[i]);
    if (parsed && parsed.type === type) {
      result.push(parsed);
      inbox.splice(i, 1);
    }
  }
  return result.reverse();
}

function killProc(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' });
    } else {
      proc.kill('SIGKILL');
    }
  } catch {}
}

// ── Relay process helper ────────────────────────────────
function startRelay(port, workDir) {
  return new Promise((resolvePromise, reject) => {
    const args = [BRIDGE, '--relay-port', String(port), '--dir', workDir];
    const proc = spawn(nodeCmd, args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    let started = false;
    const timer = setTimeout(() => {
      if (!started) { reject(new Error(`Relay ${port} start timeout`)); killProc(proc); }
    }, 45000);

    let output = '';
    const onData = (d) => {
      output += d.toString();
      if (output.includes('SessionBridge') && !started) {
        started = true;
        clearTimeout(timer);
        resolvePromise(proc);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', e => { clearTimeout(timer); reject(e); });

    if (VERBOSE) {
      proc.stdout.on('data', d => process.stdout.write(`[relay:${port}] ${d}`));
      proc.stderr.on('data', d => process.stderr.write(`[relay:${port}err] ${d}`));
    }
  });
}

// ─── Main ───────────────────────────────────────────────
async function main() {
  const testId = Date.now().toString(36);
  const relayPort = 17000 + (parseInt(testId.slice(-4), 36) % 1000);
  if (relayPort < 10000 || relayPort > 60000) throw new Error('bad port');

  const workDir = join(tmpdir(), `sb-tab-lifecycle-${testId}`);

  console.log(`\n══════════════════════════════════════════════════════`);
  console.log(`  Tab Lifecycle E2E Test`);
  console.log(`  Test ID: ${testId}`);
  console.log(`  Relay:   :${relayPort}`);
  console.log(`  Binary:  ${BRIDGE}`);
  console.log(`══════════════════════════════════════════════════════\n`);

  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  let relayProc;

  try {
    // ── Start relay ──────────────────────────────────────────
    section('Start relay');
    relayProc = await startRelay(relayPort, workDir);
    console.log(`  Relay started on :${relayPort}`);

    const HTTP = `http://localhost:${relayPort}`;
    const WS = `ws://localhost:${relayPort}`;

    // ═══════════════════════════════════════════════════════════
    // S1: Local tab creation via POST /api/instances
    // ═══════════════════════════════════════════════════════════
    section('S1: Local tab creation via POST /api/instances');
    {
      const browser = await connectBrowser(WS, 'S1-BROWSER');

      // POST /api/instances creates instance + surface + workbench tab
      const inst = await httpPost(`${HTTP}/api/instances`, {
        dir: workDir, label: 'S1-Tab', adapterId: 'shell',
      });
      check('S1.1: POST /api/instances returns instance', !!inst.instance?.id);
      check('S1.2: Instance dir matches', inst.instance?.dir === workDir);
      const instanceId = inst.instance?.id;

      // Verify surface created in the HTTP response
      check('S1.3: Surface created in response', !!inst.surface?.surfaceId);
      const surfaceId = inst.surface?.surfaceId;
      check('S1.4: Surface links to instance', inst.surface?.runtimeRef?.instanceId === instanceId);

      // Subscribe to the node to discover the surface via surface.list
      // For local instances without targetNodeId, ownerNodeId == instanceId
      browser.ws.send(env('surface.subscribeNode', { nodeId: instanceId }));
      const nodeSurfaces = await waitFor(browser.inbox, m => m.type === 'surface.list', 'S1-BROWSER');
      const surfaces = Array.isArray(nodeSurfaces.surfaces) ? nodeSurfaces.surfaces : [];
      check('S1.5: surface.list contains our surface', surfaces.some(s => s.surfaceId === surfaceId));

      // Close surface. Surface is deleted server-side.
      // Note: synthesis in surface.subscribeNode may recreate it if instance
      // still runs, so verify via debug API instead.
      browser.ws.send(env('surface.close', { surfaceId }));
      await delay(500);

      // Verify via debug API that surface is gone
      const debug = await httpGet(`${HTTP}/api/debug/surfaces`);
      const allSurfaces = debug.surfaces || [];
      check('S1.6: Surface deleted from server', !allSurfaces.some(s => s.surfaceId === surfaceId));

      browser.ws.close();
    }

    // ═══════════════════════════════════════════════════════════
    // S2: Cross-browser tab sync (two browsers, workbench.tabs)
    // ═══════════════════════════════════════════════════════════
    section('S2: Cross-browser tab sync via workbench.tabs');
    {
      const browserA = await connectBrowser(WS, 'S2-BROWSER-A');
      const browserB = await connectBrowser(WS, 'S2-BROWSER-B');

      // Both browsers subscribe to same nodeId
      const syncNodeId = `sync-node-${testId}`;
      browserA.ws.send(env('workbench.subscribe', { nodeId: syncNodeId }));
      browserB.ws.send(env('workbench.subscribe', { nodeId: syncNodeId }));

      // Drain initial responses
      await waitFor(browserA.inbox, m => m.type === 'workbench.tabs' && m.nodeId === syncNodeId, 'S2-BROWSER-A initial');
      await waitFor(browserB.inbox, m => m.type === 'workbench.tabs' && m.nodeId === syncNodeId, 'S2-BROWSER-B initial');

      // Browser A sends tabs → Browser B should receive them
      const tab1 = { id: `tab-${testId}-1`, viewType: 'terminal', title: 'Tab 1', instanceId: `inst-${testId}-1`, _surfaceId: `surf-${testId}-1` };
      const tab2 = { id: `tab-${testId}-2`, viewType: 'terminal', title: 'Tab 2', instanceId: `inst-${testId}-2`, _surfaceId: `surf-${testId}-2` };
      browserA.ws.send(env('workbench.tabs', { nodeId: syncNodeId, tabs: [tab1, tab2] }));

      // Browser B receives broadcast
      const bTabs = await waitFor(browserB.inbox, m => m.type === 'workbench.tabs' && m.nodeId === syncNodeId, 'S2-BROWSER-B sync');
      check('S2.1: Browser B received workbench.tabs', Array.isArray(bTabs.tabs));
      check('S2.2: Tab count matches', bTabs.tabs.length === 2);
      check('S2.3: Tab 1 id matches', bTabs.tabs[0]?.id === tab1.id);
      check('S2.4: Tab 2 id matches', bTabs.tabs[1]?.id === tab2.id);

      // Browser A should NOT receive its own broadcast
      const ownBroadcast = filterMsgs(browserA.inbox, 'workbench.tabs');
      check('S2.5: Sender not self-broadcast', ownBroadcast.length === 0);

      // Remove a tab — Browser A sends updated list
      browserA.ws.send(env('workbench.tabs', { nodeId: syncNodeId, tabs: [tab1] }));
      const bTabs2 = await waitFor(browserB.inbox, m => m.type === 'workbench.tabs' && m.nodeId === syncNodeId, 'S2-BROWSER-B remove');
      check('S2.6: Browser B sees removed tab', bTabs2.tabs.length === 1);
      check('S2.7: Remaining tab is tab1', bTabs2.tabs[0]?.id === tab1.id);

      // Send empty tabs — note: direct WS handler does broadcast empty tabs
      browserA.ws.send(env('workbench.tabs', { nodeId: syncNodeId, tabs: [] }));
      await delay(500);
      const emptyBroadcast = filterMsgs(browserB.inbox, 'workbench.tabs');
      check('S2.8: Empty tabs sent to server', emptyBroadcast.length >= 1);

      browserA.ws.close();
      browserB.ws.close();
    }

    // ═══════════════════════════════════════════════════════════
    // S3: Surface subscribeNode — agent surfaces discovered
    // ═══════════════════════════════════════════════════════════
    section('S3: Surface subscribeNode — agent surface discovery');
    {
      const agent = await connectAgent(WS, 'S3-AGENT');

      // Get agent nodeId from agent.registered
      // It was consumed by waitFor in connectAgent, so find it via POST /api/instances
      const agInstList = await httpGet(`${HTTP}/api/instances`);
      const agentInst = agInstList.instances.find(i => i.source === 'remote' && i.label === 'S3-AGENT');
      const agentNodeId = agentInst?.id;
      check('S3.1: Agent node found', !!agentNodeId);

      // Browser connects and subscribes to agent's node BEFORE the spawn
      // so it can receive surface.published broadcasts
      const browser = await connectBrowser(WS, 'S3-BROWSER');
      browser.ws.send(env('surface.subscribeNode', { nodeId: agentNodeId }));
      const s3InitList = await waitFor(browser.inbox, m => m.type === 'surface.list', 'S3-BROWSER subscribe');
      check('S3.2: Initial surface.list received', Array.isArray(s3InitList.surfaces));

      // Agent spawns a terminal — this creates a surface and broadcasts surface.published
      agent.ws.send(env('agent.instance.spawn', {
        dir: '/tmp', label: 'S3-Terminal', adapterId: 'shell',
      }));
      const spawned = await waitFor(agent.inbox, m => m.type === 'agent.instance.spawned', 'S3-AGENT spawn');
      const spawnedInstId = spawned.instanceId;
      check('S3.3: Agent instance spawned', !!spawnedInstId);

      // Browser should receive surface.published broadcast (live update)
      const s3Pub = await waitFor(browser.inbox, m => m.type === 'surface.published', 'S3-BROWSER surface.published');
      const pubSurface = s3Pub.surface || {};
      check('S3.4: surface.published received', !!s3Pub.surfaceId);
      check('S3.5: Surface links to spawned instance',
        pubSurface.runtimeRef?.instanceId === spawnedInstId);

      // Also verify the surface appears in instance.added broadcast
      const instAdded = filterMsgs(browser.inbox, 'instance.added');
      check('S3.6: instance.added received',
        instAdded.some(m => m.instance?.id === spawnedInstId));

      // Verify via surface.list by re-subscribing
      browser.ws.send(env('surface.subscribeNode', { nodeId: agentNodeId }));
      const s3List2 = await waitFor(browser.inbox, m => m.type === 'surface.list', 'S3-BROWSER re-list');
      const s3Surfaces2 = Array.isArray(s3List2.surfaces) ? s3List2.surfaces : [];
      check('S3.7: surface.list contains agent terminal',
        s3Surfaces2.some(s => s.runtimeRef?.instanceId === spawnedInstId));

      agent.ws.close();
      browser.ws.close();
    }

    // ═══════════════════════════════════════════════════════════
    // S4: Tab restore on reconnect (simulated page reload)
    // ═══════════════════════════════════════════════════════════
    section('S4: Tab restore on reconnect');
    {
      const browser = await connectBrowser(WS, 'S4-BROWSER');
      const nodeId = `restore-node-${testId}`;

      // Subscribe to a node and set its tabs
      browser.ws.send(env('workbench.subscribe', { nodeId }));
      await waitFor(browser.inbox, m => m.type === 'workbench.tabs' && m.nodeId === nodeId, 'S4-BROWSER init');

      const origTab = { id: `restore-tab-${testId}`, viewType: 'terminal', title: 'Restore Tab', instanceId: `restore-inst-${testId}` };
      browser.ws.send(env('workbench.tabs', { nodeId, tabs: [origTab] }));

      // Disconnect (simulate page reload)
      browser.ws.close();
      await delay(300);

      // Reconnect as a new browser session
      const browser2 = await connectBrowser(WS, 'S4-BROWSER-2');

      // Subscribe to the same node
      browser2.ws.send(env('workbench.subscribe', { nodeId }));
      const restored = await waitFor(browser2.inbox, m => m.type === 'workbench.tabs' && m.nodeId === nodeId, 'S4-BROWSER-2 restore');

      // Server should still have our tab in workbenchTabStore
      check('S4.1: Tabs restored after reconnect', Array.isArray(restored.tabs));
      check('S4.2: At least 1 tab restored', restored.tabs.length >= 1);
      const restoredTab = restored.tabs.find(t => t.id === origTab.id);
      check('S4.3: Original tab restored by id', !!restoredTab);

      // Now test surface persistence across reconnect
      // Create a surface via POST /api/instances
      const inst = await httpPost(`${HTTP}/api/instances`, {
        dir: workDir, label: 'S4-Surface', adapterId: 'shell',
      });
      const surfId = inst.surface?.surfaceId;
      check('S4.4: Surface created for persist test', !!surfId);

      // Subscribe to the owning node's surfaces
      const surfNodeId = inst.instance?.id;
      browser2.ws.send(env('surface.subscribeNode', { nodeId: surfNodeId }));
      const surfList1 = await waitFor(browser2.inbox, m => m.type === 'surface.list', 'S4-BROWSER-2 surf1');
      const s1Surfaces = Array.isArray(surfList1.surfaces) ? surfList1.surfaces : [];
      check('S4.5: Surface visible before disconnect', s1Surfaces.some(s => s.surfaceId === surfId));

      // Disconnect again
      browser2.ws.close();
      await delay(300);

      // Reconnect and re-subscribe
      const browser3 = await connectBrowser(WS, 'S4-BROWSER-3');
      browser3.ws.send(env('surface.subscribeNode', { nodeId: surfNodeId }));
      const surfList2 = await waitFor(browser3.inbox, m => m.type === 'surface.list', 'S4-BROWSER-3 surf2');
      const s2Surfaces = Array.isArray(surfList2.surfaces) ? surfList2.surfaces : [];
      check('S4.6: Surface persists after reconnect', s2Surfaces.some(s => s.surfaceId === surfId));

      browser3.ws.close();
    }

    // ── Summary ──────────────────────────────────────────────
    console.log(`\n══════════════════════════════════════════════════════`);
    console.log(`  Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
    console.log(`══════════════════════════════════════════════════════\n`);

  } finally {
    killProc(relayProc);
    try { rmSync(workDir, { recursive: true, force: true }); } catch {}
  }

  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
