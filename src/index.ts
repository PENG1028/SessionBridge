#!/usr/bin/env node

/**
 * session-bridge — CLI entry point.
 *
 * Commands:
 *   session-bridge [relay]       Start relay server (default)
 *   session-bridge agent ...     Start agent mode (connects to relay)
 *   session-bridge agent --update  Self-update agent
 *
 * Relay options:
 *   --port <num>      Server port (default: 8080)
 *   --directory <dir> Working directory
 *
 * Agent options:
 *   --relay <url>        Relay WebSocket URL
 *   --dir    <path>      Working directory (default: cwd)
 *   --label  <name>      Instance label shown in UI
 *   --dashboard-port <n> Dashboard HTTP port (default: 9843)
 *   --config <path>      Config file path
 *   --log-file <path>    Write agent log to file
 *   --pid-file <path>    Write PID file
 *   --update             Self-update (git pull + npm install)
 */

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
  session-bridge — Remote Agent Console

  Usage:
    session-bridge                      Start relay server
    session-bridge agent --relay <url>  Start agent
    session-bridge run <command...>     Run command via agent
    session-bridge setup ...            Configure agent settings

  Relay options:
    --port <num>        Server port (default: 8080)
    --directory <dir>   Set working directory

  Agent options:
    --relay <url>        Relay server WebSocket URL
    --dir <path>         Working directory (default: cwd)
    --label <name>       Instance label shown in UI
    --dashboard-port <n> Dashboard HTTP port (default: 9843)
    --config <path>      Config file path
    --log-file <path>    Write log output to file
    --pid-file <path>    Write PID to file
    --update             Self-update (git pull + npm install)

  Setup options:
    --relay <url>        Set default relay URL
    --ntfy-topic <topic> Set ntfy.sh topic for push notifications
    --label <name>       Set default agent label

  Run options:
    --port <n>           Agent dashboard port (default: 9843)
    --relay <url>         Relay URL (auto-starts agent if not running)
    --dir <path>          Working directory
    --label <name>        Instance label
`);
    return;
  }

  async function selfUpdate() {
    const { execSync } = await import("child_process");
    console.log("[update] Running git pull...");
    execSync("git pull", { stdio: "inherit", cwd: process.cwd() });
    console.log("[update] Running npm install...");
    execSync("npm install --production", { stdio: "inherit", cwd: process.cwd() });
    console.log("[update] Done. Restart agent to apply.");
  }

  // ─── Setup mode ──────────────────────────────────────────────
  if (args[0] === "setup") {
    const { writeFileSync, mkdirSync, existsSync, readFileSync } = await import("fs");
    const { join } = await import("path");
    const { homedir } = await import("os");

    function sarg(name: string): string | undefined {
      const idx = args.indexOf(`--${name}`);
      if (idx >= 0 && args[idx + 1]) return args[idx + 1];
      const eq = args.find(a => a.startsWith(`--${name}=`));
      if (eq) return eq.slice(`--${name}=`.length);
      return undefined;
    }

    const base = process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'session-bridge')
      : join(homedir(), '.sessionbridge');
    const configPath = process.env.SB_CONFIG || join(base, 'agent.json');

    let existing: Record<string, unknown> = {};
    try {
      if (existsSync(configPath)) {
        existing = JSON.parse(readFileSync(configPath, 'utf8'));
      }
    } catch { /* ignore malformed */ }

    const relayUrl = sarg('relay');
    const ntfyTopic = sarg('ntfy-topic');
    const label = sarg('label');

    if (!relayUrl && !ntfyTopic && !label) {
      // Show current config
      console.log(`Config file: ${configPath}`);
      if (Object.keys(existing).length === 0) {
        console.log('(no config set — using defaults)');
      } else {
        for (const [k, v] of Object.entries(existing)) {
          console.log(`  ${k}: ${JSON.stringify(v)}`);
        }
      }
      console.log('\nUsage: session-bridge setup --relay <url> [--ntfy-topic <topic>] [--label <name>]');
      return;
    }

    if (relayUrl) existing.relayUrl = relayUrl;
    if (ntfyTopic) existing.ntfyTopic = ntfyTopic;
    if (label) existing.label = label;

    mkdirSync(base, { recursive: true });
    writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf8');
    console.log(`Config saved to: ${configPath}`);
    for (const [k, v] of Object.entries(existing)) {
      console.log(`  ${k}: ${JSON.stringify(v)}`);
    }
    return;
  }

  // ─── Agent mode ───────────────────────────────────────────────
  if (args[0] === "agent") {
    const { AgentRuntime } = await import("../adapters/agent-core/agent");

    function arg(name: string, fallback: string): string {
      const idx = args.indexOf(`--${name}`);
      if (idx >= 0 && args[idx + 1]) return args[idx + 1];
      const eq = args.find(a => a.startsWith(`--${name}=`));
      if (eq) return eq.slice(`--${name}=`.length);
      return fallback;
    }

    // Self-update command
    if (args.includes("--update")) {
      await selfUpdate();
      return;
    }

    const rt = new AgentRuntime({
      relayUrl: arg("relay", "ws://localhost:8080"),
      workingDirectory: arg("dir", process.cwd()),
      label: arg("label", ""),
      dashboardPort: parseInt(arg("dashboard-port", "9843"), 10),
      logFile: arg("log-file", ""),
      pidFile: arg("pid-file", ""),
    });

    // Write PID file if requested
    if (rt.config.pidFile) {
      const { writeFileSync } = await import("fs");
      writeFileSync(rt.config.pidFile, String(process.pid), "utf8");
    }

    await rt.start();

    // Graceful shutdown
    const shutdown = async () => {
      await rt.shutdown();
      if (rt.config.pidFile) {
        try { (await import("fs")).unlinkSync(rt.config.pidFile); } catch {}
      }
      process.exit(0);
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    return;
  }

  // ─── Run mode (spawn command via agent) ──────────────────────
  if (args[0] === "run") {
    const { runCommand } = await import("./run-command");
    function runArg(name: string, fallback: string): string {
      const idx = args.indexOf(`--${name}`);
      if (idx >= 0 && args[idx + 1]) return args[idx + 1];
      const eq = args.find(a => a.startsWith(`--${name}=`));
      if (eq) return eq.slice(`--${name}=`.length);
      return fallback;
    }
    // Command is everything after "run" that's not a known flag
    const flagNames = ['port', 'relay', 'dir', 'label', 'dashboard-port'];
    let cmdStart = 1;
    while (cmdStart < args.length) {
      const a = args[cmdStart];
      if (a.startsWith('--')) {
        const name = a.replace(/^--/, '').split('=')[0];
        if (flagNames.includes(name)) { cmdStart += a.includes('=') ? 1 : 2; continue; }
      }
      break;
    }
    const command = args.slice(cmdStart).join(' ');
    if (!command) {
      console.error('Usage: session-bridge run <command...>');
      console.error('Example: session-bridge run claude "write a function"');
      process.exit(1);
    }
    const exitCode = await runCommand({
      dashPort: parseInt(runArg('port', runArg('dashboard-port', '9843')), 10),
      relayUrl: runArg('relay', '') || undefined,
      dir: runArg('dir', '') || undefined,
      label: runArg('label', '') || undefined,
      command,
    });
    process.exit(exitCode);
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
