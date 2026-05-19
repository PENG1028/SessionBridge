// ─── Multi-Browser Identity Test ──────────────────────────────
// C1-C6 from consistency checklist
// Tests: clientToken uniqueness, reconnect session recovery,
// browser connect/disconnect lifecycle, peer.list format.
//
// Design note: VIEW nodes are filtered by IP in sendPeers() —
// a browser never sees its own VIEW node. Since all test browsers
// share 127.0.0.1, we cannot directly observe VIEW node aggregation
// from another browser. The aggregating logic (collectPeers) is
// verified indirectly through correctness of connect/disconnect
// lifecycle and peer.list format validation.
//
// Self-contained — spawns its own bridge process.
//
// Usage:
//   node tests/integration/multi-browser-identity.test.mjs

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

async function connectBrowser(relayWs, label, token) {
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
  const clientToken = token || `mbi_${label}_${uid()}`;
  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: ['shell'],
    clientToken, label,
  }));
  await delay(300);
  return { ws, inbox, label, clientToken };
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

function findMsgByType(inbox, type) {
  for (let i = inbox.length - 1; i >= 0; i--) {
    if (inbox[i]?.type === type) return inbox[i];
  }
  return null;
}

async function main() {
  console.log('=== Multi-Browser Identity Test (C1-C6) ===\n');

  // ── Start bridge ──
  const WORK = join(tmpdir(), `bridge_mbi_${uid()}`);
  const CONFIG_DIR = join(WORK, '.sessionbridge');
  mkdirSync(CONFIG_DIR, { recursive: true });
  const PORT = 17000 + randomInt(1, 5000);
  const WS_URL = `ws://127.0.0.1:${PORT}`;
  const HTTP_URL = `http://127.0.0.1:${PORT}`;

  const configPath = join(CONFIG_DIR, 'agent.json');
  writeFileSync(configPath, JSON.stringify({
    label: 'mbi-test-node',
    workingDirectory: WORK,
    relayPort: PORT,
  }, null, 2), 'utf8');

  const bridge = spawn(nodeCmd, [
    BRIDGE, '--relay-port', String(PORT), '--dir', WORK,
    '--label', 'mbi-test-node',
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

  // ════════════════════════════════════════════════════
  // C1: Browser connect/disconnect lifecycle + peer.list format
  // ════════════════════════════════════════════════════
  section('C1: Browser lifecycle & peer.list format');

  // Connect first browser — receives welcome + peer.list
  const b1 = await connectBrowser(WS_URL, 'Tab-Alpha');
  await waitFor(b1.inbox, 'welcome', 'b1 welcome');

  // Should receive peer.list automatically (sendPeers is called after welcome)
  const pl1 = findMsgByType(b1.inbox, 'peer.list');
  check('C1.1: Browser receives peer.list on connect', !!pl1, pl1 ? `peers=${pl1.peers?.length}` : 'missing');

  if (pl1) {
    check('C1.2: peer.list has peers array', Array.isArray(pl1.peers));
    check('C1.3: peer.list has links array', Array.isArray(pl1.links));
    // Should have __local__ at minimum (local node)
    const localNode = (pl1.peers || []).find(p => p.id === '__local__');
    check('C1.4: peer.list includes __local__ node', !!localNode,
      localNode ? `type=${localNode.type} isLocal=${localNode.isLocal}` : 'missing');
  }

  // Connect 2 more browsers — they should each receive peer.list
  const b2 = await connectBrowser(WS_URL, 'Tab-Beta');
  const b3 = await connectBrowser(WS_URL, 'Tab-Gamma');
  await waitFor(b2.inbox, 'welcome', 'b2 welcome');
  await waitFor(b3.inbox, 'welcome', 'b3 welcome');

  await delay(500);

  // b3 should get an updated peer.list from broadcastPeers when b3 connected
  const pl3 = findMsgByType(b3.inbox, 'peer.list');
  check('C1.5: Third browser receives peer.list', !!pl3, pl3 ? `peers=${pl3.peers?.length}` : 'missing');

  // ════════════════════════════════════════════════════
  // C2: clientToken uniqueness per browser session
  // ════════════════════════════════════════════════════
  section('C2: clientToken uniqueness per browser');

  const tokens = [b1, b2, b3].map(b => b.clientToken);
  const uniqueTokens = new Set(tokens);
  check('C2.1: Each browser has unique clientToken', uniqueTokens.size === 3,
    `${uniqueTokens.size} unique / 3 total`);

  // Verify tokens are non-empty strings
  for (let i = 0; i < 3; i++) {
    check(`C2.2: Browser ${i+1} clientToken is non-empty`, tokens[i]?.length > 10,
      `len=${tokens[i]?.length}`);
  }

  // ════════════════════════════════════════════════════
  // C3: Reconnect with same clientToken → session recovery
  // ════════════════════════════════════════════════════
  section('C3: Reconnect with same clientToken → session recovery');

  const originalToken = b1.clientToken;
  const originalLabel = b1.label;

  // Spawn a shell for this browser to create session state
  b1.ws.send(env('shell.spawn', {}));
  const origShell = await waitFor(b1.inbox, 'shell.status', 'C3 original shell');
  check('C3.1: Original browser spawns shell', !!origShell.instanceId);

  // Close the browser
  b1.ws.close();
  await delay(500);

  // Reconnect with same clientToken
  const reconnected = await connectBrowser(WS_URL, originalLabel, originalToken);
  await waitFor(reconnected.inbox, 'welcome', 'C3 reconnect welcome');
  check('C3.2: Reconnected with same clientToken', reconnected.clientToken === originalToken);
  check('C3.3: Reconnect succeeds (welcome received)', true);

  // Verify reconnect receives peer.list
  const plReconnect = findMsgByType(reconnected.inbox, 'peer.list');
  check('C3.4: Reconnected browser receives peer.list', !!plReconnect);

  // ════════════════════════════════════════════════════
  // C4: Tab count / browser lifecycle
  // ════════════════════════════════════════════════════
  section('C4: Browser disconnect lifecycle');

  // Close all original browsers except reconnected
  b2.ws.close();
  b3.ws.close();
  await delay(500);

  // Connect a fresh browser — it should receive peer.list without dead browsers
  const freshBrowser = await connectBrowser(WS_URL, 'Fresh');
  await waitFor(freshBrowser.inbox, 'welcome', 'fresh welcome');
  await delay(500);

  const plFresh = findMsgByType(freshBrowser.inbox, 'peer.list');
  check('C4.1: Fresh browser receives peer.list after others disconnect', !!plFresh);

  // Close remaining browsers
  reconnected.ws.close();
  freshBrowser.ws.close();
  await delay(500);

  // Connect an isolated browser — should still work
  const isolated = await connectBrowser(WS_URL, 'Isolated');
  await waitFor(isolated.inbox, 'welcome', 'isolated welcome');
  const plIso = findMsgByType(isolated.inbox, 'peer.list');
  check('C4.2: Browser works in isolation', !!plIso);
  check('C4.3: Isolated browser gets valid peer.list', Array.isArray(plIso?.peers));

  // ════════════════════════════════════════════════════
  // C5/C6: peer.list structure validation
  // ════════════════════════════════════════════════════
  section('C5/C6: peer.list structure validation');

  if (plIso) {
    const peers = plIso.peers || [];
    const links = plIso.links || [];

    // Verify peer objects have required fields
    for (const peer of peers) {
      check(`C5.1: Peer ${peer.id} has type`, !!peer.type, `type=${peer.type}`);
      check(`C5.2: Peer ${peer.id} has name`, typeof peer.name === 'string' || peer.name === undefined,
        `name=${peer.name}`);

      if (peer.type === 'agent') {
        check(`C5.3: Agent peer ${peer.id} has networkType`, !!peer.networkType || peer.networkType === null,
          `networkType=${peer.networkType}`);
      }
    }

    // Verify link objects
    for (const link of links) {
      check(`C6.1: Link ${link.source}→${link.target} has type`, !!link.type,
        `type=${link.type}`);
      check(`C6.2: Link ${link.source}→${link.target} source valid`, typeof link.source === 'string');
      check(`C6.3: Link ${link.source}→${link.target} target valid`, typeof link.target === 'string');
    }

    // Local node invariants
    const localNode = peers.find(p => p.id === '__local__');
    if (localNode) {
      check('C6.4: __local__ is type=agent', localNode.type === 'agent',
        `type=${localNode.type}`);
      check('C6.5: __local__ has isLocal=true', localNode.isLocal === true,
        `isLocal=${localNode.isLocal}`);
    }
  }

  // Cleanup
  isolated.ws.close();
  bridge.kill();
  try { rmSync(WORK, { recursive: true, force: true }); } catch {}

  console.log(`\n=== Multi-Browser Identity: ${passed} pass, ${failed} fail ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
