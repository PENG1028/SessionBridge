'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { HostComponentProps } from './host-component-registry';
import type { NodeInfo } from '../core/core-types';
import { hostComponentRegistry } from './host-component-registry';

// ─── TerminalView ────────────────────────────────────────────────

/**
 * TerminalView — plugin-host-rendered terminal with xterm.js.
 *
 * Protocol:
 *  - process.spawn  { command, pty: true, cols, rows, targetNodeId? } → stream.chunk events
 *  - stream.replay   { sessionId, streamType, fromSeq }                → replay history
 *  - stream.write    { sessionId, streamType: "stdin", data }          → user input
 *  - process.resize  { sessionId, cols, rows }                         → PTY resize
 *  - process.signal  { sessionId, signal: "SIGTERM" }                  → terminate
 *
 * targetNodeId routing: CoreClient._callAs extracts targetNodeId from params
 * and places it at the action.request message level for topology routing.
 * Empty targetNodeId = local session.
 */
export function TerminalView({ core, config }: HostComponentProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [command, setCommand] = useState('bash');
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [targetNodeId, setTargetNodeId] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const unsubChunkRef = useRef<(() => void) | null>(null);
  const unsubStopRef = useRef<(() => void) | null>(null);
  const unsubConnectedRef = useRef<(() => void) | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Track last seen seq per stream type for replay-after-reconnect
  const lastSeqRef = useRef<{ stdout: number; stderr: number }>({ stdout: 0, stderr: 0 });

  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);

  // Fetch node list for targetNodeId selector
  useEffect(() => {
    core.call<{ nodes?: NodeInfo[] }>('node.list').then(r => setNodes(r?.nodes || [])).catch(() => {});
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
        const sid = sessionIdRef.current;
        if (sid) core.call('stream.write', { sessionId: sid, streamType: 'stdin', data: '\x0c' }).catch(() => {});
        else term.clear();
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
          const sid = sessionIdRef.current;
          if (sid) core.call('stream.write', { sessionId: sid, streamType: 'stdin', data: text }).catch(() => {});
        }).catch(() => {});
        return false;
      }
      return true;
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    // User input → stream.write with streamType
    term.onData(data => {
      const sid = sessionIdRef.current;
      if (sid) {
        core.call('stream.write', { sessionId: sid, streamType: 'stdin', data }).catch(() => {});
      }
    });

    // Container resize → fit + process.resize
    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
      const dims = fitAddon.proposeDimensions();
      const sid = sessionIdRef.current;
      if (sid && dims) {
        core.call('process.resize', { sessionId: sid, cols: dims.cols, rows: dims.rows }).catch(() => {});
      }
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

  // Cleanup subscriptions on unmount
  useEffect(() => {
    return () => {
      unsubChunkRef.current?.();
      unsubStopRef.current?.();
      unsubConnectedRef.current?.();
    };
  }, []);

  async function handleStart() {
    setError(null);
    setStatus('running');
    try {
      // Get initial terminal dimensions from fit addon
      const dims = fitRef.current?.proposeDimensions();
      const result = await core.call<{ sessionId: string; state: string }>('process.spawn', {
        command,
        pty: true,
        cols: dims?.cols ?? 80,
        rows: dims?.rows ?? 24,
        ...(targetNodeId ? { targetNodeId } : {}),
      });
      const sid = result.sessionId;
      setSessionId(sid);
      termRef.current?.writeln(`\r\n\x1b[32mSession ${sid.slice(0, 12)} started\x1b[0m`);
      subscribeSession(sid);
    } catch (err) {
      setStatus('error');
      setError(String(err));
      termRef.current?.writeln(`\r\n\x1b[91m[Error: ${err}]\x1b[0m`);
      setSessionId(null);
    }
  }

  async function handleStop() {
    const sid = sessionIdRef.current;
    if (!sid) return;
    try {
      await core.call('process.signal', { sessionId: sid, signal: 'SIGTERM' });
      termRef.current?.writeln(`\r\n\x1b[90m[Session terminated]\x1b[0m`);
    } catch (err) {
      termRef.current?.writeln(`\r\n\x1b[91m[Stop error: ${err}]\x1b[0m`);
    }
    unsubChunkRef.current?.();
    unsubChunkRef.current = null;
    unsubStopRef.current?.();
    unsubStopRef.current = null;
    setSessionId(null);
    setStatus('idle');
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
          <button onClick={handleStart} className="px-2 py-0.5 rounded bg-green-800 text-green-200 hover:bg-green-700 cursor-pointer">
            Start
          </button>
        )}
        {status === 'running' && (
          <>
            <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
            <span className="text-green-400 font-mono">{sessionId?.slice(0, 8)}</span>
            <button onClick={handleStop} className="px-2 py-0.5 rounded bg-red-800 text-red-200 hover:bg-red-700 cursor-pointer">
              Stop
            </button>
          </>
        )}
        {status === 'error' && error && (
          <span className="text-red-400 truncate max-w-[200px]">{error}</span>
        )}
      </div>

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

