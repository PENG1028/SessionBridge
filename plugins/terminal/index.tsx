'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { HostComponentProps } from '../../app/console/plugin-host/host-component-registry';
import type { NodeInfo, RunInfo } from '../../app/console/core/core-types';
import { TerminalInputBuffer, createDebouncedResize } from '../../app/console/core/terminal-input-buffer';

export function TerminalView({ core, config }: HostComponentProps) {
  // Guard: if rendered outside PluginHost (e.g. sidebar panel with wrong props),
  // show a fallback instead of crashing the entire UI.
  if (!config) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950 text-gray-500 text-xs">
        Terminal — not available in this context
      </div>
    );
  }
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [command, setCommand] = useState('bash');
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [targetNodeId, setTargetNodeId] = useState('');
  const [existingRuns, setExistingRuns] = useState<RunInfo[]>([]);
  const [refreshingRuns, setRefreshingRuns] = useState(false);
  const [showRuns, setShowRuns] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const unsubChunkRef = useRef<(() => void) | null>(null);
  const unsubStopRef = useRef<(() => void) | null>(null);
  const unsubConnectedRef = useRef<(() => void) | null>(null);
  const inputBufRef = useRef<TerminalInputBuffer | null>(null);
  const debouncedResizeRef = useRef<ReturnType<typeof createDebouncedResize> | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  // Track last seen seq per stream type for replay-after-reconnect
  const lastSeqRef = useRef<{ stdout: number; stderr: number }>({ stdout: 0, stderr: 0 });

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { runIdRef.current = runId; }, [runId]);

  // Fetch node list for targetNodeId selector + initial runs
  useEffect(() => {
    core.call<{ nodes?: NodeInfo[] }>('node.list').then(r => setNodes(r?.nodes || [])).catch(() => {});
    handleRefreshRuns();
  }, [core]);

  // Initialize xterm.js once
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: '"Cascadia Mono", "JetBrains Mono", monospace',
      lineHeight: 1.0,
      allowTransparency: true,
      convertEol: true,
      scrollback: 5000,
      theme: {
        background: '#0a0a0a',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
        selectionBackground: '#404040',
        black: '#000000', red: '#e06c75', green: '#98c379', yellow: '#d19a66',
        blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
        brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379',
        brightYellow: '#d19a66', brightBlue: '#61afef', brightMagenta: '#c678dd',
        brightCyan: '#56b6c2', brightWhite: '#ffffff',
      },
    });

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const { key, ctrlKey, shiftKey } = e;
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown','Home','End'].includes(key)) { e.preventDefault(); return true; }
      if (key === 'Tab') { e.preventDefault(); return true; }
      if (ctrlKey && key === 'c') {
        const sel = term.getSelection();
        if (sel) { navigator.clipboard.writeText(sel).catch(() => {}); e.preventDefault(); return false; }
        return true;
      }
      if (ctrlKey && key === 'l') {
        e.preventDefault();
        if (inputBufRef.current) { inputBufRef.current.push('\x0c'); } else { term.clear(); }
        return false;
      }
      if (ctrlKey && shiftKey && key === 'C') {
        const sel = term.getSelection();
        if (sel) navigator.clipboard.writeText(sel).catch(() => {});
        e.preventDefault(); return false;
      }
      if ((ctrlKey && key === 'v') || (ctrlKey && shiftKey && key === 'V') || (shiftKey && key === 'Insert')) {
        e.preventDefault();
        navigator.clipboard.readText().then(text => {
          inputBufRef.current?.push(text);
        }).catch(() => {});
        return false;
      }
      return true;
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    // User input → input buffer (batched stream.write)
    term.onData(data => {
      inputBufRef.current?.push(data);
    });

    // Container resize → fit + debounced process.resize
    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
      const dims = fitAddon.proposeDimensions();
      if (dims) debouncedResizeRef.current?.resize(dims.cols, dims.rows);
    });
    ro.observe(containerRef.current);

    termRef.current = term;
    fitRef.current = fitAddon;

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [core]);

  // Wire up stream events for a running session
  const subscribeSession = useCallback((sid: string) => {
    // Subscribe to stdout/stderr push routes (registers this WS conn in connRegistry)
    core.call('stream.subscribe', { sessionId: sid, streamType: 'stdout' }).catch(() => {});
    core.call('stream.subscribe', { sessionId: sid, streamType: 'stderr' }).catch(() => {});

    // Replay existing stdout
    core.call<{ events?: Array<{ data: string; seq?: number }> }>('stream.replay', {
      sessionId: sid, streamType: 'stdout', fromSeq: 0,
    }).then(r => {
      if (r?.events) for (const evt of r.events) {
        if (evt.data) termRef.current?.write(evt.data);
        if (evt.seq && evt.seq > lastSeqRef.current.stdout) lastSeqRef.current.stdout = evt.seq;
      }
    }).catch(() => {});

    // Replay existing stderr (highlight in red)
    core.call<{ events?: Array<{ data: string; seq?: number }> }>('stream.replay', {
      sessionId: sid, streamType: 'stderr', fromSeq: 0,
    }).then(r => {
      if (r?.events) for (const evt of r.events) {
        if (evt.data) termRef.current?.write('\x1b[91m' + evt.data + '\x1b[0m');
        if (evt.seq && evt.seq > lastSeqRef.current.stderr) lastSeqRef.current.stderr = evt.seq;
      }
    }).catch(() => {});

    // Live stream.chunk events (pushed via connRegistry)
    const unsub = core.on('stream.chunk', (event: any) => {
      if (event.sessionId === sessionIdRef.current) {
        // Track seq for reconnect replay
        if (event.streamType === 'stdout' && typeof event.eventSeq === 'number') {
          lastSeqRef.current.stdout = event.eventSeq;
        } else if (event.streamType === 'stderr' && typeof event.eventSeq === 'number') {
          lastSeqRef.current.stderr = event.eventSeq;
        }
        if (event.streamType === 'stderr') {
          termRef.current?.write('\x1b[91m' + event.data + '\x1b[0m');
        } else {
          termRef.current?.write(event.data);
        }
      }
    });
    unsubChunkRef.current = unsub;

    // Detect session stop from remote (e.g. process exit)
    const unsubStop = core.on('session.stopped', (event: any) => {
      if (event.sessionId === sessionIdRef.current) {
        termRef.current?.writeln('\r\n\x1b[90m[Session stopped]' + (event.reason ? ': ' + event.reason : '') + '\x1b[0m');
        setStatus('idle');
        setSessionId(null);
        unsubChunkRef.current?.();
        unsubChunkRef.current = null;
      }
    });
    unsubStopRef.current = unsubStop;

    // Listen for WS reconnect — re-subscribe to push routes and replay missed data
    const unsubConnected = core.on('connected', () => {
      const currentSid = sessionIdRef.current;
      if (!currentSid) return;
      // Re-register push route for this session on the new WS connection
      core.call('stream.subscribe', { sessionId: currentSid, streamType: 'stdout' }).catch(() => {});
      core.call('stream.subscribe', { sessionId: currentSid, streamType: 'stderr' }).catch(() => {});
      // Replay from last known seq
      const ls = lastSeqRef.current;
      core.call<{ events?: Array<{ data: string; seq?: number }> }>('stream.replay', {
        sessionId: currentSid, streamType: 'stdout', fromSeq: ls.stdout + 1,
      }).then(r => {
        if (r?.events) for (const evt of r.events) {
          if (evt.data) termRef.current?.write(evt.data);
          if (evt.seq && evt.seq > lastSeqRef.current.stdout) lastSeqRef.current.stdout = evt.seq;
        }
      }).catch(() => {});
      core.call<{ events?: Array<{ data: string; seq?: number }> }>('stream.replay', {
        sessionId: currentSid, streamType: 'stderr', fromSeq: ls.stderr + 1,
      }).then(r => {
        if (r?.events) for (const evt of r.events) {
          if (evt.data) termRef.current?.write('\x1b[91m' + evt.data + '\x1b[0m');
          if (evt.seq && evt.seq > lastSeqRef.current.stderr) lastSeqRef.current.stderr = evt.seq;
        }
      }).catch(() => {});
    });
    unsubConnectedRef.current = unsubConnected;
  }, [core]);

  // Create input buffer + debounced resize when session is active
  useEffect(() => {
    if (!sessionId) return;
    const buf = new TerminalInputBuffer({
      write: (data) => core.call('stream.write', { sessionId, streamType: 'stdin', data }).catch(() => {}),
    });
    inputBufRef.current = buf;
    const dr = createDebouncedResize({
      delayMs: 80,
      onResize: (cols, rows) => { core.call('process.resize', { sessionId, cols, rows }).catch(() => {}); },
    });
    debouncedResizeRef.current = dr;
    return () => {
      buf.dispose();
      dr.cancel();
      inputBufRef.current = null;
      debouncedResizeRef.current = null;
    };
  }, [sessionId, core]);

  // Cleanup subscriptions on unmount
  useEffect(() => {
    return () => {
      unsubChunkRef.current?.();
      unsubStopRef.current?.();
      unsubConnectedRef.current?.();
      inputBufRef.current?.dispose();
      debouncedResizeRef.current?.cancel();
    };
  }, []);

  async function handleStart() {
    setError(null);
    setStatus('running');
    try {
      const dims = fitRef.current?.proposeDimensions();
      const params: Record<string, unknown> = {
        kind: 'terminal',
        label: command,
        pluginId: 'terminal',
        command,
        pty: true,
        cols: dims?.cols ?? 80,
        rows: dims?.rows ?? 24,
        policy: {
          onDisconnect: 'keep_running',
          onCoreShutdown: 'terminate',
          persistHistory: true,
          restartRestore: false,
        },
        metadata: { source: 'system-ui-terminal' },
      };
      if (targetNodeId) params.targetNodeId = targetNodeId;

      const result = await core.call<RunInfo>('run.create', params);
      const rid = result.runId;
      const sid = result.sessionId;
      setRunId(rid);
      setSessionId(sid);
      termRef.current?.writeln(`\r\n\x1b[32mSession ${sid.slice(0, 12)} started (run: ${rid.slice(0, 12)})\x1b[0m`);
      subscribeSession(sid);
    } catch (err) {
      setStatus('error');
      setError(String(err));
      termRef.current?.writeln(`\r\n\x1b[91m[Error: ${err}]\x1b[0m`);
      setSessionId(null);
      setRunId(null);
    }
  }

  async function handleStop() {
    const sid = sessionIdRef.current;
    const rid = runIdRef.current;
	      if (!sid) return;

    // Prefer run.stop when runId is available; fallback to process.signal for legacy sessions
    if (rid) {
      try {
        await core.call('run.stop', { runId: rid, signal: 'SIGTERM', ...(targetNodeId ? { targetNodeId } : {}) });
        termRef.current?.writeln(`\r\n\x1b[90m[Run stopped]\x1b[0m`);
      } catch (err) {
        // Best-effort: fallback to process.signal
        try {
          await core.call('process.signal', { sessionId: sid, signal: 'SIGTERM', ...(targetNodeId ? { targetNodeId } : {}) });
        } catch { /* best-effort */ }
        termRef.current?.writeln(`\r\n\x1b[91m[Stop error: ${err}]\x1b[0m`);
      }
    } else {
      // Legacy fallback: no runId, use process.signal directly
      try {
        await core.call('process.signal', { sessionId: sid, signal: 'SIGTERM', ...(targetNodeId ? { targetNodeId } : {}) });
        termRef.current?.writeln(`\r\n\x1b[90m[Session terminated]\x1b[0m`);
      } catch (err) {
        termRef.current?.writeln(`\r\n\x1b[91m[Stop error: ${err}]\x1b[0m`);
      }
    }

    unsubChunkRef.current?.();
    unsubChunkRef.current = null;
    unsubStopRef.current?.();
    unsubStopRef.current = null;
    unsubConnectedRef.current?.();
    unsubConnectedRef.current = null;
    setSessionId(null);
    setRunId(null);
    setStatus('idle');
  }

  // ── attach ──
  async function handleAttach(rid: string) {
    setError(null);
    setStatus('running');
    try {
      const result = await core.call<{ sessionId: string; state: string; kind?: string; pluginId?: string; process?: { command?: string } }>('run.attach', { runId: rid, replay: false, ...(targetNodeId ? { targetNodeId } : {}) });
      const sid = result.sessionId;
      if (!sid) throw new Error('run.attach returned no sessionId');
      setRunId(rid);
      if (result.state === 'orphaned') {
        termRef.current?.writeln('\r\n\x1b[33m[Run ' + rid.slice(0, 12) + ' is orphaned — process no longer exists. Viewing historical data only.]\x1b[0m');
        setStatus('idle');
        setSessionId(null);
        setRunId(null);
        return;
      }
      if (result.state === 'restorable') {
        termRef.current?.writeln('\r\n\x1b[34m[Run ' + rid.slice(0, 12) + ' is restorable — process not running. Re-create run to resume.]\x1b[0m');
        setStatus('idle');
        setSessionId(null);
        setRunId(null);
        return;
      }
      setSessionId(sid);
      termRef.current?.writeln('\r\n\x1b[32mAttached to ' + (result.process?.command || result.kind || 'run') + ' ' + rid.slice(0, 12) + ' (session: ' + sid.slice(0, 12) + ')\x1b[0m');
      subscribeSession(sid);
    } catch (err) {
      setStatus('error');
      setError(String(err));
      termRef.current?.writeln('\r\n\x1b[91m[Attach error: ' + err + ']\x1b[0m');
      setSessionId(null);
      setRunId(null);
    }
  }

  // ── refresh existing runs ──
  async function handleRefreshRuns() {
    setRefreshingRuns(true);
    try {
      const params: Record<string, unknown> = { kind: 'terminal' };
      if (targetNodeId) params.targetNodeId = targetNodeId;
      const result = await core.call<{ runs: RunInfo[] }>('run.list', params);
      setExistingRuns(result?.runs || []);
    } catch {
      // silent
    }
    setRefreshingRuns(false);
  }

  const nodeOptions = [
    { id: '', label: 'Local' },
    ...nodes.map(n => ({ id: n.nodeId, label: n.name || n.nodeId })),
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-gray-950 relative">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 bg-gray-900 text-xs shrink-0 z-10">
        <span className="text-gray-400 font-medium">{config.title}</span>
        <span className="text-gray-600">|</span>

        <input
          className="bg-gray-800 text-gray-200 px-2 py-0.5 rounded w-28 font-mono"
          value={command}
          onChange={e => setCommand(e.target.value)}
          placeholder="command"
          disabled={status === 'running'}
        />

        <select
          className="bg-gray-800 text-gray-200 px-2 py-0.5 rounded text-xs"
          value={targetNodeId}
          onChange={e => setTargetNodeId(e.target.value)}
          disabled={status === 'running'}
        >
          {nodeOptions.map(n => (
            <option key={n.id} value={n.id}>{n.label}</option>
          ))}
        </select>

        {status === 'idle' && (
          <>
            <button onClick={handleStart} className="px-2 py-0.5 rounded bg-green-800 text-green-200 hover:bg-green-700 cursor-pointer">
              Start
            </button>
            <button
              onClick={() => { setShowRuns(!showRuns); if (!showRuns) handleRefreshRuns(); }}
              className="px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700 cursor-pointer"
            >
              {showRuns ? 'Hide Runs' : `Runs${existingRuns.length > 0 ? ` (${existingRuns.length})` : ''}`}
            </button>
          </>
        )}
        {status === 'running' && (
          <>
            <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
            <span className="text-green-400 font-mono" title={runId || sessionId || ''}>
              run: {(runId || sessionId)?.slice(0, 8)}
            </span>
            <button onClick={handleStop} className="px-2 py-0.5 rounded bg-red-800 text-red-200 hover:bg-red-700 cursor-pointer">
              Stop
            </button>
          </>
        )}
        {status === 'error' && error && (
          <span className="text-red-400 truncate max-w-[200px]">{error}</span>
        )}
      </div>

      {/* Existing runs dropdown */}
      {showRuns && status === 'idle' && (
        <div className="px-3 py-2 border-b border-gray-800 bg-gray-900/50 max-h-[200px] overflow-y-auto">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-500">
              {existingRuns.length > 0 ? `${existingRuns.length} existing run(s)` : 'No existing terminal runs'}
            </span>
            <button
              onClick={handleRefreshRuns}
              disabled={refreshingRuns}
              className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 hover:bg-gray-700"
            >
              {refreshingRuns ? '...' : 'Refresh'}
            </button>
          </div>
          {existingRuns.length > 0 && (
            <div className="space-y-1">
              {existingRuns.map(r => {
                const stateColor =
                  r.state === 'running' ? 'text-green-500' :
                  r.state === 'orphaned' ? 'text-yellow-500' :
                  r.state === 'restorable' ? 'text-blue-400' :
                  r.state === 'stopped' || r.state === 'exited' ? 'text-gray-500' :
                  'text-red-400';
                const canAttach = r.state === 'running' || r.state === 'orphaned' || r.state === 'restorable';
                return (
                <div key={r.runId} className="flex items-center justify-between text-[11px] px-2 py-1 bg-gray-900 rounded">
                  <span className="text-gray-400 truncate flex-1">
                    {r.label || r.process?.command || r.runId?.slice(0, 8) || 'untitled'}
                    <span className={`ml-2 ${stateColor}`}>
                      [{r.state}]
                    </span>
                  </span>
                  {canAttach && (
                    <button
                      onClick={() => handleAttach(r.runId)}
                      className="px-2 py-0.5 rounded bg-gray-700 text-gray-200 hover:bg-gray-600 ml-2"
                    >
                      {r.state === 'running' ? 'Attach' : 'View'}
                    </button>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* xterm container */}
      <div ref={containerRef} className="flex-1 min-h-0" />

      {/* Idle overlay */}
      {status === 'idle' && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-gray-600 italic text-sm">
            Configure command and click Start to launch a terminal session.
          </div>
        </div>
      )}
    </div>
  );
}
// Also export as default for dynamic import
export default TerminalView;
