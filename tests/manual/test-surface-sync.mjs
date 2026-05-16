// Verify: check surfaces under __local__ on VPS too
import WebSocket from 'ws';

const VPS = 'ws://43.160.241.180:8080';

async function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const msgs = [];
    ws.on('open', () => {
      ws.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'hello', body: { role: 'browser' } }));
    });
    ws.on('message', (raw) => {
      msgs.push(JSON.parse(raw.toString()));
      if (msgs.length > 20) { ws.close(); resolve(msgs); }
    });
    ws.on('error', reject);
    setTimeout(() => { ws.close(); resolve(msgs); }, 5000);
  });
}

async function main() {
  console.log('=== Querying VPS __local__ surfaces ===');
  const msgs = await connect(VPS);

  // Just listen - the peer.list + subscribe might auto-trigger
  const peerList = msgs.find(m => m.type === 'peer.list');
  if (peerList) {
    console.log('VPS has these nodes:');
    for (const p of (peerList.body?.peers || [])) {
      console.log(`  ${p.id} label=${p.label}`);
    }
  }

  // Now do an active query for __local__
  const ws2 = await new Promise((resolve, reject) => {
    const ws = new WebSocket(VPS);
    ws.on('open', () => {
      ws.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'hello', body: { role: 'browser' } }));
    });
    const timer = setTimeout(() => resolve(ws), 2000);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'welcome') { clearTimeout(timer); resolve(ws); }
    });
    ws.on('error', reject);
  });

  await new Promise(r => setTimeout(r, 1000));

  // Query for __local__ surfaces
  ws2.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'surface.subscribeNode', body: { nodeId: '__local__' } }));

  const result = await new Promise(resolve => {
    ws2.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'surface.list') {
        const surfaces = msg.surfaces || msg.body?.surfaces || [];
        const nid = msg.nodeId || msg.body?.nodeId;
        resolve({ nodeId: nid, surfaces });
      }
    });
    setTimeout(() => resolve(null), 3000);
  });

  if (result) {
    console.log(`\nVPS node=${result.nodeId} surfaces: ${result.surfaces.length}`);
    for (const s of result.surfaces) {
      console.log(`  surf=${s.surfaceId} title="${s.title}" nodeId=${s.nodeId} instanceId=${s.runtimeRef?.instanceId}`);
    }
  } else {
    console.log('\nNo surface.list response');
  }

  ws2.close();
}

main().catch(console.error);
