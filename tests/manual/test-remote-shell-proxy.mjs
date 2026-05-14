// ─── Remote shell proxy test ──────────────────────────
// Validates that shell.spawn on a remote agent instance actually
// spawns the shell on the AGENT machine, not on the relay.
//
// Setup:
//   Browser WS connects to relay (43.160.241.180:8080)
//   Finds PENGPC agent instance from peer list
//   Sends shell.spawn with that instance ID
//   Checks shell.output — should show WINDOWS prompt (PS C:\...)
//   NOT Ubuntu prompt (ubuntu@...)
//
// Expected failure modes:
//   FAIL if shell prompt contains "ubuntu" (spawned on VPS relay)
//   FAIL if no shell.output within timeout (agent not connected)
//   FAIL if PENGPC not found in peer list (agent not registered)

import WebSocket from 'ws';

const delay = ms => new Promise(r => setTimeout(r, ms));
const env = (t, b = {}) => JSON.stringify({ v: 1, ts: Date.now(), type: t, body: b });

const RELAY = 'ws://43.160.241.180:8080';
const TARGET_LABEL = 'PENGSPC'; // or 'PENGPC' — adjust if different

let passed = 0, failed = 0;
function check(desc, ok) {
  if (ok) passed++; else failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}: ${desc}`);
}

async function waitFor(inbox, predicate, label, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (let i = 0; i < inbox.length; i++) {
      try {
        const m = JSON.parse(inbox[i]);
        const msg = m.v === 1 && m.body ? { ...m.body, type: m.type } : m;
        if (predicate(msg)) { inbox.splice(i, 1); return msg; }
      } catch {}
    }
    await delay(50);
  }
  const remaining = inbox.map(s => { try { return JSON.parse(s).type; } catch { return '??'; } }).join(', ');
  throw new Error(`[${label}] Timeout (inbox: [${remaining}])`);
}

async function main() {
  console.log(`\n===== Remote Shell Proxy Test =====`);
  console.log(`  Relay: ${RELAY}`);
  console.log(`  Target label: ${TARGET_LABEL}\n`);

  // 1. Connect to relay as browser
  const ws = new WebSocket(RELAY);
  const buf = [];
  ws.on('message', d => buf.push(d.toString()));
  await new Promise(r => ws.on('open', r));
  console.log('  [OK] Connected\n');

  // 2. Auth
  ws.send(env('hello', {
    role: 'browser', version: '0.6.0', features: [],
    cols: 120, rows: 40, workspace: true,
    clientToken: `test_remote_shell_${Date.now()}`,
  }));

  // 3. Wait for welcome + peer list
  const welcome = await waitFor(buf, m => m.type === 'welcome', 'welcome', 5000);
  check('Welcome received', !!welcome);
  console.log(`  Session: ${welcome.sessionId?.slice(0, 16)}...`);

  const peerList = await waitFor(buf, m => m.type === 'peer.list', 'peer.list', 5000);
  const peers = peerList.peers || [];
  console.log(`  Peers: ${peers.length} total`);
  for (const p of peers) {
    console.log(`    ${p.type} '${p.name}' id=${(p.id || '').slice(0, 16)}...`);
  }

  // 4. Find the target agent (PENGPC)
  const target = peers.find(p => p.type === 'agent' && p.name === TARGET_LABEL);
  if (!target) {
    // Try partial match
    const agents = peers.filter(p => p.type === 'agent');
    console.log(`\n  [WARN] No exact match for "${TARGET_LABEL}", trying partial match...`);
    const partial = agents.find(p => p.name.toLowerCase().includes('peng'));
    if (partial) {
      console.log(`  [WARN] Using partial match: "${partial.name}" id=${partial.id}`);
      Object.assign(target, partial);
    } else {
      console.log(`  [WARN] Available agents: ${agents.map(a => `"${a.name}"`).join(', ')}`);
      check('Target agent found in peer list', false);
      throw new Error('Target agent not found — is PENGPC connected?');
    }
  }

  const targetId = target.id;
  const targetName = target.name;
  console.log(`\n  Target: "${targetName}" id=${targetId.slice(0, 16)}...`);

  // 5. Subscribe to the node (simulates what browser does on enter)
  ws.send(env('workbench.subscribe', { nodeId: targetId }));

  // 6. Send shell.spawn with the remote instance ID
  console.log(`\n  Spawning shell on remote instance: ${targetId.slice(0, 16)}...`);
  ws.send(env('shell.spawn', { instanceId: targetId }));

  // 7. Collect shell.output — should come from agent (WINDOWS) not VPS
  const shellData = [];
  const shellTimeout = 15000;
  const startCollect = Date.now();

  // Wait a bit for output to accumulate
  await delay(2000);

  // Collect output (skip control sequences for analysis)
  while (Date.now() - startCollect < shellTimeout) {
    // Check for new messages
    let found = false;
    for (let i = 0; i < buf.length; i++) {
      try {
        const m = JSON.parse(buf[i]);
        const msg = m.v === 1 && m.body ? { ...m.body, type: m.type, _raw: m.body } : m;
        if (msg.type === 'shell.output') {
          const data = (typeof msg.data === 'string' ? msg.data : '');
          shellData.push(data);
          buf.splice(i, 1);
          i--;
          found = true;
        }
      } catch {}
    }

    // Check if we have enough output to analyze
    const fullOutput = shellData.join('');
    // Strip ANSI escape sequences for analysis
    const clean = fullOutput.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
                            .replace(/\x1b\][0-9;]*[^\x07]*\x07/g, '')
                            .replace(/\r?\n/g, '\n');
    if (clean.includes('$') || clean.includes('>') || clean.includes('#')) {
      break; // Got a prompt
    }
    if (clean.length > 200) break; // Enough content

    if (!found) await delay(500);
  }

  // 8. Analyze output
  const rawOutput = shellData.join('');
  const cleanOutput = rawOutput.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
                               .replace(/\x1b\][0-9;]*[^\x07]*\x07/g, '')
                               .replace(/\r?\n/g, '\n');

  console.log(`\n  Collected ${shellData.length} shell.output message(s)`);
  console.log(`  Raw output length: ${rawOutput.length} chars`);
  console.log(`  Clean output:\n${'-'.repeat(40)}\n${cleanOutput.slice(0, 500)}\n${'-'.repeat(40)}`);

  const lower = cleanOutput.toLowerCase();

  // Pass/fail checks
  check('Shell output received', shellData.length > 0);
  check('NOT running on Ubuntu/VPS relay', !lower.includes('ubuntu'));
  check('Shell prompt shows Windows PowerShell', lower.includes('ps ') || lower.includes('c:\\') || lower.includes('d:\\'));

  // One optional check: if we see Windows-style path, that confirms it's on PENGPC
  if (lower.includes('c:\\') || lower.includes('d:\\') || lower.includes('ps ') || lower.includes('windows')) {
    check('Shell is on Windows (PENGPC) ✓', true);
  } else {
    console.log('  [INFO] No explicit Windows indicator in first output — shell may still be starting');
  }

  // Cleanup
  ws.close();
  await delay(300);

  console.log(`\n===== RESULTS: ${passed} passed, ${failed} failed =====`);
  if (failed === 0) console.log('  ✅ ALL REMOTE SHELL PROXY TESTS PASSED\n');
  else console.log(`  ❌ ${failed} test(s) failed — shell is likely running on VPS relay\n`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