// ─── SessionListPanel ────────────────────────────────────────────

/**
 * SessionListPanel — lists active sessions with stop capability.
 */
export function SessionListPanel({ core, config }: HostComponentProps) {
  const [sessions, setSessions] = useState<Array<{ sessionId: string; state: string; command: string }>>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const result = await core.call<{ sessions: Array<{ sessionId: string; state: string; command: string }> }>('session.list');
      setSessions(result?.sessions || []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-gray-950">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800 bg-gray-900 text-xs">
        <span className="text-gray-400 font-medium">{config.title}</span>
        <button onClick={refresh} className="text-gray-500 hover:text-gray-300">Refresh</button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 text-xs">
        {loading && <div className="text-gray-600 p-2">Loading...</div>}
        {!loading && sessions.length === 0 && <div className="text-gray-600 p-2">No active sessions.</div>}
        {sessions.map(s => (
          <div key={s.sessionId} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-900 rounded">
            <span className={`w-1.5 h-1.5 rounded-full ${s.state === 'running' ? 'bg-green-500' : 'bg-gray-600'}`} />
            <span className="text-gray-300 flex-1">{s.command || 'shell'}</span>
            <span className="text-gray-500">{s.sessionId.slice(0, 8)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SystemInfoPanel ─────────────────────────────────────────────

/**
 * SystemInfoPanel — displays system info and node health from Core.
 * Calls: system.info, node.list, node.health
 */
export function SystemInfoPanel({ core, config }: HostComponentProps) {
  const [sysInfo, setSysInfo] = useState<Record<string, unknown> | null>(null);
  const [nodes, setNodes] = useState<Array<{ nodeId: string; status: string; name?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [sys, nodeResult] = await Promise.all([
        core.call<Record<string, unknown>>('system.info'),
        core.call<{ nodes: Array<{ nodeId: string; status: string; name?: string }> }>('node.list'),
      ]);
      setSysInfo(sys);
      setNodes(nodeResult?.nodes || []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-gray-950" data-testid="system-info-panel">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800 bg-gray-900 text-xs">
        <span className="text-gray-400 font-medium">{config.title}</span>
        <button onClick={refresh} className="text-gray-500 hover:text-gray-300">Refresh</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-xs space-y-3">
        {loading && <div className="text-gray-600">Loading...</div>}
        {error && <div className="text-red-400">Error: {error}</div>}

        {sysInfo && (
          <div>
            <div className="text-gray-500 uppercase tracking-wide mb-1 text-[10px]">System</div>
            <div className="bg-gray-900 rounded p-2 space-y-1">
              <Row label="OS" value={String(sysInfo.os || '')} />
              <Row label="Arch" value={String(sysInfo.arch || '')} />
              <Row label="Hostname" value={String(sysInfo.hostname || '')} />
              <Row label="Go Version" value={String(sysInfo.goVersion || '')} />
              <Row label="CPU Cores" value={String(sysInfo.numCPU || '')} />
            </div>
          </div>
        )}

        {nodes.length > 0 && (
          <div>
            <div className="text-gray-500 uppercase tracking-wide mb-1 text-[10px]">Nodes</div>
            <div className="bg-gray-900 rounded p-2 space-y-1">
              {nodes.map(n => (
                <div key={n.nodeId} className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${n.status === 'connected' || n.status === 'online' ? 'bg-green-500' : 'bg-gray-600'}`} />
                  <span className="text-gray-300">{n.name || n.nodeId}</span>
                  <span className="text-gray-500 ml-auto">{n.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-300 font-mono">{value}</span>
    </div>
  );
}

/**
 * Register plugin-host-rendered components from plugins/ manifests.
 * Call once at app initialization alongside registerBuiltinHostComponents().
 */
export function registerPluginHostComponents(): void {
  hostComponentRegistry.register('TerminalView', TerminalView);
  hostComponentRegistry.register('SessionListPanel', SessionListPanel);
  hostComponentRegistry.register('SystemInfoPanel', SystemInfoPanel);
}
