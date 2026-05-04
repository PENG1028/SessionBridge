#!/usr/bin/env node

/**
 * session-bridge — CLI entry point.
 *
 * Commands:
 *   session-bridge [relay]    Start relay server (default)
 *   session-bridge agent ...  Start agent mode (connects to relay)
 *
 * Options:
 *   --port <num>      Relay server port (default: 8080)
 *   --directory <dir> Working directory for Claude (relay mode)
 *
 * Agent options:
 *   --relay <url>     Relay WebSocket URL (required for agent mode)
 *   --dir    <path>   Working directory for local Claude
 *   --label  <name>   Instance label shown in UI
 *   --log-file <path> Write agent log to file
 *   --pid-file <path> Write PID file
 */

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
  session-bridge — Claude Code remote shell

  Usage:
    session-bridge [relay]          Start relay server
    session-bridge agent --relay <url> --dir <path>   Start agent

  Relay options:
    --port <num>        Server port (default: 8080)
    --directory <dir>   Set Claude working directory

  Agent options:
    --relay <url>       Relay server WebSocket URL (required)
    --dir <path>        Working directory for Claude (default: cwd)
    --label <name>      Instance label shown in UI
    --log-file <path>   Write log output to file
    --pid-file <path>   Write PID to file (for service management)
`);
    return;
  }

  // ─── Agent mode ───────────────────────────────────────────────
  if (args[0] === "agent") {
    const { startAgent } = await import("../adapters/claude-code/agent");

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
    return;
  }

  // ─── Relay mode (default) ─────────────────────────────────────
  const portIdx = args.indexOf("--port");
  if (portIdx >= 0) {
    const p = parseInt(args[portIdx + 1], 10);
    if (!isNaN(p)) process.env.PORT = String(p);
  }

  const { startRelayServer } = await import("./relay-server");

  const dirIdx = args.indexOf("--directory");
  if (dirIdx >= 0) {
    const dir = args[dirIdx + 1];
    if (dir) process.chdir(dir);
  }

  void startRelayServer();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
