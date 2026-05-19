// Full tab sync test: surface.publish → surface → workbench.tabs → cross-relay
import WebSocket from 'ws';

const LOCAL_WS = 'ws://localhost:14400';
const VPS_WS = 'ws://localhost:18080';
const TEST_INSTANCE_ID = 'inst_tabsync_' + Date.now();
const TEST_TITLE = 'TabSyncTest-' + Date.now();

let passed = 0;
let failed = 0;
function check(label, condition, detail) {
  if (condition) { passed++; console.log(`  [PASS] ${label}`); }
  else { failed++; console.error(`  [FAIL] ${label}${detail ? ': ' + detail : ''}`); }
}

async function main() {
  console.log('=== Full Tab Sync Pipeline Test ===');
  console.log('InstanceId:', TEST_INSTANCE_ID);
  console.log('Title:', TEST_TITLE);
  console.log('');

  // Step 1: Connect to local relay as a browser
  console.log('--- Step 1: Browser connects to LOCAL relay ---');
  const localWs = new WebSocket(LOCAL_WS);
  let localTabCount = -1;
  let localSurfaceReceived = false;

  await new Promise((resolve, reject) => {
    localWs.on('open', () => {
      console.log('  Local WS connected');
      // Subscribe to workbench tabs
      localWs.send(JSON.stringify({ type: 'workbench.subscribe', nodeId: '__local__' }));
      console.log('  Sent workbench.subscribe(__local__)');
      resolve();
    });
    localWs.on('error', (e) => reject(e));
    setTimeout(() => reject(new Error('Local WS connect timeout')), 5000);
  });

  // Collect workbench.tabs responses
  localWs.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'workbench.tabs') {
      localTabCount = (msg.tabs || []).length;
      console.log(`  Received workbench.tabs: ${localTabCount} tabs`);
    }
    if (msg.type === 'surface.published') {
      localSurfaceReceived = true;
      console.log(`  Received surface.published: ${msg.surfaceId}`);
    }
  });

  await sleep(500);

  // Step 2: Send surface.publish from local browser
  console.log('\n--- Step 2: Browser creates terminal (surface.publish) ---');
  localWs.send(JSON.stringify({
    type: 'surface.publish',
    nodeId: '__local__',
    title: TEST_TITLE,
    viewType: 'terminal',
    scope: 'node',
    shared: true,
    runtimeRef: { kind: 'terminal', instanceId: TEST_INSTANCE_ID },
    replayPolicy: { mode: 'tail', lines: 5000, bytes: 500000 },
    _label: 'PENGSPC',
  }));
  console.log('  Sent surface.publish with title:', TEST_TITLE);

  await sleep(2000);

  // Step 3: Check LOCAL relay for surface + workbench tabs
  console.log('\n--- Step 3: Verify LOCAL relay state ---');
  const localSurfaces = await fetch('http://localhost:14400/api/debug/surfaces').then(r => r.json());
  const localSurf = localSurfaces.surfaceDebug.surfaces.find(s => s.title === TEST_TITLE);
  check('Surface exists on LOCAL', !!localSurf, localSurf ? `surfaceId=${localSurf.surfaceId} nodeId=${localSurf.nodeId}` : 'not found');

  // Check workbench tabs on local
  const localWb = localSurfaces.surfaceDebug;
  check('Received surface.published on local WS', localSurfaceReceived);

  // Also check workbench tabs via the debug endpoint
  if (localSurfaces.workbenchTabs) {
    const localTabs = localSurfaces.workbenchTabs['__local__'] || [];
    const foundTab = localTabs.find(t => t.title === TEST_TITLE);
    check('Workbench tab exists on LOCAL', !!foundTab, foundTab ? `id=${foundTab.id}` : 'not found');
  } else {
    console.log('  [INFO] workbenchTabs not in debug response');
  }

  // Step 4: Check VPS relay for surface
  console.log('\n--- Step 4: Verify VPS relay received surface ---');
  const vpsSurfaces = await fetch('http://localhost:18080/api/debug/surfaces').then(r => r.json());
  const vpsSurf = vpsSurfaces.surfaceDebug.surfaces.find(s => s.title === TEST_TITLE);
  check('Surface exists on VPS', !!vpsSurf, vpsSurf ? `surfaceId=${vpsSurf.surfaceId} nodeId=${vpsSurf.nodeId}` : 'not found');

  // Check instance info on VPS
  const vpsStatus = await fetch('http://localhost:18080/api/status').then(r => r.json());
  console.log(`  VPS relay: ${vpsStatus.label} (pid ${vpsStatus.pid})`);

  // Show VPS events
  const recentEvents = (vpsSurfaces.surfaceDebug.events || []).slice(-5);
  if (recentEvents.length > 0) {
    console.log('  Recent VPS events:');
    for (const e of recentEvents) {
      console.log(`    [${e.kind}] ${e.message || ''} nodeId=${e.nodeId || ''}`);
    }
  }

  // Step 5: Connect to VPS relay as a browser, subscribe to workbench
  console.log('\n--- Step 5: Browser on VPS sees the synced tab ---');
  const vpsWs = new WebSocket(VPS_WS);
  let vpsTabCount = -1;
  let vpsHasTestTab = false;

  await new Promise((resolve, reject) => {
    vpsWs.on('open', () => {
      console.log('  VPS WS connected');
      vpsWs.send(JSON.stringify({ type: 'workbench.subscribe', nodeId: '__local__' }));
      console.log('  Sent workbench.subscribe(__local__) on VPS');
      resolve();
    });
    vpsWs.on('error', (e) => reject(e));
    setTimeout(() => reject(new Error('VPS WS connect timeout')), 5000);
  });

  vpsWs.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'workbench.tabs') {
      vpsTabCount = (msg.tabs || []).length;
      vpsHasTestTab = (msg.tabs || []).some(t => t.title === TEST_TITLE);
      console.log(`  Received workbench.tabs on VPS: ${vpsTabCount} tabs, hasTestTab=${vpsHasTestTab}`);
      for (const t of (msg.tabs || []).slice(0, 10)) {
        console.log(`    tab id=${t.id} title="${t.title}" viewType=${t.viewType}`);
      }
    }
  });

  await sleep(1000);
  check('VPS workbench.tabs includes test tab', vpsHasTestTab, `tabCount=${vpsTabCount}`);

  // Step 6: VPS browser creates a terminal, check if local sees it
  console.log('\n--- Step 6: VPS browser creates terminal, check LOCAL sees it ---');
  const VPS_TEST_TITLE = 'VpsTabTest-' + Date.now();
  let localSeesVpsTab = false;

  const origHandler = localWs.listeners('message').pop();
  localWs.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === 'workbench.tabs') {
      const hasVpsTab = (msg.tabs || []).some(t => t.title === VPS_TEST_TITLE);
      if (hasVpsTab) {
        localSeesVpsTab = true;
        console.log(`  LOCAL received workbench.tabs with VPS tab: "${VPS_TEST_TITLE}"`);
      }
    }
  });

  vpsWs.send(JSON.stringify({
    type: 'surface.publish',
    nodeId: '__local__',
    title: VPS_TEST_TITLE,
    viewType: 'terminal',
    scope: 'node',
    shared: true,
    runtimeRef: { kind: 'terminal', instanceId: 'inst_vps_' + Date.now() },
    replayPolicy: { mode: 'tail', lines: 5000, bytes: 500000 },
    _label: 'VM-0-15-ubuntu',
  }));
  console.log('  VPS browser sent surface.publish:', VPS_TEST_TITLE);

  await sleep(2000);
  check('LOCAL sees VPS-created tab', localSeesVpsTab);

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  localWs.close();
  vpsWs.close();
  process.exit(failed > 0 ? 1 : 0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
