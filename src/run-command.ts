// ─── bridge run — Remote command execution via agent ──────────
// Usage: bridge run <command...>
//
// Sends the command to the local agent's dashboard API. The agent
// spawns it via the shell adapter, so the process survives terminal
// close and is visible on the relay.
//
// Ctrl+D → detach (process keeps running)
// Ctrl+C → kill process and exit

import { spawn } from 'child_process';
import { get, request } from 'http';

interface RunOptions {
  dashPort: number;
  relayUrl?: string;
  dir?: string;
  label?: string;
  command: string;
}

/** POST JSON to the agent dashboard and return parsed body. */
function apiPost(port: number, path: string, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request({
      hostname: '127.0.0.1', port, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let result = '';
      res.on('data', (c: Buffer) => { result += c.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(result)); } catch { reject(new Error(result)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

/** Check if the agent dashboard is alive. */
function agentAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = get(`http://127.0.0.1:${port}/api/status`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => { req.destroy(); resolve(false); });
  });
}

/** Get agent status (includes relayConnected). */
function agentStatus(port: number): Promise<{ relayConnected?: boolean; instanceId?: string | null }> {
  return new Promise((resolve) => {
    const req = get(`http://127.0.0.1:${port}/api/status`, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => { data += c.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({}); }
      });
    });
    req.on('error', () => resolve({}));
    req.setTimeout(2000, () => { req.destroy(); resolve({}); });
  });
}

/** Poll agent until alive or timeout. */
async function waitForAgent(port: number, timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await agentAlive(port)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/** Start agent in the background. */
function startAgentBg(opts: { relayUrl?: string; dir?: string; label?: string; dashPort: number }): void {
  const args = [
    process.argv[1] || 'dist/src/index.js',
    'agent',
    `--dashboard-port=${opts.dashPort}`,
  ];
  if (opts.relayUrl) args.push(`--relay=${opts.relayUrl}`);
  if (opts.dir) args.push(`--dir=${opts.dir}`);
  if (opts.label) args.push(`--label=${opts.label}`);
  else args.push(`--label=${require('os').hostname()}`);

  const proc = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
  });
  proc.unref();
}

export async function runCommand(opts: RunOptions): Promise<number> {
  const { dashPort } = opts;

  // 1. Ensure agent is running
  if (!(await agentAlive(dashPort))) {
    if (!opts.relayUrl) {
      process.stderr.write(`[bridge] No --relay specified and agent not running.\n`);
      process.stderr.write(`[bridge] Run 'session-bridge setup --relay <url>' first, or pass --relay.\n`);
    }
    process.stderr.write(`[bridge] Agent not running on port ${dashPort}, starting...\n`);
    startAgentBg(opts);
    process.stderr.write(`[bridge] Waiting for agent to come online...\n`);
    if (!(await waitForAgent(dashPort))) {
      process.stderr.write(`[bridge] Agent failed to start on port ${dashPort}\n`);
      process.stderr.write(`[bridge] Check: is Node.js installed? Try running 'session-bridge agent --relay <url>' manually.\n`);
      return 1;
    }
  }

  // Check relay connectivity
  const st = await agentStatus(dashPort);
  if (!st.relayConnected) {
    process.stderr.write(`[bridge] ⚠ Agent is not connected to a relay — process won't be visible on phone.\n`);
    if (!opts.relayUrl) {
      process.stderr.write(`[bridge] Run 'session-bridge setup --relay <url>' to configure the relay URL.\n`);
    }
  }

  // 2. Spawn the command via agent
  process.stderr.write(`[bridge] Spawning: ${opts.command.slice(0, 80)}\n`);
  const runResult = await apiPost(dashPort, '/api/shell/run', {
    command: opts.command,
    cwd: process.cwd(),
  }) as { instanceId: string; pid: number; error?: string };

  if (runResult.error) {
    process.stderr.write(`[bridge] Error: ${runResult.error}\n`);
    return 1;
  }

  const { instanceId, pid } = runResult;
  process.stderr.write(`[bridge] Instance: ${instanceId}  PID: ${pid}\n`);
  process.stderr.write(`[bridge] Streaming... (Ctrl+D detach, Ctrl+C kill)\n\n`);

  // 3. Open SSE stream for output
  return new Promise((resolve) => {
    const req = get(`http://127.0.0.1:${dashPort}/api/shell/stream?id=${instanceId}`, (res) => {
      let exitCode: number | null = null;

      res.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data:')) {
            try {
              const payload = JSON.parse(line.slice(5).trim());
              if (payload.type === 'exit') {
                exitCode = payload.code;
              } else if (payload.data) {
                process.stdout.write(payload.data);
              }
            } catch { /* skip malformed */ }
          }
        }
      });

      res.on('end', () => {
        // Cleanup
        if (process.stdin.isTTY && typeof (process.stdin as any).setRawMode === 'function') {
          try { (process.stdin as any).setRawMode(false); } catch {}
        }
        if (exitCode !== null) {
          process.stderr.write(`\n[bridge] Process exited with code ${exitCode}\n`);
          resolve(exitCode);
        } else {
          // Detached — process still running
          process.stderr.write(`\n[bridge] Detached. Instance: ${instanceId}\n`);
          resolve(0);
        }
      });

      res.on('error', () => {
        process.stderr.write(`\n[bridge] Stream disconnected. Instance: ${instanceId}\n`);
        resolve(0);
      });
    });

    req.on('error', (err) => {
      process.stderr.write(`[bridge] Failed to connect to stream: ${err.message}\n`);
      resolve(1);
    });

    // 4. Forward stdin
    if (process.stdin.isTTY && typeof (process.stdin as any).setRawMode === 'function') {
      try {
        (process.stdin as any).setRawMode(true);
        process.stdin.on('data', (chunk: Buffer) => {
          const bytes = Uint8Array.prototype.slice.call(chunk) as Uint8Array;
          // Ctrl+C (0x03) → kill
          if (bytes.length === 1 && bytes[0] === 3) {
            apiPost(dashPort, '/api/shell/kill', { instanceId }).catch(() => {});
            req.destroy();
            if (typeof (process.stdin as any).setRawMode === 'function') {
              try { (process.stdin as any).setRawMode(false); } catch {}
            }
            process.stderr.write('\n[bridge] Killed.\n');
            process.exit(1);
          }
          // Ctrl+D (0x04) → detach
          if (bytes.length === 1 && bytes[0] === 4) {
            req.destroy();
            if (typeof (process.stdin as any).setRawMode === 'function') {
              try { (process.stdin as any).setRawMode(false); } catch {}
            }
            process.stderr.write(`\n[bridge] Detached. Instance: ${instanceId}\n`);
            process.exit(0);
          }
          // Otherwise forward to process stdin
          apiPost(dashPort, '/api/shell/input', {
            instanceId,
            data: chunk.toString(),
          }).catch(() => {});
        });
      } catch {
        // Raw mode not supported — stdin forwarding disabled
        process.stderr.write('[bridge] Raw terminal mode not available, stdin not forwarded\n');
      }
    }
  });
}
