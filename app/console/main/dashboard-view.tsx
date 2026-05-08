'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Cpu, Activity, HardDrive, Clock, Fingerprint, Server,
  Wifi, Box, Puzzle, Terminal, ChevronRight, Bell,
} from 'lucide-react';

// ─── Types ─────────────────────────────────────

interface SystemInfo {
  platform: string; arch: string; nodeVersion: string;
  hostname: string; cpus: number; loadavg: number[];
  memory: { free: number; total: number };
}

interface StatusData {
  version: string; label: string; pid: number; uptime: number;
  system: SystemInfo; relayConnected: boolean;
  adapters: { id: string; available: boolean }[];
  permissions: Record<string, boolean>;
  notifications: { scenarios: { id: string; label: string; description?: string; source?: string }[]; settings: Record<string, boolean> };
}

interface ExtData {
  enabled: boolean; state: string; pid?: number; crashCount: number;
  activatedExtensionIds?: string[];
}

interface ProcEntry {
  pid: number; name: string; cpu: number; mem: number;
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

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(r.statusText);
  return r.json();
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
  const [data, setData] = useState<StatusData | null>(null);
  const [ext, setExt] = useState<ExtData | null>(null);
  const [procs, setProcs] = useState<ProcEntry[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [err, setErr] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [s, p, l] = await Promise.all([
        apiJson<StatusData>('/api/status'),
        apiJson<ProcEntry[]>('/api/processes?sort=cpu&limit=10').catch(() => []),
        apiJson<string[]>('/api/logs').catch(() => []),
      ]);
      setData(s);
      setProcs(p);
      setLogs(l);
      setErr('');
    } catch (e: any) {
      setErr(e.message || 'Failed to load');
    }
    // Extensions separately (may 404)
    apiJson<ExtData>('/api/extensions').then(setExt).catch(() => {});
  }, []);

  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);

  const togglePerm = useCallback(async (cat: string, val: boolean) => {
    await apiJson('/api/permissions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: cat, value: val }),
    });
    refresh();
  }, [refresh]);

  const toggleNotif = useCallback(async (id: string, val: boolean) => {
    await apiJson('/api/notifications', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId: id, value: val }),
    });
    refresh();
  }, [refresh]);

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

  const s = data;
  const memPct = s?.system.memory.total ? ((1 - s.system.memory.free / s.system.memory.total) * 100) : 0;
  const loadAvg = s?.system.loadavg?.[0] || 0;
  const cpuPct = s?.system.cpus ? Math.min(100, (loadAvg / s.system.cpus * 100)) : 0;

  const nd = data?.notifications || { scenarios: [], settings: {} };
  const notifGroups: Record<string, typeof nd.scenarios> = {};
  for (const sc of nd.scenarios) {
    const src = sc.source || 'system';
    if (!notifGroups[src]) notifGroups[src] = [];
    notifGroups[src].push(sc);
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
            <StatusCard icon={Clock} label="Uptime" value={fmtUptime(s?.uptime || 0)} />
            <StatusCard icon={Fingerprint} label="PID" value={String(s?.pid || '-')} />
            <StatusCard icon={Cpu} label="Version" value={`v${s?.version || '-'}`} sub={`Relay ${s?.relayConnected ? 'Connected' : 'Disconnected'}`} />
            <StatusCard icon={Wifi} label="Ports" value={`${s?.system.platform || ''}`} sub={s?.system.arch || ''} />
          </div>
        </div>

        {/* ── Gauges ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 bg-[#111] border border-gray-800 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <HardDrive className="w-3.5 h-3.5 text-gray-600" />
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">Memory</span>
              <span className="text-[10px] text-gray-700 ml-auto">{fmtBytes(s?.system.memory.free ?? 0)} free / {fmtBytes(s?.system.memory.total ?? 0)} total</span>
            </div>
            <Gauge pct={memPct} label="Usage" />
          </div>
          <div className="p-4 bg-[#111] border border-gray-800 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <Cpu className="w-3.5 h-3.5 text-gray-600" />
              <span className="text-[10px] text-gray-500 uppercase tracking-wider">CPU</span>
              <span className="text-[10px] text-gray-700 ml-auto">{s?.system.cpus || '-'} cores · load {s?.system.loadavg?.map(n => n.toFixed(1)).join(' ') ?? '-'}</span>
            </div>
            <Gauge pct={cpuPct} label="Load" />
          </div>
        </div>

        {/* ── Permissions ── */}
        {s?.permissions && Object.keys(s.permissions).length > 0 && (
          <div>
            <div className="flex items-center gap-2 text-[10px] text-gray-600 uppercase tracking-wider mb-2">
              <Terminal className="w-3 h-3" /> Permissions
            </div>
            <div className="bg-[#111] border border-gray-800 rounded-lg p-3">
              {Object.entries(s.permissions).map(([cat, val]) => (
                <div key={cat} className="flex items-center justify-between py-1.5 border-b border-gray-800/50 last:border-0">
                  <span className="text-xs text-gray-300 font-mono">{cat}</span>
                  <button
                    onClick={() => togglePerm(cat, !val)}
                    className={`relative w-8 h-4 rounded-full transition-colors ${val ? 'bg-emerald-600' : 'bg-gray-700'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${val ? 'translate-x-4' : ''}`} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Notifications ── */}
        {nd.scenarios.length > 0 && (
          <div>
            <div className="flex items-center gap-2 text-[10px] text-gray-600 uppercase tracking-wider mb-2">
              <Bell className="w-3 h-3" /> Notifications
            </div>
            <div className="bg-[#111] border border-gray-800 rounded-lg p-3">
              {Object.entries(notifGroups).map(([src, scenarios]) => (
                <div key={src}>
                  <div className="text-[9px] text-gray-600 uppercase tracking-wider mb-1 mt-2 first:mt-0">{src}</div>
                  {scenarios.map(sc => {
                    const checked = nd.settings[sc.id] !== false;
                    return (
                      <div key={sc.id} className="flex items-center justify-between py-1.5 border-b border-gray-800/50 last:border-0" title={sc.description || ''}>
                        <span className="text-xs text-gray-300">{sc.label}</span>
                        <button
                          onClick={() => toggleNotif(sc.id, !checked)}
                          className={`relative w-8 h-4 rounded-full transition-colors ${checked ? 'bg-emerald-600' : 'bg-gray-700'}`}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Adapters & Extensions ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] text-gray-600 uppercase tracking-wider mb-2">
              <Box className="w-3 h-3" /> Adapters
            </div>
            <div className="bg-[#111] border border-gray-800 rounded-lg p-3">
              {(!s?.adapters || s.adapters.length === 0) ? (
                <span className="text-[11px] text-gray-600">No adapters detected</span>
              ) : s.adapters.map(a => (
                <div key={a.id} className="flex items-center justify-between py-1.5 border-b border-gray-800/50 last:border-0">
                  <span className="text-xs text-gray-300 font-mono">{a.id}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${a.available ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>
                    {a.available ? 'Available' : 'Unavailable'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 text-[10px] text-gray-600 uppercase tracking-wider mb-2">
              <Puzzle className="w-3 h-3" /> Extensions
            </div>
            <div className="bg-[#111] border border-gray-800 rounded-lg p-3">
              {!ext ? (
                <span className="text-[11px] text-gray-600">Extension manager disabled</span>
              ) : (
                <>
                  <div className="flex items-center justify-between py-1.5 border-b border-gray-800/50">
                    <span className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${ext.state === 'running' ? 'bg-emerald-500' : ext.state === 'crashed' ? 'bg-red-500' : 'bg-yellow-500'}`} />
                      <span className="text-xs text-gray-300 font-semibold capitalize">{ext.state}</span>
                    </span>
                    <span className="text-[9px] text-gray-600">pid {ext.pid ?? '-'} · crashed {ext.crashCount}</span>
                  </div>
                  {ext.activatedExtensionIds && ext.activatedExtensionIds.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {ext.activatedExtensionIds.map(id => (
                        <span key={id} className="text-[9px] bg-emerald-900/20 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-800/30">{id}</span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Processes ── */}
        <div>
          <div className="flex items-center gap-2 text-[10px] text-gray-600 uppercase tracking-wider mb-2">
            <Activity className="w-3 h-3" /> Processes (top 10)
          </div>
          <div className="bg-[#111] border border-gray-800 rounded-lg overflow-hidden">
            {procs.length === 0 ? (
              <div className="p-4 text-[11px] text-gray-600 text-center">No process data</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-gray-800 text-gray-600 uppercase tracking-wider">
                      <th className="text-left px-3 py-2 font-medium">PID</th>
                      <th className="text-left px-3 py-2 font-medium">Name</th>
                      <th className="text-right px-3 py-2 font-medium">CPU</th>
                      <th className="text-right px-3 py-2 font-medium">Memory</th>
                    </tr>
                  </thead>
                  <tbody>
                    {procs.map(p => (
                      <tr key={p.pid} className="border-b border-gray-800/30 last:border-0 hover:bg-[#1a1a1a] transition-colors">
                        <td className="px-3 py-1.5 text-gray-500 font-mono">{p.pid}</td>
                        <td className="px-3 py-1.5 text-gray-300 truncate max-w-[200px]">{p.name}</td>
                        <td className="px-3 py-1.5 text-right text-gray-400 font-mono">{p.cpu != null ? p.cpu.toFixed(1) + '%' : '-'}</td>
                        <td className="px-3 py-1.5 text-right text-gray-400 font-mono">{p.mem != null ? p.mem.toFixed(1) + '%' : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* ── Logs ── */}
        <div>
          <div className="flex items-center gap-2 text-[10px] text-gray-600 uppercase tracking-wider mb-2">
            <ChevronRight className="w-3 h-3" /> Logs
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
