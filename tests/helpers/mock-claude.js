// ─── Test helper: mock Claude process (stream-json protocol) ──

// Simulates Claude CLI's JSON-stream output protocol.
// Usage: node mock-claude.js <port> [sessionId]

const WebSocket = require('ws');

const port = parseInt(process.argv[2], 10);
if (!port) {
  console.error('Usage: node mock-claude.js <port> [sessionId]');
  process.exit(1);
}

const sessionId = process.argv[3] || 'test-session';
const url = `ws://127.0.0.1:${port}/ws?sessionId=${sessionId}`;
const ws = new WebSocket(url);

function send(type, payload) {
  ws.send(JSON.stringify({ type, ...payload }));
}

ws.on('open', () => {
  // Respond to auth challenge
  send('auth_result', { success: true });

  // Send init notification
  send('notification', {
    title: 'Claude Code mock ready',
    body: `Session ${sessionId} started`,
  });

  // Send thinking block
  setTimeout(() => {
    send('block_start', {
      id: 'think-1',
      type: 'thinking',
      semantic: 'Thinking',
    });
    send('text_delta', {
      id: 'think-1',
      delta: 'Analyzing the request...',
    });
    send('block_end', { id: 'think-1' });
  }, 100);

  // Send a tool_use block
  setTimeout(() => {
    send('block_start', {
      id: 'tool-1',
      type: 'tool_use',
      semantic: 'Reading file',
      toolName: 'Read',
      detail: 'src/index.ts',
      args: '{"file_path":"src/index.ts"}',
    });
    send('block_end', { id: 'tool-1' });
  }, 200);

  // Send tool_result
  setTimeout(() => {
    send('block_start', {
      id: 'result-1',
      type: 'tool_result',
      semantic: 'File content',
      toolName: 'Read',
    });
    send('text_delta', {
      id: 'result-1',
      delta: '// file content here',
    });
    send('block_end', { id: 'result-1' });
  }, 300);

  // Send final assistant message
  setTimeout(() => {
    send('block_start', {
      id: 'text-1',
      type: 'text',
      semantic: 'Answer',
    });
    send('text_delta', {
      id: 'text-1',
      delta: 'Here is the result.',
    });
    send('block_end', { id: 'text-1' });
    send('message_complete', { role: 'assistant' });
  }, 400);

  // Close after all messages
  setTimeout(() => ws.close(), 500);
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
  process.exit(1);
});

ws.on('close', () => {
  process.exit(0);
});
