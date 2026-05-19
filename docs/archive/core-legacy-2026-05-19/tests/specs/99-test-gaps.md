# 99 — Test Gaps & Add-Test Guide

## Known Uncovered Areas

### HIGH priority

| Gap | Risk | Suggested Test |
|-----|------|---------------|
| **Config merge priority** | CLI arg → env var → config file merge order wrong → silent misconfig | Start relay with overlapping sources, assert final values |
| **WebSocket malformed message** | Crash or silent disconnect on bad JSON | Send garbage frame, assert clean close + error event |
| **Concurrent surface create/delete** | Race condition → duplicate or stale surface | 5 browsers + 3 agents creating/deleting simultaneously |
| **Auth bypass via direct WebSocket** | Unauthenticated WS skips permission checks | Connect without hello, attempt shell.spawn |

### MEDIUM priority

| Gap | Risk | Suggested Test |
|-----|------|---------------|
| **Adapter crash recovery** | Adapter process dies → instance stuck "running" | Kill adapter process, assert instance marked stopped |
| **Extension hot-disable** | Disabled extension's contributions still visible | Enable→disable→verify views/chrome removed |
| **Large output buffer** | 10MB+ terminal output → memory/bandwidth issue | Stream 50K lines, assert no OOM, replayPolicy trim works |
| **Network partition** | Agent disconnected silently → operations lost | Kill TCP connection, assert reconnect + resync |
| **Config file invalid JSON** | Bridge crashes on malformed config | Write `{broken` → assert graceful error + fallback |
| **Port already in use** | Second bridge on same port → confusing error | Start two bridges on same port, assert clear error |

### LOW priority

| Gap | Risk | Suggested Test |
|-----|------|---------------|
| **File tree with 10K entries** | DirectoryPicker hangs | List large dir, assert pagination or timeout |
| **Unicode in terminal** | CJK/emoji mangled in output | Echo 中文🎉, assert round-trip |
| **Midnight rollover** | Uptime counter wraps | Mock Date, assert no crash |
| **Multiple upstream relays** | Topology > 2 nodes → peer list blows up | 3 relays in chain, assert peer count bounded |

## Template: How to Add a New Test

```javascript
// ─── <Test Name> ──────────────────────────────────────────
// <One-line description of what this verifies>
//
// Self-contained — spawns its own bridge process.
//
// Usage:
//   node tests/integration/<name>.test.mjs

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

function section(name) { console.log(`\n── ${name} ──`); }

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

// ── Bridge lifecycle ──
async function startBridge() {
  const WORK = join(tmpdir(), `bridge_<testname>_${uid()}`);
  const CONFIG_DIR = join(WORK, '.sessionbridge');
  mkdirSync(CONFIG_DIR, { recursive: true });
  const PORT = 17000 + randomInt(1, 5000);
  const WS_URL = `ws://127.0.0.1:${PORT}`;
  const HTTP_URL = `http://127.0.0.1:${PORT}`;

  const configPath = join(CONFIG_DIR, 'agent.json');
  writeFileSync(configPath, JSON.stringify({
    label: '<test-label>',
    workingDirectory: WORK,
    relayPort: PORT,
  }, null, 2), 'utf8');

  const bridge = spawn(nodeCmd, [
    BRIDGE, '--relay-port', String(PORT), '--dir', WORK,
    '--label', '<test-label>',
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

  const cleanup = () => {
    try { bridge.kill(); rmSync(WORK, { recursive: true, force: true }); } catch {}
  };
  process.on('exit', cleanup);

  return { bridge, WORK, PORT, WS_URL, HTTP_URL, cleanup };
}

// ── Test body ──
async function main() {
  const ctx = await startBridge();
  console.log(`Bridge started on port ${ctx.PORT}\n`);

  section('<Test category>');

  // ... test logic using check() ...

  ctx.cleanup();
  console.log(`\n=== Result: ${passed} pass, ${failed} fail ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
```

### Naming Convention

- `tests/integration/<feature>-<aspect>.test.mjs`
- Use kebab-case
- Each file is self-contained (spawns own bridge)
- If it needs external relays, document in the first comment

### After Adding

1. Add a row to the relevant `tests/specs/NN-category.md`
2. If a new category, create `NN-category.md` and update `tests/specs/README.md`
3. Run: `node tests/integration/<name>.test.mjs`
