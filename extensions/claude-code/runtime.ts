// ─── Claude Code Runtime ─────────────────────────────────────
// Encapsulates Claude-specific CLI invocation + file storage paths.
// relay-server calls these functions instead of hardcoding
// Claude flags (--output-format stream-json) or .claude paths.

import { execSync, spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { join } from 'path';
import { homedir } from 'os';

// ─── Binary detection ──────────────────────────────────────

/** Find the Claude CLI binary on this machine */
export function resolveClaudeCommand(): { cmd: string; args: string[] } {
  if (process.platform === 'win32') {
    try {
      const out = execSync('where claude', { encoding: 'utf8', timeout: 5000 });
      const cmdPath = out.split('\n')[0].trim();
      if (cmdPath) return { cmd: 'cmd.exe', args: ['/c', cmdPath] };
    } catch { /* fall through */ }
    return { cmd: 'cmd.exe', args: ['/c', 'claude'] };
  }
  return { cmd: 'claude', args: [] };
}

/** Check if Claude CLI is available */
export function isClaudeAvailable(): boolean {
  try {
    const { cmd, args } = resolveClaudeCommand();
    execSync(`"${args.length ? args.join(' ') : cmd}" --version`, {
      timeout: 10000, stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

// ─── CLI args for spawning ──────────────────────────────────

/** Build Claude CLI arguments for a stream-json session */
export function buildClaudeArgs(model?: string | null): string[] {
  const args = [
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--dangerously-skip-permissions',
  ];
  if (model) args.push('--model', model);
  return args;
}

// ─── Full spawn (for adapter.start()) ───────────────────────

export interface SpawnClaudeDeps {
  onBlock: (block: Record<string, unknown>) => void;
  onOutput: (data: string) => void;
  onError: (err: Error) => void;
  onClose: (code: number | null) => void;
  parseLine: (line: string, deps: Record<string, unknown>) => void;
  instanceId?: string;
  model?: string | null;
  cwd?: string;
}

export function spawnClaudeProcess(deps: SpawnClaudeDeps): ChildProcess {
  const { cmd, args: prefix } = resolveClaudeCommand();
  const allArgs = [...prefix, ...buildClaudeArgs(deps.model)];

  const proc = spawn(cmd, allArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: deps.cwd,
  });

  const rl = createInterface({ input: proc.stdout! });
  rl.on('line', (line) => deps.parseLine(line, {}));

  proc.stderr?.on('data', (chunk: Buffer) => {
    deps.onOutput(chunk.toString());
  });

  proc.on('error', deps.onError);
  proc.on('close', deps.onClose);

  return proc;
}

// ─── Session file paths ─────────────────────────────────────

/** Get the Claude data directory (~/.claude) */
export function getClaudeDataDir(): string {
  return join(homedir(), '.claude');
}

/** Get the projects directory for Claude sessions */
export function getClaudeProjectsDir(): string {
  return join(getClaudeDataDir(), 'projects');
}

/** Get the session file path for a given project and session ID */
export function getClaudeSessionPath(project: string, sessionId: string): string {
  const slug = project.replace(/[\\/: ]/g, '-');
  return join(getClaudeProjectsDir(), slug, sessionId + '.jsonl');
}

/** Get the Claude history file path */
export function getClaudeHistoryPath(): string {
  return join(getClaudeDataDir(), 'history.jsonl');
}

/** Get project slug for a given directory path */
export function getProjectSlug(dir: string): string {
  return dir.replace(/[^a-zA-Z0-9-]/g, '-');
}
