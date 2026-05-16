// End-to-end test: publish a surface, verify cross-relay sync
import WebSocket from 'ws';

const LOCAL = 'ws://127.0.0.1:9000';
const VPS = 'ws://43.160.241.180:8080';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function connect(url, onMsg) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => {
      ws.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'hello', body: { role: 'browser' } }));
    });
    const timer = setTimeout(() => { ws.close(); resolve(null); }, 15000);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (onMsg) onMsg(msg);
      if (msg.type === 'welcome') {
        clearTimeout(timer);
        resolve(ws);
      }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

async function main() {
  // Step 1: Connect to local relay and find PENGSPC node
  console.log('1. Connecting to local relay...');
  let localNodeId = null;
  const localWs = await connect(LOCAL, (msg) => {
    if (msg.type === 'peer.list') {
      const peers = msg.body?.peers || [];
      console.log('   Local peers:', peers.map(p => `${p.id}(${p.label})`).join(', '));
      // Find the agent instance
      const agent = peers.find(p => p.id?.startsWith('inst_') && p.label);
      if (agent) localNodeId = agent.id;
    }
  });
  if (!localWs) { console.error('Failed to connect to local relay'); return; }
  await delay(2000);

  if (!localNodeId) {
    console.log('   No agent node found on local relay, trying __local__');
    localNodeId = '__local__';
  }
  console.log(`   Using nodeId: ${localNodeId}`);

  // Step 2: Get existing surfaces and tabs on local relay
  console.log('\n2. Querying existing state on local relay...');
  let localTabs = [];
  let localSurfaces = [];
  localWs.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'workbench.subscribe', body: { nodeId: localNodeId } }));
  localWs.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'surface.subscribeNode', body: { nodeId: localNodeId } }));

  const localPreState = await new Promise(resolve => {
    const state = { tabs: null, surfaces: null };
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'workbench.tabs') state.tabs = msg.tabs || msg.body?.tabs || [];
      if (msg.type === 'surface.list') state.surfaces = msg.surfaces || msg.body?.surfaces || [];
      if (state.tabs !== null && state.surfaces !== null) {
        localWs.removeListener('message', handler);
        resolve(state);
      }
    };
    localWs.on('message', handler);
    setTimeout(() => { localWs.removeListener('message', handler); resolve(state); }, 3000);
  });
  console.log(`   Local tabs before: ${JSON.stringify(localPreState.tabs).slice(0, 200)}`);
  console.log(`   Local surfaces before: ${JSON.stringify(localPreState.surfaces).slice(0, 200)}`);

  // Step 3: Publish a surface
  console.log('\n3. Publishing test surface...');
  const testSurfaceId = 'surf_test_' + Date.now().toString(36);
  localWs.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'surface.publish', body: {
    nodeId: localNodeId,
    title: 'Test Terminal',
    viewType: 'terminal',
    scope: 'node',
    shared: true,
    runtimeRef: { kind: 'terminal', instanceId: 'inst_test_' + Date.now().toString(36) },
    replayPolicy: { mode: 'tail', lines: 5000, bytes: 500000 },
  }}));

  await delay(1500);

  // Step 4: Check local relay after publish
  console.log('\n4. Checking local relay after publish...');
  localWs.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'surface.subscribeNode', body: { nodeId: localNodeId } }));
  const localAfter = await new Promise(resolve => {
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'surface.list') {
        localWs.removeListener('message', handler);
        resolve(msg.surfaces || msg.body?.surfaces || []);
      }
    };
    localWs.on('message', handler);
    setTimeout(() => { localWs.removeListener('message', handler); resolve([]); }, 3000);
  });
  console.log(`   Local surfaces after: ${localAfter.length}`);
  for (const s of localAfter) {
    console.log(`     - ${s.surfaceId} title="${s.title}" instanceId=${s.runtimeRef?.instanceId} opId=${s.runtimeRef?.operationId}`);
  }

  // Step 5: Check VPS relay
  console.log('\n5. Connecting to VPS relay to check cross-relay sync...');
  const vpsNodeIds = [];
  const vpsWs = await connect(VPS, (msg) => {
    if (msg.type === 'peer.list') {
      const peers = msg.body?.peers || [];
      console.log('   VPS peers:', peers.map(p => `${p.id}(${p.label})`).join(', '));
      for (const p of peers) {
        if (p.id?.startsWith('inst_')) vpsNodeIds.push(p.id);
      }
    }
  });
  if (!vpsWs) { console.error('Failed to connect to VPS relay'); return; }
  await delay(2000);

  // Query surfaces for all VPS nodes
  console.log(`   Querying surfaces for ${vpsNodeIds.length} VPS nodes...`);
  for (const nid of vpsNodeIds) {
    vpsWs.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'surface.subscribeNode', body: { nodeId: nid } }));
  }
  const vpsSurfaces = await new Promise(resolve => {
    const found = [];
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'surface.list') {
        const surfaces = msg.surfaces || msg.body?.surfaces || [];
        const nid = msg.nodeId || msg.body?.nodeId || '?';
        for (const s of surfaces) found.push({ nodeId: nid, ...s });
        if (found.length > 0) console.log(`     Got ${surfaces.length} surfaces for node ${nid}`);
      }
    };
    vpsWs.on('message', handler);
    setTimeout(() => { vpsWs.removeListener('message', handler); resolve(found); }, 3000);
  });
  console.log(`   VPS surfaces total: ${vpsSurfaces.length}`);
  for (const s of vpsSurfaces) {
    console.log(`     - node=${s.nodeId} surf=${s.surfaceId} title="${s.title}"`);
  }

  // Cleanup
  localWs.close();
  vpsWs.close();
  console.log('\n=== DONE ===');
}

main().catch(console.error);
