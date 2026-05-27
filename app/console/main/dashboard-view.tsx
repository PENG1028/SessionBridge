'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Cpu, Activity, HardDrive, Clock, Fingerprint, Server,
  Puzzle, Terminal, Bell,
} from 'lucide-react';
import { useCore } from '../core/core-client-provider';

// ─── Types ─────────────────────────────────────

interface SystemInfo {
  platform?: string; arch?: string; hostname?: string; cpus?: number;
  memory?: { free: number; total: number };
}

interface DashboardData {
  version?: string; uptime?: number; platform?: string; hostname?: string;
  cpus?: number; memory?: { free: number; total: number };
}

// ─── Helpers ───────────────────────────────────

function fmtBytes(b: number): string {
  if (!b) return '-';
  const gb = b / 1e9;
  return gb >= 1 ? gb.toFixed(1) + ' GB' : (b / 1e6).toFixed(0) + ' MB';
}

function fmtUptime(s: number): string {
  if (!s) return '-';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}

// ─── Components ────────────────────────────────

function Gauge({ pct, label }: { pct: number; label: string }) {
  const color = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-emerald-500';
  const textColor = pct > 80 ? 'text-red-400' : pct > 50 ? 'text-yellow-400' : 'text-emerald-400';
  return (
    <div>
      <div className="flex justify-between text-[10px] text-gray-500 mb-1">
        <span>{label}</span>
        <span className={`font-mono font-bold ${textColor}`}>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-2 bg-[#1a1a1a] rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

function StatusCard({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3 p-3 bg-[#111] border border-gray-800 rounded-lg">
      <Icon className="w-4 h-4 text-gray-600 mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-[9px] text-gray-600 uppercase tracking-wider">{label}</div>
        <div className="text-sm font-semibold text-gray-200 font-mono mt-0.5 break-all">{value}</div>
        {sub && <div className="text-[10px] text-gray-600 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────

export function DashboardView() {
  const core = useCore();
  const [data, setData] = useState<DashboardData | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [err, setErr] = useState('');

  const refresh = useCallback(async () => {
    if (!core?.isConnected) return;
    try {
      const [info, logResult] = await Promise.all([
        core.call<{ cwd?: string; platform?: string; arch?: string; hostname?: string; cpus?: number; uptime?: number }>('node.info', {}),
        core.call<{ entries?: Array<{ message: string }> }>('logs.tail', { source: 'core', lines: 20 }).catch(() => ({ entries: [] })),
      ]);
      setData({
        version: '',
        uptime: info.uptime || 0,
        platform: info.platform || '',
        hostname: info.hostname || '',
        cpus: info.cpus || 0,
        memory: { free: 0, total: 0 },
      });
      setLogs((logResult?.entries ?? []).map((e: { message: string }) => e.message));
      setErr('');
    } catch (e: any) {
      setErr(e.message || 'Failed to load');
    }
  }, [core]);

  useEffect(() => { refresh(); const t = setInterval(refresh, 30000); return () => clearInterval(t); }, [refresh]);

  if (err && !data) {
    return (
      <div className="flex-1 flex items-center justify-center bg-black">
        <div className="text-center space-y-2">
          <Server className="w-8 h-8 text-red-500 mx-auto" />
          <p className="text-sm text-red-400">Dashboard unavailable</p>
          <p className="text-[10px] text-gray-600">{err}</p>
          <button onClick={refresh} className="text-[10px] text-purple-400 hover:text-purple-300 underline">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-black">
      <div className="max-w-4xl mx-auto p-4 space-y-5">

        {/* ── System Status ── */}
        <div>
          <div className="flex items-center gap-2 text-[10px] text-gray-600 uppercase tracking-wider mb-3">
            <Activity className="w-3 h-3" /> System Status
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <StatusCard icon={Clock} label="Uptime" value={fmtUptime(data?.uptime || 0)} />
            <StatusCard icon={Fingerprint} label="Host" value={data?.hostname || '-'} />
            <StatusCard icon={Cpu} label="Platform" value={data?.platform || '-'} sub={`${data?.cpus || '-'} CPUs`} />
            <StatusCard icon={Server} label="Memory" value={data?.memory?.total ? fmtBytes(data.memory.total) : '-'} sub={data?.memory?.total ? `${fmtBytes(data.memory.free)} free` : ''} />
          </div>
        </div>

        {/* ── Memory / CPU ── */}
        {data?.memory?.total ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-[#111] border border-gray-800 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <HardDrive className="w-3.5 h-3.5 text-gray-600" />
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Memory</span>
                <span className="text-[10px] text-gray-700 ml-auto">{fmtBytes(data.memory.free)} free / {fmtBytes(data.memory.total)} total</span>
              </div>
              <Gauge pct={data.memory.total ? ((1 - data.memory.free / data.memory.total) * 100) : 0} label="Usage" />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-[#111] border border-gray-800 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <Cpu className="w-3.5 h-3.5 text-gray-600" />
                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Node</span>
                <span className="text-[10px] text-gray-700 ml-auto">{data?.cpus || '-'} CPUs</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Logs ── */}
        <div>
          <div className="flex items-center gap-2 text-[10px] text-gray-600 uppercase tracking-wider mb-2">
            <Terminal className="w-3 h-3" /> Logs
          </div>
          <div className="bg-[#111] border border-gray-800 rounded-lg">
            <pre className="p-3 text-[10px] text-gray-500 leading-relaxed max-h-[180px] overflow-y-auto font-mono">
              {logs.length === 0 ? 'No logs' : logs.join('\n')}
            </pre>
          </div>
        </div>

      </div>
    </div>
  );
}
