#!/usr/bin/env node
// E2E test: WebSocket → run.create → sidecar → shell → stdout back
const WebSocket = require('ws');

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:9090/ws';
const TIMEOUT = 15000;

let requestId = 0;
function rid() { return `e2e-${++requestId}`; }

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 5000);
  });
}

function send(ws, msg) {
  return new Promise((resolve, reject) => {
    const id = msg.requestId || rid();
    msg.requestId = id;
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${id}`)), TIMEOUT);
    function onMsg(raw) {
      try {
        const resp = JSON.parse(raw.toString());
        if (resp.requestId === id) {
          ws.removeListener('message', onMsg);
          clearTimeout(timer);
          resolve(resp);
        }
      } catch (e) {
        // ignore parse errors for non-JSON messages
      }
    }
    ws.on('message', onMsg);
    ws.send(JSON.stringify(msg));
  });
}

function waitForMessage(ws, match, timeout = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for: ${match}`)), timeout);
    function onMsg(raw) {
      try {
        const msg = JSON.parse(raw.toString());
        if (match(msg)) {
          ws.removeListener('message', onMsg);
          clearTimeout(timer);
          resolve(msg);
        }
      } catch (e) {
        // ignore
      }
    }
    ws.on('message', onMsg);
  });
}

async function main() {
  console.log(`Connecting to ${WS_URL}...`);
  const ws = await connect(WS_URL);
  console.log('Connected.');

  // Step 1: run.create with pty=true, cmd.exe
  console.log('\n1. Sending run.create (cmd.exe, pty=true)...');
  let createResp;
  try {
    createResp = await send(ws, {
      type: 'action',
      capability: 'run.create',
      pluginId: 'terminal',
      payload: {
        command: process.platform === 'win32' ? 'cmd.exe' : 'bash',
        pty: true,
        cols: 80,
        rows: 24,
        kind: 'terminal',
      },
    });
  } catch (err) {
    console.error('FAIL: run.create:', err.message);
    process.exit(1);
  }

  if (!createResp.ok) {
    console.error('FAIL: run.create returned error:', JSON.stringify(createResp.error));
    process.exit(1);
  }

  const payload = createResp.payload || {};
  const sessionId = payload.sessionId;
  const runId = payload.runId;
  console.log(`   runId=${runId} sessionId=${sessionId} ptyMode=${payload.ptyMode} state=${payload.state}`);
  if (!sessionId) {
    console.error('FAIL: no sessionId in response');
    process.exit(1);
  }

  // Step 2: stream.subscribe to get stdout
  console.log('\n2. Subscribing to stdout...');
  let subResp;
  try {
    subResp = await send(ws, {
      type: 'action',
      capability: 'stream.subscribe',
      pluginId: 'terminal',
      payload: { sessionId, streamType: 'stdout' },
    });
  } catch (err) {
    console.error('FAIL: stream.subscribe:', err.message);
    process.exit(1);
  }
  console.log(`   subscribed: ${subResp.ok}`);

  // Step 3: Wait for stdout data (shell prompt)
  console.log('\n3. Waiting for shell stdout...');
  try {
    const stdoutMsg = await waitForMessage(ws, (msg) => {
      return msg.type === 'stream.chunk' &&
        msg.sessionId === sessionId;
    }, 10000);
    const data = stdoutMsg.data || '';
    console.log(`   Got stdout (${data.length} bytes): ${JSON.stringify(data.slice(0, 120))}`);
  } catch (err) {
    console.error('FAIL: no stdout received:', err.message);
    process.exit(1);
  }

  // Step 4: Write to stdin and verify echo
  console.log('\n4. Writing "echo HELLO_E2E" to stdin...');
  try {
    await send(ws, {
      type: 'action',
      capability: 'stream.write',
      pluginId: 'terminal',
      payload: { sessionId, streamType: 'stdin', data: 'echo HELLO_E2E\r\n' },
    });
  } catch (err) {
    console.error('FAIL: stream.write:', err.message);
    process.exit(1);
  }

  // Step 5: Wait for echo output
  console.log('\n5. Waiting for echo output...');
  try {
    const echoMsg = await waitForMessage(ws, (msg) => {
      if (msg.type !== 'stream.chunk') return false;
      if (msg.sessionId !== sessionId) return false;
      return (msg.data || '').includes('HELLO_E2E');
    }, 10000);
    const data = echoMsg.data || '';
    console.log(`   Got echo output (${data.length} bytes): ${JSON.stringify(data.slice(0, 200))}`);
    console.log('\n✓ E2E test PASSED');
  } catch (err) {
    console.error('FAIL: echo output not received:', err.message);
    process.exit(1);
  }

  // Cleanup
  try {
    await send(ws, {
      type: 'action',
      capability: 'run.stop',
      pluginId: 'terminal',
      payload: { runId, signal: 'SIGTERM' },
    });
  } catch (e) {
    // ignore
  }
  ws.close();
}

main().catch((err) => {
  console.error('E2E test error:', err);
  process.exit(1);
});
