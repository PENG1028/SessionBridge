// Test cross-relay surface forwarding from LOCAL to VPS
import WebSocket from 'ws';
const LOCAL = 'ws://127.0.0.1:9000';
const VPS = 'ws://43.160.241.180:8080';

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function connect(url) {
  return new Promise((resolve, reject) => {
    const w = new WebSocket(url);
    const t = setTimeout(() => { w.close(); resolve(null); }, 10000);
    w.on('open', () => {
      w.send(JSON.stringify({ v:1, ts:Date.now(), type:'hello', body:{role:'browser'} }));
    });
    w.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'welcome') { clearTimeout(t); resolve(w); }
    });
    w.on('error', () => { clearTimeout(t); resolve(null); });
  });
}

async function main() {
  // Clean old test surfaces from VPS
  console.log('=== Cleaning old test surfaces from VPS ===');
  const vps1 = await connect(VPS);
  if (vps1) {
    vps1.send(JSON.stringify({ v:1, ts:Date.now(), type:'surface.subscribeNode', body:{nodeId:'inst_8_mp7ueflx'} }));
    await new Promise(resolve => {
      vps1.on('message', function h(raw) {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'surface.list') {
          const surfs = msg.surfaces || msg.body?.surfaces || [];
          for (const s of surfs) {
            console.log('  Closing VPS surface: ' + s.surfaceId + ' "' + s.title + '"');
            vps1.send(JSON.stringify({ v:1, ts:Date.now(), type:'surface.close', body:{surfaceId: s.surfaceId, nodeId: s.nodeId || 'inst_8_mp7ueflx'} }));
          }
          vps1.removeListener('message', h);
          resolve();
        }
      });
      setTimeout(resolve, 2000);
    });
    await delay(1000);
    vps1.close();
  }

  // Clean old test surfaces from LOCAL
  console.log('=== Cleaning old test surfaces from LOCAL ===');
  const local1 = await connect(LOCAL);
  if (local1) {
    // Clean __local__
    local1.send(JSON.stringify({ v:1, ts:Date.now(), type:'surface.subscribeNode', body:{nodeId:'__local__'} }));
    await new Promise(resolve => {
      local1.on('message', function h(raw) {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'surface.list') {
          const surfs = msg.surfaces || msg.body?.surfaces || [];
          for (const s of surfs) {
            if (s.title && s.title.includes('Test')) {
              console.log('  Closing LOCAL __local__ surface: ' + s.surfaceId);
              local1.send(JSON.stringify({ v:1, ts:Date.now(), type:'surface.close', body:{surfaceId: s.surfaceId, nodeId: '__local__'} }));
            }
          }
          local1.removeListener('message', h);
          resolve();
        }
      });
      setTimeout(resolve, 2000);
    });
    // Clean inst_8 on local
    local1.send(JSON.stringify({ v:1, ts:Date.now(), type:'surface.subscribeNode', body:{nodeId:'inst_8_mp7ueflx'} }));
    await new Promise(resolve => {
      local1.on('message', function h(raw) {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'surface.list') {
          const surfs = msg.surfaces || msg.body?.surfaces || [];
          for (const s of surfs) {
            console.log('  Closing LOCAL inst_8 surface: ' + s.surfaceId + ' "' + s.title + '"');
            local1.send(JSON.stringify({ v:1, ts:Date.now(), type:'surface.close', body:{surfaceId: s.surfaceId, nodeId: 'inst_8_mp7ueflx'} }));
          }
          local1.removeListener('message', h);
          resolve();
        }
      });
      setTimeout(resolve, 2000);
    });
    await delay(1000);
    local1.close();
  }

  await delay(2000);

  // TEST: Publish surface on LOCAL under inst_8_mp7ueflx
  console.log('\n=== TEST: Publish surface on LOCAL under inst_8_mp7ueflx ===');
  const ws = await connect(LOCAL);
  if (!ws) { console.log('Failed to connect to LOCAL'); return; }
  await delay(500);

  const testInstanceId = 'inst_xrelay_' + Date.now().toString(36);
  console.log('Publishing with instanceId: ' + testInstanceId);

  ws.send(JSON.stringify({ v:1, ts:Date.now(), type:'surface.publish', body: {
    nodeId: 'inst_8_mp7ueflx',
    title: 'XRelay Terminal',
    viewType: 'terminal',
    scope: 'node',
    shared: true,
    runtimeRef: { kind: 'terminal', instanceId: testInstanceId },
    replayPolicy: { mode: 'tail', lines: 5000, bytes: 500000 },
  }}));

  // Get local response
  let localSurface = null;
  await new Promise(resolve => {
    ws.on('message', function h(raw) {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'surface.published') {
        localSurface = msg.surface || msg.body?.surface || {};
        console.log('Local published: id=' + localSurface.surfaceId + ' title="' + localSurface.title + '" kind=' + localSurface.runtimeRef?.kind + ' instanceId=' + (localSurface.runtimeRef?.instanceId||'none'));
        ws.removeListener('message', h);
        resolve();
      }
      if (msg.type === 'error') {
        console.log('Error: ' + JSON.stringify(msg.body || msg));
        ws.removeListener('message', h);
        resolve();
      }
    });
    setTimeout(resolve, 3000);
  });

  await delay(2000);

  // Check VPS
  console.log('\n=== Check VPS for inst_8_mp7ueflx surfaces ===');
  const vpsWs = await connect(VPS);
  if (!vpsWs) { console.log('Failed to connect to VPS'); ws.close(); return; }
  await delay(500);

  vpsWs.send(JSON.stringify({ v:1, ts:Date.now(), type:'surface.subscribeNode', body:{nodeId: 'inst_8_mp7ueflx'} }));

  let foundMatch = false;
  await new Promise(resolve => {
    vpsWs.on('message', function h(raw) {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'surface.list') {
        const surfs = msg.surfaces || msg.body?.surfaces || [];
        console.log('VPS inst_8_mp7ueflx has ' + surfs.length + ' surfaces:');
        for (const s of surfs) {
          const match = s.title === 'XRelay Terminal' || s.runtimeRef?.instanceId === testInstanceId;
          const marker = match ? ' <-- MATCH' : '';
          console.log('  - ' + s.surfaceId + ' title="' + s.title + '" kind=' + s.runtimeRef?.kind + ' instanceId=' + (s.runtimeRef?.instanceId||'none') + marker);
          if (match) foundMatch = true;
        }
        vpsWs.removeListener('message', h);
        resolve();
      }
    });
    setTimeout(resolve, 3000);
  });

  console.log('\n=== RESULT ===');
  if (foundMatch) {
    console.log('SUCCESS: Cross-relay surface forwarding works!');
  } else {
    console.log('FAILED: Surface not synced to VPS');
    // Check if it ended up under __local__
    console.log('\nChecking __local__ on VPS...');
    vpsWs.send(JSON.stringify({ v:1, ts:Date.now(), type:'surface.subscribeNode', body:{nodeId: '__local__'} }));
    await new Promise(resolve => {
      vpsWs.on('message', function h(raw) {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'surface.list') {
          const surfs = msg.surfaces || msg.body?.surfaces || [];
          console.log('VPS __local__ has ' + surfs.length + ' surfaces:');
          for (const s of surfs) {
            console.log('  - ' + s.surfaceId + ' title="' + s.title + '" kind=' + s.runtimeRef?.kind + ' instanceId=' + (s.runtimeRef?.instanceId||'none'));
          }
          vpsWs.removeListener('message', h);
          resolve();
        }
      });
      setTimeout(resolve, 2000);
    });
  }

  ws.close();
  vpsWs.close();
}

main().catch(console.error);
