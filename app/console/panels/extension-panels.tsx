'use client';

import { useState, useEffect, useRef } from 'react';
import { useCore } from '../core/core-client-provider';

// ── Logs Panel ──────────────────────────────────────────────

export function LogsPanel(props: { logs?: string[]; msgLog?: any[] }) {
  const core = useCore();
  const [coreLogs, setCoreLogs] = useState<string[] | null>(null);
  const { logs } = props;

  useEffect(() => {
    if (!core?.isConnected) return;
    core.call<{ entries?: Array<{ message: string }> }>('logs.tail', { source: 'core', lines: 50 })
      .then(data => {
        const entries = data?.entries ?? [];
        setCoreLogs(entries.map((e: { message: string }) => e.message));
      })
      .catch(() => {});
  }, [core]);

  const displayLogs = coreLogs ?? logs;
  if (!displayLogs || displayLogs.length === 0) {
    return <div className="text-gray-700 text-[10px] italic p-3">No logs available</div>;
  }
  return (
    <div className="border-t border-gray-800 bg-[#111]">
      <div className="p-2 text-[10px] font-bold text-gray-500 tracking-wider">LOGS</div>
      <div className="max-h-36 overflow-y-auto px-2 pb-2 space-y-0.5">
        {displayLogs.slice(-50).map((log, i) => (
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
  const core = useCore();
  const { msgLog } = props;
  const [streamEntries, setStreamEntries] = useState<Array<{ id: number; sessionId: string; time: string; data: string }>>([]);
  const nextIdRef = useRef(0);

  useEffect(() => {
    if (!core?.isConnected) return;
    const handler = (event: any) => {
      if (event.type !== 'stream.chunk') return;
      const now = new Date();
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
      setStreamEntries(prev => {
        const next = [...prev, { id: nextIdRef.current++, sessionId: event.sessionId, time, data: event.data }];
        return next.slice(-100);
      });
    };
    core.on('stream.chunk', handler);
    return () => { core.off('stream.chunk', handler); };
  }, [core]);

  // Prefer CoreClient stream data, fallback to msgLog prop
  if (streamEntries.length > 0) {
    return (
      <div className="border-t border-gray-800 bg-black">
        <div className="p-2 text-[10px] font-bold text-gray-500 tracking-wider">RAW</div>
        <div className="max-h-36 overflow-y-auto px-2 pb-2 space-y-0.5">
          {streamEntries.map((entry) => (
            <div key={entry.id} className="text-[9px] font-mono">
              <span className="text-gray-700">{entry.time}</span>{' '}
              <span className="text-gray-600">{entry.sessionId.slice(0, 8)}</span>{' '}
              <span className="text-gray-400">{entry.data}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

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
  const core = useCore();
  const [info, setInfo] = useState<{ cwd?: string; platform?: string; hostname?: string; uptime?: number } | null>(null);

  useEffect(() => {
    if (!core?.isConnected) return;
    core.call<{ cwd?: string; platform?: string; hostname?: string; uptime?: number }>('node.info', {})
      .then(data => {
        setInfo({
          cwd: data.cwd,
          platform: data.platform || (typeof navigator !== 'undefined' ? navigator.platform : ''),
          hostname: data.hostname || '',
          uptime: data.uptime,
        });
      })
      .catch(() => {});
  }, [core]);

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
            <span className="text-gray-600">{inst.adapterId || ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
