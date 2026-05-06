#!/usr/bin/env node

/**
 * bridge — SessionBridge node entry point.
 *
 * Every installation is a node. It auto-detects its role, starts
 * the dashboard, runs a relay server if capable, and connects to
 * an upstream relay if configured.
 *
 * Commands:
 *   bridge                    Start node (default)
 *   bridge run <command...>   Run command via local node
 *   bridge setup ...          Configure node settings
 *
 * Options:
 *   --upstream <url>    External relay URL (agent mode)
 *   --relay-port <n>    Relay port (default: 8080)
 *   --role <relay|leaf> Force role instead of auto-detect
 *   --dir <path>        Working directory
 *   --label <name>      Node label (default: hostname)
 *   --dashboard-port <n> Dashboard HTTP port (default: 9843)
 *   --config <path>     Config file path
 *   --log-file <path>   Write log to file
 *   --pid-file <path>   Write PID file
 */

async function main() {
  const args = process.argv.slice(2);

  function arg(name: string, fallback: string): string {
    const idx = args.indexOf(`--${name}`);
    if (idx >= 0 && args[idx + 1]) return args[idx + 1];
    const eq = args.find(a => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(`--${name}=`.length);
    return fallback;
  }

  function hasFlag(name: string): boolean {
    return args.includes(`--${name}`);
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
  bridge — SessionBridge Node

  Usage:
    bridge                         Start node (auto-detect role)
    bridge run <command...>        Run command via local node
    bridge setup ...               Configure node settings

  Node options:
    --upstream <url>       Connect to an external relay
    --relay-port <n>       Relay server port (default: 8080)
    --relay-token <token>  Relay server auth token
    --role <relay|leaf>    Force node role (default: auto-detect)
    --dir <path>           Working directory (default: cwd)
    --label <name>         Node label (default: hostname)
    --dashboard-port <n>   Dashboard HTTP port (default: 9843)
    --config <path>        Config file path
    --log-file <path>      Write log to file
    --pid-file <path>      Write PID file

  Setup options:
    --relay <url>          Set default relay URL
    --relay-token <token>  Set relay authentication token
    --ntfy-topic <topic>   Set ntfy.sh topic for push notifications
    --label <name>         Set default node label

  Run options:
    --port <n>             Dashboard port (default: 9843)
    --relay <url>           Relay URL (auto-starts node if not running)
    --dir <path>            Working directory
    --label <name>          Node label
`);
    return;
  }

  // ─── Self-update ─────────────────────────────────────────────
  async function selfUpdate() {
    const { execSync, spawn } = await import("child_process");
    const { existsSync } = await import("fs");
    const { resolve } = await import("path");

    const projectDir = resolve(__dirname, '..');
    const gitDir = resolve(projectDir, '.git');

    if (!existsSync(gitDir)) {
      console.error('[update] Not a git repository. Self-update requires a git clone.');
      console.error(`[update] Expected .git at: ${gitDir}`);
      process.exit(1);
    }

    console.log('[update] Pulling latest changes...');
    try {
      execSync('git pull', { stdio: 'inherit', cwd: projectDir });
    } catch {
      console.error('[update] git pull failed. Check your network and git status.');
      process.exit(1);
    }

    console.log('[update] Installing dependencies...');
    try {
      execSync('npm install --omit=dev', { stdio: 'inherit', cwd: projectDir });
    } catch {
      console.error('[update] npm install failed.');
      process.exit(1);
    }

    console.log('[update] Restarting...');
    const filteredArgs = process.argv.slice(1).filter(a => a !== '--update');
    const child = spawn(process.execPath, filteredArgs, {
      cwd: process.cwd(),
      stdio: 'inherit',
      detached: true,
    });
    child.unref();
    process.exit(0);
  }
  if (hasFlag("update")) {
    await selfUpdate();
    return;
  }

  // ─── Setup ───────────────────────────────────────────────────
  if (args[0] === "setup") {
    const { writeFileSync, mkdirSync, existsSync, readFileSync } = await import("fs");
    const { join } = await import("path");

    function sarg(name: string): string | undefined {
      const idx = args.indexOf(`--${name}`);
      if (idx >= 0 && args[idx + 1]) return args[idx + 1];
      const eq = args.find(a => a.startsWith(`--${name}=`));
      if (eq) return eq.slice(`--${name}=`.length);
      return undefined;
    }

    const { configDir } = await import("../adapters/agent-core/config");
    const configPath = process.env.BRIDGE_CONFIG || join(configDir(), 'agent.json');

    let existing: Record<string, unknown> = {};
    try {
      if (existsSync(configPath)) {
        existing = JSON.parse(readFileSync(configPath, 'utf8'));
      }
    } catch { /* ignore malformed */ }

    const relayUrl = sarg('relay');
    const relayToken = sarg('relay-token');
    const ntfyTopic = sarg('ntfy-topic');
    const label = sarg('label');

    if (!relayUrl && !relayToken && !ntfyTopic && !label) {
      console.log(`Config file: ${configPath}`);
      if (Object.keys(existing).length === 0) {
        console.log('(no config set — using defaults)');
      } else {
        for (const [k, v] of Object.entries(existing)) {
          console.log(`  ${k}: ${JSON.stringify(v)}`);
        }
      }
      console.log('\nUsage: bridge setup --relay <url> [--relay-token <token>] [--ntfy-topic <topic>] [--label <name>]');
      return;
    }

    if (relayUrl) existing.upstreamRelay = relayUrl;
    if (relayToken) existing.relayToken = relayToken;
    if (ntfyTopic) existing.ntfyTopic = ntfyTopic;
    if (label) existing.label = label;

    mkdirSync(join(configPath, '..'), { recursive: true });
    writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf8');
    console.log(`Config saved to: ${configPath}`);
    for (const [k, v] of Object.entries(existing)) {
      console.log(`  ${k}: ${JSON.stringify(v)}`);
    }
    return;
  }

  // ─── Run ─────────────────────────────────────────────────────
  if (args[0] === "run") {
    const { runCommand } = await import("./run-command");
    function runArg(name: string, fallback: string): string {
      const idx = args.indexOf(`--${name}`);
      if (idx >= 0 && args[idx + 1]) return args[idx + 1];
      const eq = args.find(a => a.startsWith(`--${name}=`));
      if (eq) return eq.slice(`--${name}=`.length);
      return fallback;
    }
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
      console.error('Usage: bridge run <command...>');
      console.error('Example: bridge run claude "write a function"');
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

  // ─── Node mode (default) ─────────────────────────────────────
  const { NodeRuntime } = await import("../adapters/agent-core/node-runtime");
  const { hostname } = await import("os");

  const roleStr = arg('role', 'auto');
  const role = (roleStr === 'relay' || roleStr === 'leaf') ? roleStr : 'auto';

  const node = new NodeRuntime({
    label: arg('label', hostname()),
    role: role as 'auto' | 'relay' | 'leaf',
    workingDirectory: arg('dir', process.cwd()),
    relayPort: parseInt(arg('relay-port', '8080'), 10),
    relayToken: arg('relay-token', '') || undefined,
    upstreamRelay: arg('upstream', '') || undefined,
    dashboardPort: parseInt(arg('dashboard-port', '9843'), 10),
    logFile: arg('log-file', ''),
    pidFile: arg('pid-file', ''),
  });

  // Write PID file if requested
  if (node.config.pidFile) {
    const { writeFileSync } = await import("fs");
    writeFileSync(node.config.pidFile, String(process.pid), "utf8");
  }

  await node.start();

  // Graceful shutdown
  const shutdown = async () => {
    await node.shutdown();
    if (node.config.pidFile) {
      try { (await import("fs")).unlinkSync(node.config.pidFile); } catch {}
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
