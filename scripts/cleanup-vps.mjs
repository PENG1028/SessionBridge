import WebSocket from 'ws';

const VPS_WS = 'ws://localhost:18080';
const VPS_HTTP = 'http://localhost:18080';

const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

async function main() {
  // Get surfaces
  const resp = await fetch(`${VPS_HTTP}/api/debug/surfaces`);
  const data = await resp.json();
  const surfaces = data.surfaceDebug?.surfaces || [];
  console.log(`Total surfaces: ${surfaces.length}`);

  // Connect WS
  const ws = new WebSocket(VPS_WS);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  console.log('Connected to VPS');

  // Close each stale surface
  let closed = 0;
  for (const s of surfaces) {
    ws.send(env('surface.close', { surfaceId: s.surfaceId }));
    closed++;
    if (closed % 50 === 0) {
      console.log(`Sent close for ${closed} surfaces...`);
      await new Promise(r => setTimeout(r, 100));
    }
  }

  console.log(`Sent close for all ${closed} surfaces`);

  // Wait for processing
  await new Promise(r => setTimeout(r, 2000));
  ws.close();
  console.log('Done');
}

main().catch(console.error);
