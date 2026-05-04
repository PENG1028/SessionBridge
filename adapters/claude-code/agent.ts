// ─── Remote Agent (受控端) ──────────────────────────────────────
// Lightweight bridge that connects a home-PC Claude process to a
// SessionBridge relay server via outbound WebSocket.
//
// Usage: node dist/agent.js --relay ws://vps:8080 --dir /home/user/project

import { spawn } from "child_process";
import { resolve } from "path";
import { createWriteStream, writeFileSync, unlinkSync, existsSync } from "fs";
import WebSocket from "ws";
import { envelope, parseMsg } from "../../src/protocol";

// ─── Options ────────────────────────────────────────────────────
export interface AgentOptions {
  relay: string;
  dir: string;
  label?: string;
  logFile?: string;
  pidFile?: string;
}

export function startAgent(opts: AgentOptions) {
  const RELAY_URL = opts.relay;
  const WORK_DIR = resolve(opts.dir);
  const LABEL = opts.label ?? `agent-${Date.now().toString(36)}`;
  const LOG_FILE = opts.logFile ?? "";
  const PID_FILE = opts.pidFile ?? "";

  // ─── Logging ──────────────────────────────────────────────────
  const logStream = LOG_FILE ? createWriteStream(LOG_FILE, { flags: "a" }) : null;
  function log(msg: string) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(msg);
    if (logStream) logStream.write(line + "\n");
  }

  // ─── PID file ────────────────────────────────────────────────
  if (PID_FILE) {
    writeFileSync(PID_FILE, String(process.pid), "utf8");
    log(`  PID ${process.pid} written to ${PID_FILE}`);
  }

  // ─── State ────────────────────────────────────────────────────
  let instanceId: string | null = null;
  let claude: ReturnType<typeof spawn> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = 1000;
  let closing = false;

  function startClaude() {
    if (claude) {
      claude.kill();
      claude = null;
    }

    const cmd = process.platform === "win32" ? "cmd.exe" : "claude";
    const args = process.platform === "win32"
      ? ["/c", "claude", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose", "--include-partial-messages", "--dangerously-skip-permissions"]
      : ["--output-format", "stream-json", "--input-format", "stream-json", "--verbose", "--include-partial-messages", "--dangerously-skip-permissions"];

    claude = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: WORK_DIR,
    });

    // stdout → agent.stdout (line by line)
    const rl = require("readline").createInterface({ input: claude.stdout });
    rl.on("line", (line: string) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(envelope("agent.stdout", { instanceId, line })));
      }
    });

    // stderr → agent.stderr
    claude.stderr?.on("data", (chunk: Buffer) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(envelope("agent.stderr", { instanceId, data: chunk.toString() })));
      }
    });

    claude.on("exit", (code) => {
      log(`  Claude exited (${code})`);
      claude = null;
      if (!closing) scheduleReconnect();
    });

    claude.on("error", (err) => {
      log(`  Claude error: ${err.message}`);
      claude = null;
      if (!closing) scheduleReconnect();
    });
  }

  let ws: WebSocket | null = null;

  function connect() {
    if (closing) return;
    log(`  Connecting to relay: ${RELAY_URL} ...`);

    ws = new WebSocket(RELAY_URL);

    ws.on("open", () => {
      log("  Connected. Sending hello...");
      reconnectDelay = 1000;
      // Capability negotiation
      ws!.send(JSON.stringify(envelope("hello", {
        role: "agent",
        version: "0.5.0",
        features: ["agent_register"],
      })));
    });

    ws.on("message", (raw) => {
      const msg = parseMsg(raw.toString());
      if (!msg) return;

      switch (msg.type) {
        // ── Lifecycle ────────────────────────────────────────
        case "welcome":
          log(`  Relay welcomes us: ${JSON.stringify(msg)}`);
          // Now register
          ws!.send(JSON.stringify(envelope("agent.register", {
            dir: WORK_DIR,
            label: LABEL,
          })));
          break;

        case "agent.registered":
          instanceId = msg.instanceId;
          log(`  Registered as instance: ${instanceId}`);
          startClaude();
          break;

        case "ping":
          ws!.send(JSON.stringify(envelope("pong", {})));
          break;

        // ── Data forwarding ──────────────────────────────────
        case "agent.stdin":
          if (claude?.stdin?.writable) {
            claude.stdin.write(msg.data);
          }
          break;

        case "agent.control":
          if (claude?.stdin?.writable) {
            claude.stdin.write(JSON.stringify({
              type: "control_request",
              request_id: msg.request_id,
              request: msg.request,
            }) + "\n");
          }
          break;

        // ── Error ────────────────────────────────────────────
        case "error":
          log(`  Relay error: [${msg.code}] ${msg.message}`);
          break;
      }
    });

    ws.on("close", () => {
      log("  Relay connection closed.");
      ws = null;
      if (claude) {
        claude.kill();
        claude = null;
      }
      if (!closing) scheduleReconnect();
    });

    ws.on("error", () => {
      // close will fire after this
    });
  }

  function scheduleReconnect() {
    if (closing || reconnectTimer) return;
    log(`  Reconnecting in ${reconnectDelay}ms ...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      connect();
    }, reconnectDelay);
  }

  function shutdown() {
    if (closing) return;
    closing = true;
    log("  Shutting down...");
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (claude) { claude.kill(); claude = null; }
    if (ws) {
      ws.send(JSON.stringify(envelope("bye", { reason: "shutdown" })));
      ws.close();
      ws = null;
    }
    if (PID_FILE && existsSync(PID_FILE)) {
      try { unlinkSync(PID_FILE); } catch {}
    }
    if (logStream) logStream.end();
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  log(`\n  ┌──────────────────────────────────────┐`);
  log(`  │  SessionBridge Remote Agent          │`);
  log(`  │                                      │`);
  log(`  │  Relay:  ${RELAY_URL.padEnd(33)}│`);
  log(`  │  Dir:    ${WORK_DIR.padEnd(33)}│`);
  log(`  │  Label:  ${LABEL.padEnd(33)}│`);
  if (LOG_FILE) log(`  │  Log:    ${LOG_FILE.padEnd(33)}│`);
  if (PID_FILE) log(`  │  PID:    ${String(process.pid).padEnd(33)}│`);
  log(`  └──────────────────────────────────────┘\n`);

  connect();

  return { shutdown };
}

// ─── CLI entry point ────────────────────────────────────────────
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
  SessionBridge Remote Agent

  Usage:
    node dist/agent.js --relay <url> --dir <path> [options]

  Options:
    --relay <url>       Relay server WebSocket URL (required)
    --dir <path>        Working directory for Claude (default: cwd)
    --label <name>      Instance label shown in UI (default: auto-generated)
    --log-file <path>   Write log output to file (default: stdout only)
    --pid-file <path>   Write PID to file (for service management)
    --help              Show this help
`);
    process.exit(0);
  }

  function arg(name: string, fallback: string): string {
    const idx = args.indexOf(`--${name}`);
    if (idx >= 0 && args[idx + 1]) return args[idx + 1];
    const eq = args.find(a => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(`--${name}=`.length);
    return fallback;
  }

  startAgent({
    relay: arg("relay", "ws://localhost:8080"),
    dir: arg("dir", process.cwd()),
    label: arg("label", ""),
    logFile: arg("log-file", ""),
    pidFile: arg("pid-file", ""),
  });
}
