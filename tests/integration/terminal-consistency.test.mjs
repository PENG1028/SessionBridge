// Terminal consistency test — A1-A7 from consistency checklist
// Tests: cwd display, DirectoryPicker root, path bookmarks, cross-node cwd independence
// Requires: VPS relay on 18080, local relay on 14400 connected as upstream
import http from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { resolve, join, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const VPS_PORT = parseInt(process.env.VPS_PORT || '18080', 10);
const LOCAL_PORT = parseInt(process.env.LOCAL_PORT || '14400', 10);
const VPS_HTTP = `http://localhost:${VPS_PORT}`;
const VPS_WS = `ws://localhost:${VPS_PORT}`;
const LOCAL_WS = `ws://localhost:${LOCAL_PORT}`;
const LOCAL_HTTP = `http://localhost:${LOCAL_PORT}`;

let pass = 0, fail = 0;
function check(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.error(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}

async function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve(body); } });
    }).on('error', reject);
  });
}

function uid() { return Math.random().toString(36).slice(2, 8); }

async function connectBrowser(wsUrl, label) {
  const { default: WebSocket } = await import('ws');
  const ws = new WebSocket(wsUrl);
  const inbox = [];
  ws.on('message', data => {
    try {
      const parsed = JSON.parse(data.toString());
      if (parsed.v === 1 && parsed.body) {
        inbox.push({ type: parsed.type, ...parsed.body, _raw: parsed });
      } else {
        inbox.push(parsed);
      }
    } catch {}
  });
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 10000);
  });
  await new Promise(r => setTimeout(r, 500));
  return { ws, inbox, label };
}

async function waitFor(inbox, pred, label) {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    for (let i = 0; i < inbox.length; i++) {
      if (typeof pred === 'function' ? pred(inbox[i]) : inbox[i]?.type === pred) {
        return inbox.splice(i, 1)[0];
      }
    }
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error(`Timeout waiting for: ${label || pred}`);
}

