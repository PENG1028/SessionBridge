// Diagnostic: query tabs and surfaces for each node
import WebSocket from 'ws';

function connectAndQuery(url, nodeIds) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const results = {};

    ws.on('open', () => {
      ws.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'hello', body: { role: 'browser' } }));
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const type = msg.type || '';

      if (type === 'workbench.tabs') {
        const nid = msg.nodeId || msg.body?.nodeId || '?';
        results['tabs:' + nid] = msg.tabs || msg.body?.tabs || [];
      }
      if (type === 'surface.list') {
        const nid = msg.nodeId || msg.body?.nodeId || '?';
        results['surfaces:' + nid] = msg.surfaces || msg.body?.surfaces || [];
      }
      if (type === 'error') {
        results['error'] = msg.code || msg.body?.code || JSON.stringify(msg);
      }

      if (type === 'welcome' || type === 'peer.list') {
        if (type === 'peer.list') {
          const peers = msg.body?.peers || msg.peers || [];
          setTimeout(() => {
            const ids = [...new Set([...peers.map(p => p.id), ...nodeIds])];
            console.log(`  Querying ${ids.length} nodes: ${ids.join(', ')}`);
            for (const nid of ids) {
              // nodeId must be inside body (parseMsg only merges body)
              ws.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'workbench.subscribe', body: { nodeId: nid } }));
              ws.send(JSON.stringify({ v: 1, ts: Date.now(), type: 'surface.subscribeNode', body: { nodeId: nid } }));
            }
            setTimeout(() => { ws.close(); resolve(results); }, 2000);
          }, 500);
        }
      }
    });

    ws.on('error', reject);
    setTimeout(() => { ws.close(); resolve(results); }, 10000);
  });
}

async function main() {
  console.log('=== LOCAL RELAY (9000) tabs & surfaces ===');
  const local = await connectAndQuery('ws://127.0.0.1:9000', ['__local__']);
  for (const [k, v] of Object.entries(local)) {
    console.log(`  ${k}: ${JSON.stringify(v).slice(0, 600)}`);
  }

  console.log('\n=== VPS RELAY (8080) tabs & surfaces ===');
  const vps = await connectAndQuery('ws://43.160.241.180:8080', [
    '__local__', 'inst_5_mp7s9g38'
  ]);
  for (const [k, v] of Object.entries(vps)) {
    console.log(`  ${k}: ${JSON.stringify(v).slice(0, 600)}`);
  }
}

main().catch(console.error);
