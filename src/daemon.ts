// ─── Daemon Lifecycle Management ───────────────────────────────
// Handles: start (background), stop (signal), status (poll PID),
// and platform-specific auto-start registration.
//
// The daemon is the singleton background process. CLI and GUI are
// clients that talk to it via the local dashboard API (9843 port).

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { execSync, spawn } from 'child_process';
import { homedir, platform } from 'os';

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  /** When the daemon was started (milliseconds since epoch) */
  startedAt?: number;
  /** The PID file path that was checked */
  pidFile: string;
}

export interface DaemonStartConfig {
  /** PID file path (default: ~/.sessionbridge/daemon.pid) */
  pidFile?: string;
  /** Log file path (default: ~/.sessionbridge/daemon.log) */
  logFile?: string;
  /** Working directory */
  cwd?: string;
}

const DEFAULT_PID_FILE = ((): string => {
  const base = platform() === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'session-bridge')
    : join(homedir(), '.sessionbridge');
  return join(base, 'daemon.pid');
})();

const DEFAULT_LOG_FILE = ((): string => {
  const base = platform() === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'session-bridge')
    : join(homedir(), '.sessionbridge');
  return join(base, 'daemon.log');
})();

// ─── PID helpers ────────────────────────────────────────────────

function readPid(pidFile: string): number | null {
  try {
    if (!existsSync(pidFile)) return null;
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    return isFinite(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

function writePid(pidFile: string, pid: number): void {
  mkdirSync(dirname(pidFile), { recursive: true });
  writeFileSync(pidFile, String(pid), 'utf8');
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

// ─── Public API ─────────────────────────────────────────────────

/** Check if the daemon is currently running. */
export function isDaemonRunning(pidFile?: string): boolean {
  const pf = pidFile || process.env.BRIDGE_PID_FILE || DEFAULT_PID_FILE;
  const pid = readPid(pf);
  if (!pid) return false;
  return isPidAlive(pid);
}

/** Get daemon status. Never throws. */
export function statusDaemon(pidFile?: string): DaemonStatus {
  const pf = pidFile || process.env.BRIDGE_PID_FILE || DEFAULT_PID_FILE;
  const pid = readPid(pf);
  if (!pid || !isPidAlive(pid)) {
    return { running: false, pidFile: pf };
  }
  // Read the PID file mtime as approximate start time
  let startedAt: number | undefined;
  try {
    const { statSync } = require('fs');
    startedAt = statSync(pf).mtimeMs;
  } catch { /* best effort */ }
  return { running: true, pid, startedAt, pidFile: pf };
}

/**
 * Start the daemon as a detached background process.
 * The current process exits after spawning; the child lives on.
 * Returns the PID of the spawned daemon.
 */
export function startDaemon(config?: DaemonStartConfig): void {
  const pidFile = config?.pidFile || process.env.BRIDGE_PID_FILE || DEFAULT_PID_FILE;
  const logFile = config?.logFile || process.env.BRIDGE_LOG_FILE || DEFAULT_LOG_FILE;

  // Check if already running
  const existing = statusDaemon(pidFile);
  if (existing.running) {
    console.log(`Daemon already running (pid ${existing.pid}).`);
    console.log(`  Status:  bridge daemon status`);
    console.log(`  Stop:    bridge daemon stop`);
    return;
  }

  // Clean stale PID file
  try { unlinkSync(pidFile); } catch { /* ok */ }

  // Resolve the entry point: prefer dist/index.js, fall back to tsx
  const entryPoint = (() => {
    const distJs = join(__dirname, '..', 'dist', 'index.js');
    if (existsSync(distJs)) return { cmd: process.execPath, args: [distJs] };
    // Development: use tsx
    return { cmd: process.execPath, args: [join(__dirname, '..', 'node_modules', '.bin', 'tsx'), join(__dirname, 'index.ts')] };
  })();

  // Collect CLI args for the daemon (filter out daemon subcommand)
  const daemonArgs = process.argv.slice(2).filter(a => a !== 'daemon' && a !== 'start');
  // Ensure PID and log file are passed to the daemon process
  if (!daemonArgs.some(a => a.includes('pid-file'))) {
    daemonArgs.push('--pid-file', pidFile);
  }
  if (!daemonArgs.some(a => a.includes('log-file'))) {
    daemonArgs.push('--log-file', logFile);
  }
  daemonArgs.push('--daemon-mode');

  mkdirSync(dirname(logFile), { recursive: true });

  const child = spawn(entryPoint.cmd, [...entryPoint.args, ...daemonArgs], {
    cwd: config?.cwd || process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, BRIDGE_DAEMON: '1' },
  });

  // Capture initial output to show connection info
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk);
  });

  // Write PID immediately
  if (child.pid) {
    writePid(pidFile, child.pid);
  }

  child.unref();

  console.log(`\nDaemon started (pid ${child.pid}).`);
  console.log(`  Log:  ${logFile}`);
  console.log(`  Stop: bridge daemon stop`);
}