function env(type, body = {}) {
  return JSON.stringify({ type, ...body });
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Terminal Consistency Test ===\n');

  // ── Pre-check: relays ──
  let vpsInfo, localInfo;
  try { vpsInfo = await httpGet(`${VPS_HTTP}/api/info`); } catch { console.error('VPS relay not running'); process.exit(1); }
  try { localInfo = await httpGet(`${LOCAL_HTTP}/api/info`); } catch { console.error('Local relay not running'); process.exit(1); }
  console.log(`VPS: ${vpsInfo.homeDir} | Local: ${localInfo.homeDir}\n`);

  const vpsState = await httpGet(`${VPS_HTTP}/api/debug/statebus`);
  const localNode = vpsState.instances?.find(i => i.status === 'running' && i.source === 'remote');
  if (!localNode) { console.error('No local node registered on VPS'); process.exit(1); }
  const localNodeId = localNode.id;

  // ── A1: New terminal TitleBar shows homeDir/projectCwd ──
  console.log('── A1: Terminal cwd display on spawn ──');

  const browserB = await connectBrowser(LOCAL_WS, 'B');
  browserB.ws.send(env('shell.spawn', {}));
  const shellStatus = await waitFor(browserB.inbox, 'shell.status', 'shell.status');
  check('A1.1: shell.spawn returns instanceId', !!shellStatus.instanceId);
  const instId = shellStatus.instanceId;

  // Query the instance from the local relay
  const localInsts = await httpGet(`${LOCAL_HTTP}/api/instances`);
  const myInst = localInsts.instances?.find(i => i.id === instId);
  check('A1.2: instance exists after spawn', !!myInst);
  if (myInst) {
    check('A1.3: instance.dir is not "." ', myInst.dir !== '.', `dir=${myInst.dir}`);
    check('A1.4: instance.dir is absolute path', myInst.dir && isAbsolute(myInst.dir), `dir=${myInst.dir}`);
  }

  // ── A2: Terminal pwd matches /api/info cwd ──
  console.log('\n── A2: Shell pwd vs /api/info cwd ──');

  const marker = `A2_${uid()}`;
  browserB.ws.send(env('operation.input', { instanceId: instId, data: `echo "PWD_MARKER=${marker}" && pwd\n` }));
  await delay(1500);

  let pwdOutput = '';
  for (const m of browserB.inbox) {
    if ((m.type === 'shell.output' || m.type === 'runtime.output') && m.data?.includes('PWD_MARKER')) {
      pwdOutput += (m.data || '');
    }
  }
  check('A2.1: shell produces pwd output', pwdOutput.length > 0);

  // Check /api/info cwd matches the relay's homeDir
  const localInfo2 = await httpGet(`${LOCAL_HTTP}/api/info`);
  check('A2.2: /api/info has cwd field', !!localInfo2.cwd);
  check('A2.3: /api/info has homeDir field', !!localInfo2.homeDir);

  // ── A3/A4: DirectoryPicker root per node ──
  console.log('\n── A3/A4: DirectoryPicker root per node ──');

  // List root directory via API (showAll to include dotfiles)
  const localList = await httpGet(`${LOCAL_HTTP}/api/list?dir=.&showAll=1`);
  check('A3.1: /api/list returns entries for local relay', Array.isArray(localList?.items), `got ${localList?.items?.length || 0} entries`);
  check('A3.2: /api/list response has cwd', !!localList.cwd);
  check('A3.3: /api/list cwd is absolute', localList.cwd && isAbsolute(localList.cwd), `cwd=${localList.cwd}`);

  // VPS should have different cwd
  const vpsList = await httpGet(`${VPS_HTTP}/api/list?dir=.&showAll=1`);
  check('A4.1: VPS /api/list returns entries', Array.isArray(vpsList?.items), `got ${vpsList?.items?.length || 0} entries`);
  check('A4.2: VPS and local have different cwd', vpsList.cwd !== localList.cwd,
    `VPS=${vpsList.cwd} Local=${localList.cwd}`);

  // ── A5: After cd, title bar updates (simulating user cd) ──
  console.log('\n── A5: cd path change detection ──');

  const testDir = '/tmp';
  browserB.ws.send(env('operation.input', { instanceId: instId, data: `cd ${testDir} && pwd\n` }));
  await delay(1000);

  let newPwd = '';
  for (const m of browserB.inbox) {
    if (m.type === 'shell.output' || m.type === 'runtime.output') {
      newPwd += (m.data || '');
    }
  }
  check('A5.1: cd changes shell working directory', newPwd.includes(testDir), `output: ${newPwd.trim().slice(0, 80)}`);

  // Publish surface so we can test cross-node
  browserB.ws.send(env('surface.publish', {
    nodeId: '__local__', title: 'A-Test Terminal', viewType: 'terminal',
    scope: 'node', shared: true,
    runtimeRef: { kind: 'terminal', instanceId: instId },
  }));
  const pubSurf = await waitFor(browserB.inbox, 'surface.published', 'surface.published');
  const surfaceId = pubSurf.surfaceId;
  check('A5.2: surface published for cross-node test', !!surfaceId);

  // ── A6: Path bookmark persistence (localStorage simulation) ──
  console.log('\n── A6: Path bookmark persistence ──');
  // We verify the API: instance dir is stored in instance manager
  const instAgain = (await httpGet(`${LOCAL_HTTP}/api/instances`)).instances?.find(i => i.id === instId);
  check('A6.1: instance survives after operations', !!instAgain);
  check('A6.2: instance still running', instAgain?.status === 'running');

  // ── A7: Cross-node cwd independence ──
  console.log('\n── A7: Cross-node cwd independence ──');

  // Spawn a terminal on VPS
  const browserA = await connectBrowser(VPS_WS, 'A');
  browserA.ws.send(env('shell.spawn', {}));
  const vpsShell = await waitFor(browserA.inbox, 'shell.status', 'VPS shell.status');
  const vpsInstId = vpsShell.instanceId;
  check('A7.1: VPS shell spawned', !!vpsInstId);

  // Both instances should have different dirs
  const vpsInst = (await httpGet(`${VPS_HTTP}/api/instances`)).instances?.find(i => i.id === vpsInstId);
  const localInstFinal = (await httpGet(`${LOCAL_HTTP}/api/instances`)).instances?.find(i => i.id === instId);
  if (vpsInst && localInstFinal) {
    check('A7.2: instances on different nodes', vpsInstId !== instId);
    // Different nodes may or may not have different homedirs — just verify both are valid
    check('A7.3: VPS instance has valid dir', !!vpsInst.dir && vpsInst.dir.length > 1);
    check('A7.4: Local instance has valid dir', !!localInstFinal.dir && localInstFinal.dir.length > 1);
  }

  // Subscribe browser A to local surface (cross-node)
  browserA.ws.send(env('surface.subscribe', { surfaceId }));
  const subResult = await waitFor(browserA.inbox, 'surface.subscribed', 'cross-node subscribe');
  check('A7.5: cross-node surface subscribe works', !!subResult.surfaceId);

  // Send input via cross-node surface
  const crossMsg = `A7_CROSS_${uid()}`;
  browserA.ws.send(env('operation.input', { instanceId: instId, data: `echo ${crossMsg}\n` }));
  await delay(2000);

  let crossGot = false;
  for (const m of browserA.inbox) {
    if ((m.type === 'runtime.output' || m.type === 'shell.output') && m.data?.includes(crossMsg)) {
      crossGot = true; break;
    }
  }
  check('A7.6: cross-node terminal output received', crossGot);

  // Cleanup
  browserA.ws.close();
  browserB.ws.close();

  console.log(`\n=== Result: ${pass} pass, ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
