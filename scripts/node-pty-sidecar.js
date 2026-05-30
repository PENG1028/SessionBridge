#!/usr/bin/env node

const readline = require('readline');

let pty;
try {
  pty = require('node-pty');
} catch (err) {
  send({ type: 'error', message: `load node-pty: ${err.message}` });
  process.exit(1);
}

let term = null;
let spawned = false;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function fail(message) {
  send({ type: 'error', message });
}

function spawnTerm(req) {
  if (spawned) {
    fail('sidecar already has a PTY');
    return;
  }
  spawned = true;

  const command = String(req.command || '');
  if (!command) {
    fail('missing command');
    return;
  }

  const args = Array.isArray(req.args) ? req.args.map(String) : [];
  const cwd = req.cwd ? String(req.cwd) : process.cwd();
  const cols = Number.isFinite(req.cols) && req.cols > 0 ? req.cols : 80;
  const rows = Number.isFinite(req.rows) && req.rows > 0 ? req.rows : 24;

  try {
    term = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: process.env,
      useConpty: true,
      useConptyDll: true,
    });
  } catch (err) {
    fail(`spawn: ${err.message}`);
    return;
  }

  term.onData((data) => send({ type: 'stdout', data }));
  term.onExit((event) => {
    const exitCode = typeof event.exitCode === 'number' ? event.exitCode : 0;
    send({ type: 'exit', exitCode });
    // Delay exit so Go receives the exit event before the pipe closes.
    // process.exit() on Windows kills the process immediately; a short
    // timeout gives the OS pipe buffer time to deliver the last write.
    setTimeout(() => process.exit(0), 200);
  });

  send({ type: 'started', pid: term.pid });
}

function handle(req) {
  switch (req.type) {
    case 'spawn':
      spawnTerm(req);
      return;
    case 'write':
      if (term) term.write(String(req.data || ''));
      return;
    case 'resize':
      if (term) term.resize(req.cols || 80, req.rows || 24);
      return;
    case 'kill':
      if (term) {
        term.kill();
      }
      process.exit(0);
      return;
    default:
      fail(`unknown message type: ${req.type}`);
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    handle(JSON.parse(line));
  } catch (err) {
    fail(`bad request: ${err.message}`);
  }
});

process.on('SIGTERM', () => {
  if (term) term.kill();
  process.exit(0);
});

process.on('SIGINT', () => {
  if (term) term.kill();
  process.exit(0);
});
