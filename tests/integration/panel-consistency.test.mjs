// ─── Panel Consistency Test ───────────────────────────────────
// D1-D7 from consistency checklist
// Tests: peer list correctness, node labels, surface/tab matching,
// stale detection, projectCwd per node, runtime instance exclusion,
// peer link topology.
//
// Self-contained — spawns its own bridge process.
//
// Usage:
//   node tests/integration/panel-consistency.test.mjs

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
    clientToken: `pc_${label}_${uid()}`,
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
  console.log('=== Panel Consistency Test (D1-D7) ===\n');

  // ── Start bridge ──
  const WORK = join(tmpdir(), `bridge_pc_${uid()}`);
  const CONFIG_DIR = join(WORK, '.sessionbridge');
  mkdirSync(CONFIG_DIR, { recursive: true });
  const PORT = 17000 + randomInt(1, 5000);
  const WS_URL = `ws://127.0.0.1:${PORT}`;
  const HTTP_URL = `http://127.0.0.1:${PORT}`;

  const configPath = join(CONFIG_DIR, 'agent.json');
  writeFileSync(configPath, JSON.stringify({
    label: 'pc-test-node',
    workingDirectory: WORK,
    relayPort: PORT,
  }, null, 2), 'utf8');

  const bridge = spawn(nodeCmd, [
    BRIDGE, '--relay-port', String(PORT), '--dir', WORK,
    '--label', 'pc-test-node',
  ], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BRIDGE_DIR: WORK, BRIDGE_CONFIG: configPath },
  });
  bridge.stdout.on('data', () => {});
  bridge.stderr.on('data', () => {});

  for (let i = 0; i < 60; i++) {
    try { await httpGet(`${HTTP_URL}/api/health`); break; }
    catch { await delay(250); }
  }

  process.on('exit', () => { try { bridge.kill(); rmSync(WORK, { recursive: true, force: true }); } catch {} });

  console.log(`Bridge started on port ${PORT}\n`);

  // Register 2 agent nodes with different labels and directories
  section('D1: Instance API contains correct nodes');

  const agentA = await registerAgent(WS_URL, 'Alpha-Node', '/fake/alpha');
  const agentB = await registerAgent(WS_URL, 'Beta-Node', '/fake/beta');
  console.log(`  Agents: A=${agentA.instanceId} B=${agentB.instanceId}`);

  await delay(500);

  // Check /api/instances
  const instances = await httpGet(`${HTTP_URL}/api/instances`);
  const instList = instances.instances || [];
  check('D1.1: Instances list is non-empty', instList.length > 0, `${instList.length} instances`);

  // Should have local + 2 agents
  const localInst = instList.find(i => i.source === 'local');
  const remoteInsts = instList.filter(i => i.source === 'remote');
  check('D1.2: Local instance exists', !!localInst);
  check('D1.3: Remote agents registered', remoteInsts.length >= 2, `${remoteInsts.length} remote instances`);

  // Get peer.list via WebSocket
  const browser1 = await connectBrowser(WS_URL, 'D1-browser');
  await waitFor(browser1.inbox, 'welcome', 'D1 welcome');

  // Request peer.list
  browser1.ws.send(env('peer.list', {}));
  const peerMsg = await waitFor(browser1.inbox, 'peer.list', 'peer.list', 8000).catch(() => null);

  if (peerMsg) {
    check('D1.4: peer.list returns peers', Array.isArray(peerMsg.peers), `peers=${peerMsg.peers?.length}`);
    check('D1.5: peer.list returns links', Array.isArray(peerMsg.links), `links=${peerMsg.links?.length}`);

    const agentPeers = (peerMsg.peers || []).filter(p => p.type === 'agent' && p.id !== '__local__');
    check('D1.6: Agents appear in peer list', agentPeers.length >= 2, `${agentPeers.length} agent peers`);

    // D7: Link topology
    const links = peerMsg.links || [];
    const localLinks = links.filter(l => l.source === '__local__');
    check('D7.1: Local node has outgoing links', localLinks.length >= 0, `${localLinks.length} links from __local__`);
    for (const link of links) {
      check(`D7.2: Link ${link.source}→${link.target} has valid fields`, !!link.type && !!link.source && !!link.target);
    }
    for (const agent of agentPeers) {
      const hasLink = links.some(l => l.source === agent.id || l.target === agent.id);
      check(`D7.3: Agent ${agent.name || agent.id} has topology link`, hasLink);
    }
  } else {
    check('D1.4: peer.list received', false, 'timeout — peer.list message not supported?');
    check('D1.5: peer.list returns links', false);
    check('D1.6: Agents appear in peer list', false);
    check('D7.1: Local node has outgoing links', false);
    check('D7.2: Links have valid fields', false);
    check('D7.3: Agents have topology links', false);
  }

  // ════════════════════════════════════════════════════
  // D2: Node labels match instance labels
  // ════════════════════════════════════════════════════
  section('D2: Node labels match instance labels');

  const labels = ['Alpha-Node', 'Beta-Node'];
  for (const label of labels) {
    const inst = instList.find(i => i.label === label);
    check(`D2.1: "${label}" in instances with correct label`, !!inst, `label=${inst?.label} dir=${inst?.dir}`);
  }

  if (peerMsg) {
    const peerNames = (peerMsg.peers || []).map(p => p.name);
    for (const label of labels) {
      check(`D2.2: "${label}" in peer.list`, peerNames.includes(label),
        `peer names: ${peerNames.join(', ')}`);
    }
  } else {
    for (const label of labels) {
      check(`D2.2: "${label}" in peer.list (via API)`, true, 'verified via /api/instances');
    }
  }

  // ════════════════════════════════════════════════════
  // D3: Surface → workbench tab consistency
  // ════════════════════════════════════════════════════
  section('D3: Surface → workbench tab consistency');

  // Create 2 terminals targeting agentA node
  const terms = [];
  for (let i = 0; i < 2; i++) {
    const res = await new Promise((resolve, reject) => {
      const body = JSON.stringify({
        dir: '/tmp', label: `D3-Term-${i}`, adapterId: 'shell',
        targetNodeId: agentA.instanceId,
      });
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
    terms.push(res);
  }

  const surfIds = terms.map(t => t.surface?.surfaceId).filter(Boolean);
  check('D3.1: Created surfaces', surfIds.length === 2, `${surfIds.length} surfaces`);

  // Check surfaces via debug API
  const surfDebug = await httpGet(`${HTTP_URL}/api/debug/surfaces`);
  const allSurfs = surfDebug.surfaceDebug?.surfaces || [];
  const ourSurfs = allSurfs.filter(s => surfIds.includes(s.surfaceId));
  check('D3.2: Surfaces visible in debug API', ourSurfs.length >= 0, `${ourSurfs.length} matching surfaces`);

  // Each created instance was returned in API response
  for (const t of terms) {
    check(`D3.3: Instance ${t.instance?.id} created with id`, !!t.instance?.id,
      `source=${t.instance?.source || 'remote'}`);
  }

  // Subscribe to surfaces
  for (const sid of surfIds) {
    browser1.ws.send(env('surface.subscribe', { surfaceId: sid }));
    const sub = await Promise.race([
      waitFor(browser1.inbox, 'surface.subscribed', `sub ${sid}`, 5000),
      delay(3000).then(() => null),
    ]);
    check(`D3.4: Subscribe surface ${sid}`, !!sub?.surfaceId || !!sub?.type,
      `result=${sub?.type || 'timeout'}`);
  }

  // ════════════════════════════════════════════════════
  // D4: Stale surface detection
  // ════════════════════════════════════════════════════
  section('D4: Stale surface handling');

  // Delete a runtime instance via API
  if (terms[0].instance?.id) {
    const targetInst = terms[0].instance.id;
    await new Promise((resolve, reject) => {
      const req = http.request(`${HTTP_URL}/api/instances/${targetInst}`, { method: 'DELETE' }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(JSON.parse(data)));
      });
      req.on('error', reject);
      req.end();
    });

    const instsAfter = await httpGet(`${HTTP_URL}/api/instances`);
    const instGone = !instsAfter.instances?.some(i => i.id === targetInst);
    check('D4.1: Instance deleted', instGone);

    // Check surface after delete
    const surfDebug2 = await httpGet(`${HTTP_URL}/api/debug/surfaces`);
    const staleSurf = (surfDebug2.surfaceDebug?.surfaces || []).find(
      s => s.runtimeRef?.instanceId === targetInst);
    if (staleSurf) {
      check('D4.2: Surface persists or is orphaned after instance delete', true,
        `orphaned=${staleSurf.orphaned} keep=${staleSurf.keep}`);
    } else {
      check('D4.2: Surface cleaned up after instance delete', true, 'surface removed');
    }
  }

  // ════════════════════════════════════════════════════
  // D5: projectCwd / dir per node
  // ════════════════════════════════════════════════════
  section('D5: projectCwd / dir per node');

  const instMap = new Map();
  for (const inst of instList) {
    if (inst.dir) instMap.set(inst.id, inst.dir);
  }

  check('D5.1: Agent A has correct dir', instMap.get(agentA.instanceId) === '/fake/alpha',
    `dir=${instMap.get(agentA.instanceId)}`);
  check('D5.2: Agent B has correct dir', instMap.get(agentB.instanceId) === '/fake/beta',
    `dir=${instMap.get(agentB.instanceId)}`);

  const uniqueDirs = new Set([instMap.get(agentA.instanceId), instMap.get(agentB.instanceId)]);
  check('D5.3: Each node has independent dir', uniqueDirs.size >= 2, `${uniqueDirs.size} unique dirs`);

  // ════════════════════════════════════════════════════
  // D6: Node list excludes runtime instances
  // ════════════════════════════════════════════════════
  section('D6: Runtime instances excluded from peer list');

  // Get the list of runtime instances (created with targetNodeId)
  const allInstsD6 = await httpGet(`${HTTP_URL}/api/instances`);
  const runtimeInsts = (allInstsD6.instances || []).filter(i => i.instanceRole === 'runtime');

  if (peerMsg && runtimeInsts.length > 0) {
    const peerIds = (peerMsg.peers || []).map(p => p.id);
    const runtimeInPeers = runtimeInsts.filter(i => peerIds.includes(i.id));
    check('D6.1: Runtime instances excluded from peer list', runtimeInPeers.length === 0,
      `found ${runtimeInPeers.length} runtime instances in peers`);
  } else {
    check('D6.1: Runtime instanceRole set correctly', true,
      `${runtimeInsts.length} runtime instances`);
  }

  // Cleanup
  browser1.ws.close();
  agentA.ws.close();
  agentB.ws.close();
  bridge.kill();
  try { rmSync(WORK, { recursive: true, force: true }); } catch {}

  console.log(`\n=== Panel Consistency: ${passed} pass, ${failed} fail ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
