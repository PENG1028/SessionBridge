// Focused T2.4 debug test
import http from 'http';

const VPS_PORT = parseInt(process.env.VPS_PORT || '18080', 10);
const LOCAL_PORT = parseInt(process.env.LOCAL_PORT || '14400', 10);
const VPS_HTTP = `http://localhost:${VPS_PORT}`;
const VPS_WS = `ws://localhost:${VPS_PORT}`;
const LOCAL_WS = `ws://localhost:${LOCAL_PORT}`;

async function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(body); }
      });
    }).on('error', reject);
  });
}

function uid() { return Math.random().toString(36).slice(2, 8); }

async function connectBrowser(wsUrl, label) {
  const { default: WebSocket } = await import('ws');
  const ws = new WebSocket(wsUrl);
  const inbox = [];
  ws.on('message', data => {
    try { inbox.push(JSON.parse(data.toString())); } catch {}
  });
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 10000);
  });
  // Wait for welcome
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

function drainMsgs(inbox, types) {
  for (let i = inbox.length - 1; i >= 0; i--) {
    if (types.includes(inbox[i]?.type)) inbox.splice(i, 1);
  }
}

function env(type, body = {}) {
  return JSON.stringify({ type, ...body });
}

async function main() {
  console.log('T2 Debug Test — focused cross-node terminal output test\n');

  // Verify relays
  const vpsInfo = await httpGet(`${VPS_HTTP}/api/info`);
  console.log(`VPS: ${vpsInfo.version} ${vpsInfo.homeDir}`);
  const vpsState = await httpGet(`${VPS_HTTP}/api/debug/statebus`);
  const downInst = vpsState.instances?.find(i => i.label === 'local-test-node' && i.status === 'running');
  if (!downInst) { console.error('Local relay not registered on VPS'); process.exit(1); }
  const localNodeId = downInst.id;
  console.log(`Local node: ${localNodeId}`);

  // Connect browsers
  const browserA = await connectBrowser(VPS_WS, 'A');
  console.log('Browser A connected to VPS');
  const browserB = await connectBrowser(LOCAL_WS, 'B');
  console.log('Browser B connected to Local');

  // T2: Spawn shell on local relay
  browserB.ws.send(env('shell.spawn', {}));
  const t2Stat = await waitFor(browserB.inbox, m => m.type === 'shell.status', 'B t2 op');
  console.log(`T2.1: Shell spawned. instId=${t2Stat.instanceId} keys=${Object.keys(t2Stat).join(',')}`);

  if (!t2Stat.instanceId) {
    console.error('FAIL: shell.status missing instanceId');
    process.exit(1);
  }
  const t2InstId = t2Stat.instanceId;
  console.log(`Using instanceId: ${t2InstId}`);

  await delay(1500);
  drainMsgs(browserB.inbox, ['shell.output', 'runtime.output', 'operation.output']);

  // Verify instance exists on local relay
  const localState = await httpGet(`http://localhost:${LOCAL_PORT}/api/debug/statebus`);
  const localInst = localState.instances?.find(i => i.id === t2InstId);
  console.log(`Local instance ${t2InstId}: ${localInst ? `found (${localInst.source}/${localInst.status})` : 'NOT FOUND!'}`);

  // Publish surface
  browserB.ws.send(env('surface.publish', {
    nodeId: '__local__', title: 'T2 Local Remote', viewType: 'terminal',
    scope: 'node', shared: true,
    runtimeRef: { kind: 'terminal', instanceId: t2InstId },
  }));
  const t2Surf = await waitFor(browserB.inbox, m => m.type === 'surface.published', 'B t2 surf');
  console.log(`T2.2: Surface published. surfaceId=${t2Surf.surfaceId} rtRef=${JSON.stringify(t2Surf.surface?.runtimeRef)}`);

  await delay(3000);

  // Verify surface on both relays
  const localSurfState = await httpGet(`http://localhost:${LOCAL_PORT}/api/debug/surfaces`);
  const localSurf = localSurfState.surfaceDebug?.surfaces?.find(s => s.surfaceId === t2Surf.surfaceId);
  console.log(`Local surface check: ${localSurf ? `found (inst=${localSurf.runtimeRef?.instanceId})` : 'NOT FOUND!'}`);

  const vpsSurfState = await httpGet(`${VPS_HTTP}/api/debug/surfaces`);
  const vpsSurf = vpsSurfState.surfaceDebug?.surfaces?.find(s => s.surfaceId === t2Surf.surfaceId);
  console.log(`VPS surface check: ${vpsSurf ? `found (inst=${vpsSurf.runtimeRef?.instanceId}, nodeId=${vpsSurf.nodeId})` : 'NOT FOUND!'}`);

  // Subscribe Browser A to the surface via VPS
  browserA.ws.send(env('surface.subscribe', { surfaceId: t2Surf.surfaceId }));
  const t2SubA = await waitFor(browserA.inbox, m => m.type === 'surface.subscribed', 'A t2 sub');
  console.log(`T2.3: Browser A subscribed. surfaceId=${t2SubA.surfaceId}`);

  await delay(500);

  // Send input to Browser B via instanceId
  const t2Msg = `T2_DEBUG_${uid()}`;
  browserB.ws.send(env('operation.input', { instanceId: t2InstId, data: `echo ${t2Msg}\n` }));
  console.log(`Sent operation.input: echo ${t2Msg}`);

  // Check Browser B gets shell.output (local)
  const t2Start = Date.now();
  let localGot = false;
  while (Date.now() - t2Start < 5000) {
    const outputs = browserB.inbox.filter(m => m.type === 'shell.output' || m.type === 'runtime.output' || m.type === 'operation.output');
    if (outputs.some(o => o.data && o.data.includes(t2Msg))) { localGot = true; break; }
    await delay(100);
  }
  console.log(`Browser B (local) received output: ${localGot}`);

  // Check Browser A gets output via VPS
  let crossGot = false;
  const crossStart = Date.now();
  while (Date.now() - crossStart < 15000) {
    const outputs = browserA.inbox.filter(m => m.type === 'runtime.output' || m.type === 'operation.output' || m.type === 'shell.output');
    if (outputs.some(o => o.data && o.data.includes(t2Msg))) { crossGot = true; break; }
    await delay(100);
  }
  console.log(`Browser A (cross-node) received output: ${crossGot}`);

  // Summary
  console.log(`\n=== Result: T2.4 ${crossGot ? 'PASS' : 'FAIL'} ===`);

  browserA.ws.close();
  browserB.ws.close();
  process.exit(crossGot ? 0 : 1);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
