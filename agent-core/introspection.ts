// ─── System Introspection ──────────────────────────────────────
// Cross-platform system info and process listing.
// Uses only Node.js built-in modules.

import { execSync } from 'child_process';
import { cpus, totalmem, freemem, loadavg, hostname, platform, arch, uptime, homedir, networkInterfaces } from 'os';
import type { ProcessInfo } from '../extensions/types';

export interface SystemState {
  platform: string;
  hostname: string;
  arch: string;
  cpus: number;
  memory: { total: number; free: number };
  loadavg: number[];
  uptime: number;
  home: string;
  nodeVersion: string;
}

export function getSystemState(): SystemState {
  return {
    platform: platform(),
    hostname: hostname(),
    arch: arch(),
    cpus: cpus().length,
    memory: { total: totalmem(), free: freemem() },
    loadavg: loadavg(),
    uptime: uptime(),
    home: homedir(),
    nodeVersion: process.version,
  };
}

export interface AgentIntrospection {
  version: string;
  label: string;
  pid: number;
  uptime: number;
  system: SystemState;
  adapters: { id: string; available: boolean }[];
  permissions: Record<string, boolean>;
  notifications?: { scenarios: import('../extensions/types').NotificationScenario[]; settings: Record<string, boolean> };
}

/** Cross-platform process listing. */
export function listProcesses(): ProcessInfo[] {
  try {
    if (process.platform === 'win32') {
      return listProcessesWindows();
    }
    return listProcessesUnix();
  } catch {
    return [];
  }
}

/** Cross-platform process listing, sorted and with optional limit. */
export function listProcessesSorted(
  sortBy: 'cpu' | 'memory' | 'pid' = 'memory',
  limit = 50,
): ProcessInfo[] {
  const procs = listProcesses();
  procs.sort((a, b) => (b[sortBy] as number) - (a[sortBy] as number));
  return procs.slice(0, limit);
}

function listProcessesWindows(): ProcessInfo[] {
  const out = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', timeout: 5000 });
  const lines = out.trim().split('\n');
  const result: ProcessInfo[] = [];
  for (const line of lines) {
    // Format: "name.exe","pid","session","session#","mem"
    const m = line.match(/"([^"]+)","(\d+)","[^"]*","[^"]*","([\d,]+) K"/);
    if (m) {
      result.push({
        pid: parseInt(m[2], 10),
        ppid: 0,
        name: m[1],
        command: m[1],
        cpu: 0,
        memory: parseInt(m[3].replace(/,/g, ''), 10) * 1024,
        state: 'running',
        user: '',
      });
    }
  }
  return result;
}

function listProcessesUnix(): ProcessInfo[] {
  const out = execSync('ps -eo pid,ppid,user,state,%cpu,rss,comm,args --no-headers 2>/dev/null || ps -eo pid,ppid,user,state,comm,args --no-headers', {
    encoding: 'utf8', timeout: 5000,
  });
  const lines = out.trim().split('\n');
  const result: ProcessInfo[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const hasCpuRss = parts.length >= 7 && parts[4].includes('.');
    if (hasCpuRss) {
      result.push({
        pid: parseInt(parts[0], 10) || 0,
        ppid: parseInt(parts[1], 10) || 0,
        user: parts[2] || '',
        state: parts[3] || '',
        cpu: parseFloat(parts[4]) || 0,
        memory: parseInt(parts[5], 10) * 1024 || 0, // RSS KB → bytes
        name: parts[6] || '',
        command: parts.slice(7).join(' ') || parts[6] || '',
      });
    } else {
      result.push({
        pid: parseInt(parts[0], 10) || 0,
        ppid: parseInt(parts[1], 10) || 0,
        user: parts[2] || '',
        state: parts[3] || '',
        name: parts[4] || '',
        command: parts.slice(5).join(' ') || parts[4] || '',
        cpu: 0,
        memory: 0,
      });
    }
  }
  return result;
}
