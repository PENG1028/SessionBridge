#!/usr/bin/env node

/**
 * bridge — SessionBridge node entry point.
 *
 * Every installation is a node. It auto-detects its role, starts
 * the dashboard, runs a relay server if capable, and connects to
 * an upstream relay if configured.
 *
 * Commands:
 *   bridge                    Start node in foreground
 *   bridge daemon start        Start as background daemon
 *   bridge daemon stop         Stop background daemon
 *   bridge daemon status       Check daemon status
 *   bridge daemon install      Register auto-start on boot
 *   bridge run <command...>    Run command via local node
 *   bridge setup ...           Configure node settings
 *
 * Options:
 *   --upstream <url>     External relay URL (agent mode)
 *   --relay-port <n>     Relay port (default: 8080)
 *   --role <relay|leaf>  Force role instead of auto-detect
 *   --dir <path>         Working directory
 *   --label <name>       Node label (default: hostname)
 *   --dashboard-port <n> @deprecated Dashboard now uses relay port (8080)
 *   --config <path>      Config file path
 *   --log-file <path>    Write log to file
 *   --pid-file <path>    Write PID file
 *   --dev                Development mode (extension host isolation, debugging, auto-reload)
 *   --extensions <path>  Additional extension directories (can be specified multiple times, or comma-separated)
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

  // ─── Help ──────────────────────────────────────────────────────
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
  bridge — SessionBridge Node

  Usage:
    bridge                         Start node (auto-detect role)
    bridge daemon start             Start as background daemon
    bridge daemon stop              Stop background daemon
    bridge daemon status            Check daemon status
    bridge daemon install           Register auto-start on boot
    bridge run <command...>        Run command via local node
    bridge setup ...               Configure node settings

  Node options:
    --upstream <url>       Connect to an external relay
    --relay-port <n>       Relay server port (default: 8080)
    --relay-token <token>  Relay server auth token
    --dashboard-token <t>  Dashboard access token (auto-generated if not set)
    --role <relay|leaf>    Force node role (default: auto-detect)
    --dir <path>           Working directory (default: cwd)
    --label <name>         Node label (default: hostname)
    --dashboard-port <n>   @deprecated Dashboard now uses relay port
    --config <path>        Config file path
    --log-file <path>      Write log to file
    --pid-file <path>      Write PID file
    --dev                  Development mode (extension host isolation, debugging, auto-reload)
    --extensions <path>    Additional extension directories (comma-separated or repeat flag)

  Setup options:
    --relay <url>          Set default relay URL
    --relay-token <token>  Set relay authentication token
    --dashboard-token <t>  Set dashboard access token
    --ntfy-topic <topic>   Set ntfy.sh topic for push notifications
    --label <name>         Set default node label
`);
    return;
  }

  // ─── Daemon Commands ───────────────────────────────────────────
  const daemonSubCmd = args[0] === 'daemon' ? args[1] : null;
  if (args[0] === 'daemon' && !daemonSubCmd) {
    console.error('Usage: bridge daemon <start|stop|status|install>');
    console.error('  start    Start background daemon');
    console.error('  stop     Stop background daemon');
    console.error('  status   Check daemon status');
    console.error('  install  Register auto-start on boot');
    process.exit(1);
  }

  if (args[0] === 'daemon' && daemonSubCmd) {
    const { startDaemon, stopDaemon, statusDaemon, installDaemon } = await import('./daemon');

    if (daemonSubCmd === 'start') {
      startDaemon({
        pidFile: arg('pid-file', ''),
        logFile: arg('log-file', ''),
        cwd: arg('dir', process.cwd()),
      });
      return;
    }

    if (daemonSubCmd === 'stop') {
      stopDaemon(arg('pid-file', ''));
      return;
    }

    if (daemonSubCmd === 'status') {
      const s = statusDaemon(arg('pid-file', ''));
      if (s.running) {
        console.log(`Daemon is running (pid ${s.pid}).`);
        if (s.startedAt) {
          const uptime = Math.round((Date.now() - s.startedAt) / 1000);
          const h = Math.floor(uptime / 3600);
          const m = Math.floor((uptime % 3600) / 60);
          const sec = uptime % 60;
          console.log(`  Uptime: ${h}h ${m}m ${sec}s`);
        }
        console.log(`  PID file: ${s.pidFile}`);
      } else {
        console.log('Daemon is not running.');
      }
      return;
    }

    if (daemonSubCmd === 'install') {
      const result = installDaemon(arg('pid-file', ''));
      if (result.success) {
        console.log(`\nAuto-start installed (${result.method}).`);
        console.log(`  Path: ${result.path}`);
        console.log(`\nThe daemon will start automatically on next boot.`);
        console.log(`  Start now:    bridge daemon start`);
        console.log(`  Check status: bridge daemon status`);
      } else {
        console.error(`Failed to install auto-start: ${result.error}`);
        process.exit(1);
      }
      return;
    }

    console.error(`Unknown daemon command: ${daemonSubCmd}`);
    process.exit(1);
  }

  // ─── Self-update ───────────────────────────────────────────────
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

    // Determine the GitHub remote
    const remotes = execSync('git remote -v', { cwd: projectDir, encoding: 'utf-8' });
    let remote = 'origin';
    for (const line of remotes.split('\n')) {
      const m = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
      if (m && m[1] === 'origin' && m[2].includes('github.com')) { remote = 'origin'; break; }
      if (m && m[2].includes('github.com')) { remote = m[1]; break; }
    }

    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectDir, encoding: 'utf-8' }).trim();

    console.log(`[update] Remote: ${remote}, Branch: ${branch}`);

    // Stash local changes
    try { execSync('git stash --include-untracked', { cwd: projectDir, stdio: 'pipe' }); } catch {}

    console.log('[update] Pulling latest changes...');
    try {
      execSync(`git pull ${remote} ${branch} --ff-only`, { stdio: 'inherit', cwd: projectDir });
    } catch {
      console.log('[update] Fast-forward failed, trying merge...');
      try {
        execSync(`git pull ${remote} ${branch}`, { stdio: 'inherit', cwd: projectDir });
      } catch {
        console.error('[update] git pull failed. Check your network and git status.');
        process.exit(1);
      }
    }

    console.log('[update] Installing dependencies...');
    try {
      execSync('npm install', { stdio: 'inherit', cwd: projectDir });
    } catch {
      console.error('[update] npm install failed.');
      process.exit(1);
    }

    console.log('[update] Building...');
    try {
      execSync('npm run build', { stdio: 'inherit', cwd: projectDir, env: { ...process.env, BRIDGE_EXPORT: '1' } });
    } catch {
      console.error('[update] Build failed.');
      process.exit(1);
    }

    console.log('[update] Update complete! Restarting...');
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

  // ─── Setup ─────────────────────────────────────────────────────
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

    const { configDir } = await import("../agent-core/config");
    const configPath = process.env.BRIDGE_CONFIG || join(configDir(), 'agent.json');

    let existing: Record<string, unknown> = {};
    try {
      if (existsSync(configPath)) {
        existing = JSON.parse(readFileSync(configPath, 'utf8'));
      }
    } catch { /* ignore malformed */ }

    const relayUrl = sarg('relay');
    const relayToken = sarg('relay-token');
    const dashboardToken = sarg('dashboard-token');
    const ntfyTopic = sarg('ntfy-topic');
    const label = sarg('label');

    if (!relayUrl && !relayToken && !dashboardToken && !ntfyTopic && !label) {
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
    if (dashboardToken) existing.dashboardToken = dashboardToken;
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

  // ─── Run ───────────────────────────────────────────────────────
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

  // ─── Node mode (default) ───────────────────────────────────────
  const { NodeRuntime } = await import("../agent-core/node-runtime");
  const { hostname } = await import("os");

  const roleOpt = arg('role', '');
  const role = (roleOpt === 'relay' || roleOpt === 'leaf') ? roleOpt : undefined;
  const isDaemon = process.env.BRIDGE_DAEMON === '1';

  // Check daemon collision only in foreground mode
  if (!isDaemon && !hasFlag('daemon-mode')) {
    const { isDaemonRunning, statusDaemon } = await import('./daemon');
    if (isDaemonRunning()) {
      const s = statusDaemon();
      console.log(`Daemon is already running (pid ${s.pid}).`);
      console.log(`  Use "bridge daemon status" for details.`);
      console.log(`  Use "bridge daemon stop" to stop it first.`);
      console.log(`  Or "bridge daemon status" to see connection info.`);
      process.exit(1);
    }
  }

  const node = new NodeRuntime({
    label: arg('label', hostname()),
    ...(role ? { role } : {}),
    workingDirectory: arg('dir', process.cwd()),
    relayPort: parseInt(arg('relay-port', '8080'), 10),
    relayToken: arg('relay-token', '') || undefined,
    upstreamRelay: arg('upstream', '') || undefined,
    dashboardPort: parseInt(arg('dashboard-port', '9843'), 10),
    dashboardToken: arg('dashboard-token', '') || undefined,
    logFile: arg('log-file', ''),
    pidFile: arg('pid-file', ''),
    devMode: hasFlag('dev'),
    extensionPaths: arg('extensions', '').split(',').map(s => s.trim()).filter(Boolean),
  });

  // Write PID file if requested
  if (node.config.pidFile) {
    const { writeFileSync, mkdirSync } = await import("fs");
    const { dirname } = await import("path");
    mkdirSync(dirname(node.config.pidFile), { recursive: true });
    writeFileSync(node.config.pidFile, String(process.pid), "utf8");
  }

  // ─── Startup banner ─────────────────────────────────────────
  const bar = '═'.repeat(54);

  function banner() {
    const relayAddr = node.config.upstreamRelay || (
      node.resolvedRole === 'relay'
        ? `ws://127.0.0.1:${node.config.relayPort}`
        : '(none)'
    );
    const dashAddr = `http://127.0.0.1:${node.config.dashboardPort}`;
    const nodeIdShort = node.config.nodeId?.slice(0, 12) || '…';
    const hasRelayToken = !!node.config.relayToken;
    const dashToken = node.config.dashboardToken || '(not set — open dashboard to create)';

    console.log(`\n╔${bar}╗`);
    console.log(`║  SessionBridge v0.6.0                                    ║`);
    console.log(`║  Node:  ${node.resolvedRole.padEnd(57)}║`);
    console.log(`║  ID:    ${nodeIdShort.padEnd(57)}║`);
    console.log(`╠${bar}╣`);
    console.log(`║  Relay:     ${relayAddr.padEnd(51)}║`);
    console.log(`║  Dashboard: ${dashAddr.padEnd(51)}║`);
    console.log(`║  Dash Key:  ${dashToken.padEnd(51)}║`);
    if (hasRelayToken) {
      console.log(`║  Relay Key: ${node.config.relayToken!.slice(0, 32).padEnd(39)}║`);
    }
    console.log(`╠${bar}╣`);
    if (node.resolvedRole === 'relay') {
      console.log(`║  Other nodes connect with:                                ║`);
      console.log(`║    bridge connect ${relayAddr.padEnd(41)}║`);
      if (hasRelayToken) console.log(`║    --token ${node.config.relayToken!.slice(0, 20).padEnd(46)}║`);
      console.log(`║  Mobile: open ${(dashAddr + '/qr').padEnd(44)}║`);
    } else {
      console.log(`║  Connected to upstream relay.                              ║`);
      console.log(`║  Dashboard: ${dashAddr.padEnd(44)}║`);
    }
    console.log(`╚${bar}╝\n`);
  }

  await node.start();

  // ─── Daemon mode: flush startup info then redirect to log ────
  if (isDaemon || hasFlag('daemon-mode')) {
    banner();
    // In daemon mode, keep minimal console output but let the
    // parent process capture the startup banner via stdout pipe.
  } else {
    banner();
  }

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

  // Keep alive — daemon doesn't exit after start
  if (isDaemon || hasFlag('daemon-mode')) {
    process.stdin.resume(); // keep process alive
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
