'use client';

import { useState, useEffect } from 'react';
import { getDefaultAdapterId } from '../../../adapters/registry';

// ── Logs Panel ──────────────────────────────────────────────

export function LogsPanel(props: { logs?: string[]; msgLog?: any[] }) {
  const { logs } = props;
  if (!logs || logs.length === 0) {
    return <div className="text-gray-700 text-[10px] italic p-3">No logs available</div>;
  }
  return (
    <div className="border-t border-gray-800 bg-[#111]">
      <div className="p-2 text-[10px] font-bold text-gray-500 tracking-wider">LOGS</div>
      <div className="max-h-36 overflow-y-auto px-2 pb-2 space-y-0.5">
        {logs.slice(-50).map((log, i) => (
          <div key={i} className={`text-[9px] font-mono whitespace-pre-wrap ${
            log.includes('Error') || log.includes('[Error]') ? 'text-red-400'
            : log.includes('✓') || log.includes('✅') ? 'text-green-400'
            : 'text-gray-500'
          }`}>{log}</div>
        ))}
      </div>
    </div>
  );
}

// ── Terminal Panel ──────────────────────────────────────────

export function TerminalPanel(props: { msgLog?: any[] }) {
  const { msgLog } = props;
  if (!msgLog || msgLog.length === 0) {
    return <div className="text-gray-700 text-[10px] italic p-3">No terminal output</div>;
  }
  return (
    <div className="border-t border-gray-800 bg-black">
      <div className="p-2 text-[10px] font-bold text-gray-500 tracking-wider">RAW</div>
      <div className="max-h-36 overflow-y-auto px-2 pb-2 space-y-0.5">
        {msgLog.slice(-100).map((entry: any) => (
          <div key={entry.id} className="text-[9px] font-mono">
            <span className="text-gray-700">{entry.time}</span>{' '}
            <span className={entry.type === 'error' ? 'text-red-400' : 'text-gray-500'}>
              [{entry.type}]
            </span>{' '}
            <span className="text-gray-400">{entry.data}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── System Panel ────────────────────────────────────────────

export function SystemPanel(props: { projectCwd?: string }) {
  const [info, setInfo] = useState<{ cwd?: string; platform?: string; hostname?: string; uptime?: number } | null>(null);

  useEffect(() => {
    fetch('/api/info').then(r => r.json()).then(data => {
      setInfo({
        cwd: data.cwd,
        platform: data.platform || (typeof navigator !== 'undefined' ? navigator.platform : ''),
        hostname: data.hostname || '',
        uptime: data.uptime,
      });
    }).catch(() => {});
  }, []);

  return (
    <div className="border-t border-gray-800 bg-[#111]">
      <div className="p-2 text-[10px] font-bold text-gray-500 tracking-wider">SYSTEM</div>
      <div className="px-2 pb-2 space-y-1">
        {info ? (
          <>
            {info.cwd && (
              <div className="text-[9px] text-gray-400">
                <span className="text-gray-600">cwd </span>
                <span className="text-gray-500 truncate block">{info.cwd}</span>
              </div>
            )}
            {info.platform && (
              <div className="text-[9px] text-gray-400">
                <span className="text-gray-600">platform </span>
                <span>{info.platform}</span>
              </div>
            )}
            {info.hostname && (
              <div className="text-[9px] text-gray-400">
                <span className="text-gray-600">host </span>
                <span>{info.hostname}</span>
              </div>
            )}
            {info.uptime !== undefined && (
              <div className="text-[9px] text-gray-400">
                <span className="text-gray-600">uptime </span>
                <span>{Math.floor(info.uptime / 60)}m</span>
              </div>
            )}
          </>
        ) : (
          <div className="text-gray-700 text-[9px] italic">Loading system info...</div>
        )}
        {props.projectCwd && (
          <div className="text-[9px] text-gray-600 pt-1 border-t border-gray-800">
            project: {props.projectCwd.split(/[/\\]/).pop()}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Processes Panel ─────────────────────────────────────────

export function ProcessesPanel(props: { instances?: any[]; activeInstanceId?: string | null }) {
  const { instances, activeInstanceId } = props;
  if (!instances || instances.length === 0) {
    return <div className="text-gray-700 text-[10px] italic p-3">No processes</div>;
  }
  return (
    <div className="border-t border-gray-800 bg-[#111]">
      <div className="p-2 text-[10px] font-bold text-gray-500 tracking-wider">PROCESSES</div>
      <div className="max-h-40 overflow-y-auto px-2 pb-2 space-y-1">
        {instances.map((inst: any) => (
          <div key={inst.id} className={`flex items-center gap-2 px-2 py-1 rounded text-[9px] ${
            inst.id === activeInstanceId ? 'bg-purple-900/20 text-purple-300' : 'text-gray-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              inst.status === 'running' ? 'bg-green-500' : inst.status === 'error' ? 'bg-red-500' : 'bg-gray-600'
            }`} />
            <span className="truncate flex-1">{inst.label || inst.id?.slice(0, 8)}</span>
            <span className="text-gray-600">{inst.adapterId || getDefaultAdapterId()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
