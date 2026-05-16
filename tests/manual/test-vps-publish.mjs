// Publish a surface to VPS under a real instance node and verify
import WebSocket from 'ws';

const VPS = 'ws://43.160.241.180:8080';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function connect(url, onMsg) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.close(); resolve(null); }, 15000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'hello', body: { role: 'browser' } }));
    });
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
  console.log('=== Step 1: Connect to VPS and discover instances ===');
  let targetNode = null;
  const peers = [];

  const ws = await connect(VPS, (msg) => {
    if (msg.type === 'peer.list') {
      for (const p of (msg.body?.peers || [])) {
        peers.push(p);
        console.log(`  Peer: ${p.id} label=${p.label} role=${p.role || '?'} source=${p.source || 'local'}`);
        if (p.id?.startsWith('inst_') && p.role === 'leaf') targetNode = p.id;
      }
    }
  });
  if (!ws) { console.error('Failed to connect'); return; }
  await delay(2000);

  if (!targetNode) {
    console.log('No leaf instance found. Available peers:');
    for (const p of peers) console.log(`  ${p.id}`);
    // Fall back to inst_8 if we know it
    if (peers.find(p => p.id === 'inst_8_mp7ueflx')) {
      targetNode = 'inst_8_mp7ueflx';
      console.log(`  Using fallback: ${targetNode}`);
    } else {
      console.log('No target node found');
      ws.close();
      return;
    }
  }
  console.log(`\nTarget node: ${targetNode}`);

  // Step 2: Check existing surfaces for target node
  console.log('\n=== Step 2: Query existing surfaces ===');
  ws.send(JSON.stringify({ v:1, ts:Date.now(), type:'surface.subscribeNode', body:{nodeId: targetNode} }));

  const existing = await new Promise(resolve => {
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'surface.list') {
        const surfs = msg.surfaces || msg.body?.surfaces || [];
        const nid = msg.nodeId || msg.body?.nodeId || '?';
        console.log(`  Node ${nid} has ${surfs.length} surfaces:`);
        for (const s of surfs) {
          console.log(`    - ${s.surfaceId} title="${s.title}" viewType=${s.viewType} kind=${s.runtimeRef?.kind} instanceId=${s.runtimeRef?.instanceId || 'none'}`);
        }
        ws.removeListener('message', handler);
        resolve(surfs);
      }
    };
    ws.on('message', handler);
    setTimeout(() => { ws.removeListener('message', handler); resolve([]); }, 3000);
  });

  // Step 3: Publish a test surface under the target node
  console.log('\n=== Step 3: Publish test surface ===');
  const testSurfaceId = 'surf_test_' + Date.now().toString(36);
  ws.send(JSON.stringify({ v:1, ts:Date.now(), type:'surface.publish', body: {
    nodeId: targetNode,
    title: 'Test Terminal',
    viewType: 'terminal',
    scope: 'node',
    shared: true,
    runtimeRef: { kind: 'terminal', instanceId: 'inst_test_' + Date.now().toString(36) },
    replayPolicy: { mode: 'tail', lines: 5000, bytes: 500000 },
  }}));

  // Wait for surface.published confirmation
  const published = await new Promise(resolve => {
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'surface.published') {
        console.log('  Published surface:', JSON.stringify(msg.body || msg).slice(0, 500));
        ws.removeListener('message', handler);
        resolve(msg.surface || msg.body?.surface || {});
      }
      if (msg.type === 'error') {
        console.log('  Error:', JSON.stringify(msg.body || msg));
        ws.removeListener('message', handler);
        resolve(null);
      }
    };
    ws.on('message', handler);
    setTimeout(() => { ws.removeListener('message', handler); resolve(null); }, 3000);
  });

  if (!published) {
    console.log('  No surface.published response');
  }

  await delay(500);

  // Step 4: Re-query to verify
  console.log('\n=== Step 4: Verify surface stored correctly ===');
  ws.send(JSON.stringify({ v:1, ts:Date.now(), type:'surface.subscribeNode', body:{nodeId: targetNode} }));

  const after = await new Promise(resolve => {
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'surface.list') {
        const surfs = msg.surfaces || msg.body?.surfaces || [];
        const nid = msg.nodeId || msg.body?.nodeId || '?';
        console.log(`  Node ${nid} has ${surfs.length} surfaces:`);
        for (const s of surfs) {
          console.log(`    - ${s.surfaceId} title="${s.title}" viewType=${s.viewType} kind=${s.runtimeRef?.kind} instanceId=${s.runtimeRef?.instanceId || 'none'} opId=${s.runtimeRef?.operationId || 'none'}`);
        }
        ws.removeListener('message', handler);
        resolve(surfs);
      }
    };
    ws.on('message', handler);
    setTimeout(() => { ws.removeListener('message', handler); resolve([]); }, 3000);
  });

  // Also check workbench.tabs
  console.log('\n=== Step 5: Check workbench.tabs projection ===');
  ws.send(JSON.stringify({ v:1, ts:Date.now(), type:'workbench.subscribe', body:{nodeId: targetNode} }));
  await new Promise(resolve => {
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'workbench.tabs') {
        const tabs = msg.tabs || msg.body?.tabs || [];
        console.log(`  Tabs for ${targetNode}: ${tabs.length}`);
        for (const t of tabs) {
          console.log(`    - ${t.id} title="${t.title}" viewType=${t.viewType} _surfaceId=${t._surfaceId || 'none'} instanceId=${t.instanceId || 'none'}`);
        }
        ws.removeListener('message', handler);
        resolve(tabs);
      }
    };
    ws.on('message', handler);
    setTimeout(() => { ws.removeListener('message', handler); resolve([]); }, 2000);
  });

  console.log('\n=== DONE ===');
  ws.close();
}

main().catch(console.error);