/** Stop a running daemon. Returns true if a daemon was found and killed. */
export function stopDaemon(pidFile?: string): boolean {
  const pf = pidFile || process.env.BRIDGE_PID_FILE || DEFAULT_PID_FILE;
  const status = statusDaemon(pf);
  if (!status.running || !status.pid) {
    console.log('No daemon running.');
    return false;
  }

  // Graceful first (SIGTERM), then force after 3s (SIGKILL)
  console.log(`Stopping daemon (pid ${status.pid})...`);
  try { process.kill(status.pid, 'SIGTERM'); } catch { /* already dead */ }

  const start = Date.now();
  try {
    const { statSync } = require('fs');
    while (Date.now() - start < 5000) {
      if (!isPidAlive(status.pid)) {
        console.log(`Daemon stopped.`);
        try { unlinkSync(pf); } catch { /* ok */ }
        return true;
      }
      const until = Date.now() + 200;
      while (Date.now() < until) { /* spin-wait 200ms */ }
    }
  } catch { /* fall through to force kill */ }

  // Force kill
  console.log(`Daemon not responding — force killing...`);
  try { process.kill(status.pid, 'SIGKILL'); } catch { /* gone */ }
  try { unlinkSync(pf); } catch { /* ok */ }
  console.log(`Daemon stopped (forced).`);
  return true;
}

// ─── Auto-Start Installation ─────────────────────────────────────

/** Result of installing the daemon for auto-start. */
export interface InstallResult {
  platform: string;
  method: string;
  path: string;
  success: boolean;
  error?: string;
}

/**
 * Register the daemon to start automatically on boot/in.
 * Detects the current platform and installs the appropriate
 * service / unit / plist / task.
 */
export function installDaemon(pidFile?: string): InstallResult {
  const pf = pidFile || process.env.BRIDGE_PID_FILE || DEFAULT_PID_FILE;
  const entryPoint = (() => {
    const distJs = join(__dirname, '..', 'dist', 'index.js');
    if (existsSync(distJs)) return { cmd: process.execPath, args: [distJs] };
    const tsxBin = join(__dirname, '..', 'node_modules', '.bin', 'tsx');
    return { cmd: process.execPath, args: [tsxBin, join(__dirname, 'index.ts')] };
  })();

  const daemonCmd = `"${entryPoint.cmd}" ${entryPoint.args.map(a => `"${a}"`).join(' ')} daemon start --pid-file "${pf}"`;

  const p = platform();

  // ── Linux (systemd user unit) ──────────────────────────────
  if (p === 'linux') {
    const unitName = 'session-bridge.service';
    const userSystemdDir = join(homedir(), '.config', 'systemd', 'user');
    const unitPath = join(userSystemdDir, unitName);

    const unitContent = `[Unit]
Description=SessionBridge Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${entryPoint.cmd} ${entryPoint.args.join(' ')} daemon start --pid-file "${pf}"
Restart=always
RestartSec=10
StandardOutput=append:${DEFAULT_LOG_FILE}
StandardError=append:${DEFAULT_LOG_FILE}
Environment=BRIDGE_DAEMON=1

[Install]
WantedBy=default.target
`;

    try {
      mkdirSync(userSystemdDir, { recursive: true });
      writeFileSync(unitPath, unitContent, 'utf8');
      execSync(`systemctl --user enable ${unitName}`, { stdio: 'pipe' });
      execSync(`systemctl --user start ${unitName}`, { stdio: 'pipe' });
      console.log(`Service installed: ${unitPath}`);
      return { platform: 'linux', method: 'systemd', path: unitPath, success: true };
    } catch (err: any) {
      return { platform: 'linux', method: 'systemd', path: unitPath, success: false, error: String(err.stderr || err.message) };
    }
  }

  // ── macOS (LaunchAgent) ────────────────────────────────────
  if (p === 'darwin') {
    const label = 'com.sessionbridge.daemon';
    const agentsDir = join(homedir(), 'Library', 'LaunchAgents');
    const plistPath = join(agentsDir, `${label}.plist`);

    const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${entryPoint.cmd}</string>
        ${entryPoint.args.map(a => `<string>${a}</string>`).join('\n        ')}
        <string>daemon</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${DEFAULT_LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>${DEFAULT_LOG_FILE}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>BRIDGE_DAEMON</key>
        <string>1</string>
    </dict>
</dict>
</plist>`;

    try {
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(plistPath, plistContent, 'utf8');
      execSync(`launchctl load ${plistPath}`, { stdio: 'pipe' });
      console.log(`LaunchAgent installed: ${plistPath}`);
      return { platform: 'darwin', method: 'launchd', path: plistPath, success: true };
    } catch (err: any) {
      return { platform: 'darwin', method: 'launchd', path: plistPath, success: false, error: String(err.stderr || err.message) };
    }
  }

  // ── Windows (Task Scheduler) ──────────────────────────────
  if (p === 'win32') {
    const taskName = 'SessionBridgeDaemon';
    const taskCmd = `powershell -Command "Start-Process -WindowStyle Hidden -FilePath '${entryPoint.cmd}' -ArgumentList '${entryPoint.args.join("','")}' daemon start"`;

    try {
      execSync(`schtasks /Create /F /SC ONLOGON /TN "${taskName}" /TR "${taskCmd}" /RL HIGHEST`, { stdio: 'pipe' });
      execSync(`schtasks /Run /TN "${taskName}"`, { stdio: 'pipe' });
      console.log(`Task Scheduler task installed: ${taskName}`);
      return { platform: 'win32', method: 'task-scheduler', path: taskName, success: true };
    } catch (err: any) {
      return { platform: 'win32', method: 'task-scheduler', path: taskName, success: false, error: String(err.stderr || err.message) };
    }
  }

  return { platform: p, method: 'none', path: '', success: false, error: `Unsupported platform: ${p}` };
}
