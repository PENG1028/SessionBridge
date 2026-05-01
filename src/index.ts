#!/usr/bin/env node

/**
 * session-bridge — CLI entry point.
 *
 * Starts the combined relay server with built-in persistent Claude process.
 * No separate agent process needed — the relay manages Claude directly.
 *
 * Commands:
 *   (no args)         Start relay server (with integrated Claude management)
 *   server            Same as no args (backwards compat)
 *   --directory <dir> Working directory (passed to Claude as cwd)
 *   --port     <num>  Server port (default: 8080)
 *   --help            Show help
 *
 * Environment:
 *   PORT  Server port (default: 8080)
 */

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
  session-bridge — Claude Code remote shell

  Usage:
    session-bridge [server]   Start relay server with integrated Claude
    session-bridge --port 3001  Start on custom port

  Options:
    --directory <dir>  Set Claude working directory
    --port     <num>   Server port (default: 8080)

  The relay server:
    • Spawns Claude as a persistent process (--input-format stream-json)
    • Serves Web UI and WebSocket on the same port
    • No cold starts — Claude is always ready
`);
    return;
  }

  // Parse --port
  const portIdx = args.indexOf("--port");
  if (portIdx >= 0) {
    const p = parseInt(args[portIdx + 1], 10);
    if (!isNaN(p)) process.env.PORT = String(p);
  }

  const { startRelayServer } = await import("./relay-server");

  // Parse --directory (changes cwd before spawning Claude)
  const dirIdx = args.indexOf("--directory");
  if (dirIdx >= 0) {
    const dir = args[dirIdx + 1];
    if (dir) process.chdir(dir);
  }

  startRelayServer();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
