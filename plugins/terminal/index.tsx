'use client';

import { Terminal, Folder } from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
// Register terminal panel components (side-effect at module level)
import './panels';
import { useWorkbench } from '../../sdk';
import { useFocus } from '../../sdk';
import { ShellTerminal } from '../../sdk';
import { DirectoryPicker } from '../../sdk';
import { TitleBar } from '../../sdk';
import { getLastActiveDir, setLastActiveDir, getRestoreLastPath } from '../../sdk';
import { useCore, useCoreStatus } from '../../sdk';
import { useCoreErrors } from '../../sdk';
import { classifyCoreError } from '../../sdk';
import { TerminalInputBuffer, createDebouncedResize } from '../../sdk';
// Counter for generating distinguishable terminal labels
let _termLabelCounter = 0;
function nextTermLabel(baseCwd: string): string {
  _termLabelCounter++;
  // Extract the last directory name from CWD for context
  const dir = baseCwd.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
  const suffix = dir ? ` (${dir})` : '';
  return `Terminal #${_termLabelCounter}${suffix}`;
}


/** Parse OSC 7 data (file://HOST/PATH) into a normalized filesystem path. */
function parseOsc7(data: string): string | undefined {
  const prefix = 'file://';
  if (!data.startsWith(prefix)) return undefined;
  const rest = data.slice(prefix.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return undefined;
  let path = rest.slice(slash);
  try { path = decodeURIComponent(path); } catch (_e) { /* malformed, use raw */ }
  // Strip leading / before Windows drive letter: /C:/... → C:/...
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  path = path.replace(/\//g, '\\');
  return path || undefined;
}

const DEBUG_SURFACE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debugSurface');
function debugLog(...args: any[]) { if (DEBUG_SURFACE) console.log('[debugSurface]', ...args); }

/** Truncate a path from the middle so the drive/root and leaf name are both visible.
 *  e.g. "C:\\Users\\ZHP\\AppData\\Local\\Microsoft" → "C:\\Users\\ZHP\\...\\Microsoft" */
function middleTruncate(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path;
  const half = Math.floor((maxLen - 3) / 2);
  return path.slice(0, half) + '...' + path.slice(path.length - (maxLen - half - 3));
}

/**
 * TerminalView — complete terminal session management.
 *
 * Handles:
 * - PTY mode detection and display (pipe / conpty / console)
 * - Session creation (run.create with pty:true)
 * - Session restore on reconnect (run.info → run.attach)
 * - Windows path handling (F:/... preserved vs Linux projectCwd)
 * - CWD sync with file tree and bookmarks
 * - Node switch → session invalidation + reconnect
 * - Surface mode (replay terminal) – see _surfaceId
 */
export default function TerminalView({ _surfaceId: _surfaceIdProp, ..._unused }: { _surfaceId?: string } & Record<string, unknown>) {
  const { token, bindCurrentTabInstance, createInstance, projectCwd, onNavigatePath, absoluteCwd, onCwdChange, setTabTitle } = useWorkbench();
  const focus = useFocus();
  const core = useCore();
  const coreStatus = useCoreStatus();
  const coreErrors = useCoreErrors();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coreSessionId, setCoreSessionId] = useState<string | null>(null);
  const [ptyMode, setPtyMode] = useState<string | null>(null);
  const [sessionFresh, setSessionFresh] = useState(true);
  const autoCreated = useRef(false);
  const prevInstanceId = useRef<string | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);

  // ── Multi-device session attach ──────────────────────────────
  // When no instanceId is bound (new browser, new page), we query
  // Core for existing terminal sessions and let the user pick one,
  // instead of always creating a brand-new session.
  const [availableSessions, setAvailableSessions] = useState<Array<{
    runId: string;
    label: string;
    cwd: string;
    status: string;
  }> | null>(null);
  const [sessionPickerLoading, setSessionPickerLoading] = useState(false);

  // instanceId from focus context — reacts to tab/pane selection changes
  const instanceId = focus?.instanceId ?? undefined;
  const _surfaceId = _surfaceIdProp;

  // Debug: log mount/render with current props
  useEffect(() => {
    debugLog('TerminalView mount/update', { instanceId, coreSessionId, autoCreated: autoCreated.current });
  });

  // When instanceId changes (node switch), invalidate stale session state.
  // The old coreSessionId belongs to a different node context — force fresh create.
  useEffect(() => {
    if (prevInstanceId.current !== instanceId) {
      debugLog('TerminalView instanceId changed', { from: prevInstanceId.current, to: instanceId });
      prevInstanceId.current = instanceId;
      setCoreSessionId(null);
      autoCreated.current = false;
    }
  }, [instanceId]);

  const cwdRef = useRef(absoluteCwd);
  cwdRef.current = absoluteCwd;

  const createSession = useCallback(async () => {
    debugLog('TerminalView creating new session via createInstance', { cwd: cwdRef.current });
    setCreating(true);
    setSessionFresh(true);
    setError(null);
    try {
      const label = nextTermLabel(cwdRef.current);
	      const result = await createInstance(cwdRef.current, label, 'shell');
      if (result?.success && result?.instance) {
        const run = result.instance;
        const sessionId = result.sessionId;
        debugLog('TerminalView createInstance SUCCESS', { runId: run.id, sessionId });
        setCoreSessionId(sessionId ?? null);
        bindCurrentTabInstance(run.id, undefined);
        // Resize terminal to proper dimensions
        core.call('run.resize', { runId: run.id, cols: 80, rows: 24 }).catch(() => {});
        // Fetch ptyMode from run.info (createInstance doesn't return it)
        core.call<{ ptyMode?: string }>('run.info', { runId: run.id }).then(info => {
          if (info?.ptyMode) setPtyMode(info.ptyMode);
        }).catch(() => {});
        // OSC 7 prompt is now configured by Go Core via shell startup args
        // (see go-core/internal/executor/run_cmds.go osc7Prompt).
        // No stdin injection needed — terminal stays clean from the start.
      } else {
        throw new Error(result?.error || 'createInstance failed');
      }
    } catch (err: any) {
      debugLog('TerminalView create FAIL', { error: String(err) });
      const ce = classifyCoreError(err);
      setError(ce.message);
      coreErrors.reportError({ method: 'run.create', error: ce, timestamp: Date.now() });
    } finally {
      setCreating(false);
    }
  }, [createInstance, bindCurrentTabInstance, core]);

  const restoreSession = useCallback(async (runId: string) => {
    debugLog('TerminalView trying restore via run.info', { runId });
    const info = await core.call<{ state: string; sessionId: string; ptyMode?: string; process?: { state: string } }>('run.info', { runId });
    debugLog('TerminalView run.info response', { state: info?.state, sessionId: info?.sessionId });

    if (info?.sessionId && (info.state === 'running' || info.state === 'restorable')) {
      setPtyMode(info.ptyMode || null);
      setSessionFresh(false);
      setCoreSessionId(info.sessionId);
      bindCurrentTabInstance(runId, undefined);
      debugLog('TerminalView RESTORED existing session', { runId, sessionId: info.sessionId, state: info.state });
      return true;
    }
    return false;
  }, [core, bindCurrentTabInstance]);

  useEffect(() => {
    if (coreSessionId || coreStatus !== 'connected') return;
    if (autoCreated.current) return;
    autoCreated.current = true;

    if (instanceId) {
      restoreSession(instanceId).then(restored => {
        if (!restored) {
          debugLog('TerminalView restore failed, creating new');
          createSession();
        }
      }).catch(() => {
        debugLog('TerminalView restore threw, creating new');
        createSession();
      });
    } else {
      // Multi-device: query existing terminal sessions instead of
      // always creating a new one. This lets a second browser attach
      // to the same shell session already running on Core.
      debugLog('TerminalView no instanceId — checking for existing sessions');
      setSessionPickerLoading(true);
      core.call<{ runs?: any[]; entries?: any[] } | any[]>('run.list', {}).then(result => {
        const runs = Array.isArray(result) ? result : (result?.runs || result?.entries || []);
        const terminalRuns = runs.filter((r: any) =>
          (r.state === 'running' || r.state === 'restorable') &&
          ((r as any).pluginId === 'shell' || (r as any).pluginId === 'terminal' ||
           (r as any).kind === 'shell' || (r as any).kind === 'terminal')
        );
        if (terminalRuns.length > 0) {
          debugLog('TerminalView found existing sessions', terminalRuns.map((r: any) => r.runId));
          setAvailableSessions(terminalRuns.map((r: any) => ({
            runId: r.runId || r.sessionId || '',
            label: r.label || r.kind || r.runId?.slice(0, 12) || 'Terminal',
            cwd: r.metadata?.cwd || '.',
            status: r.state || 'unknown',
          })));
        } else {
          setAvailableSessions([]);
          debugLog('TerminalView no existing sessions, creating new');
          createSession();
        }
        setSessionPickerLoading(false);
      }).catch(() => {
        debugLog('TerminalView run.list failed, creating new');
        setSessionPickerLoading(false);
        createSession();
      });
    }
  }, [instanceId, core, coreSessionId, bindCurrentTabInstance, coreStatus, restoreSession, createSession]);

  // Sync cwd when projectCwd changes (node switch) — push into the unified source.
  // Guard: skip '.' as projectCwd since node.info may not return cwd,
  // and '.' would overwrite the real absoluteCwd from env.cwd.
  //
  // IMPORTANT: only react to projectCwd changes, NOT absoluteCwd changes.
  // If we include absoluteCwd in the dep array, then sendCd / OSC 7 updates
  // trigger this effect, which sees absoluteCwd !== projectCwd and reverts
  // the user's intentional cwd change back to projectCwd — the "flash then revert" bug.
  const onCwdChangeRef = useRef(onCwdChange);
  onCwdChangeRef.current = onCwdChange;
  const prevProjectCwdRef = useRef(projectCwd);

  useEffect(() => {
    if (projectCwd && projectCwd !== '.' && projectCwd !== prevProjectCwdRef.current) {
      prevProjectCwdRef.current = projectCwd;
      onCwdChangeRef.current(projectCwd);
    }
  }, [projectCwd]);

  /** Resolve a relative path (from picker, e.g. "./src/foo") to absolute using project root.
   *  Leaves already-absolute paths untouched so Windows paths (F:/...) aren't
   *  incorrectly joined onto a Linux projectCwd when connected to a remote relay. */
  const resolveRel = useCallback((rel: string): string => {
    const normalized = rel.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return normalized;
    const base = (projectCwd || '.').replace(/\\/g, '/').replace(/\/$/, '');
    const r = normalized.replace(/^\.\/?/, '');
    return r ? base + '/' + r : base;
  }, [projectCwd]);

  // ── Core session integration (all via onTerminalReady) ─────
  // ShellTerminal only provides the xterm instance. Everything below
  // — stream subscription, OSC 7, stdin buffering, history replay,
  // resize — is the plugin's responsibility.
  const inputBufRef = useRef<TerminalInputBuffer | null>(null);
  const debouncedResizeRef = useRef<ReturnType<typeof createDebouncedResize> | null>(null);
  const lastOsc7CwdRef = useRef('');

  const onTerminalReady = useCallback((term: any, _fitAddon: any) => {
    lastOsc7CwdRef.current = '';

    // ── 1. OSC 7 CWD tracking ──
    const osc7Disp = term.parser.registerOscHandler(7, (data: string) => {
      const cwd = parseOsc7(data);
      debugLog('OSC 7', { data, cwd });
      if (cwd && cwd !== lastOsc7CwdRef.current) {
        lastOsc7CwdRef.current = cwd;
        onCwdChange(cwd);
        setLastActiveDir(cwd);
        onNavigatePath?.(cwd);
      }
      return true;
    });


        // ── 1b. OSC 0 / OSC 2 tab title change ──
        // Programs like claude CLI send OSC 0 to set the terminal tab
        // title (e.g. "]0;Claude CLI"). We forward this to the
        // workbench state so the tab header updates in real time.
        const oscTitleDisp = term.parser.registerOscHandler(0, (data: string) => {
          if (data && setTabTitle) {
            // Strip icon sequence if present: OSC 0 can be "icon?;title?"
            const parts = data.split(';');
            const title = parts[parts.length - 1] || parts[0];
            const clean = title.replace(/[]/g, '').trim();
            if (clean) setTabTitle(clean);
          }
          return true;
        });
        // OSC 2 is title-only (no icon component)
        const oscTitleDisp2 = term.parser.registerOscHandler(2, (data: string) => {
          if (data && setTabTitle) {
            const clean = data.replace(/[]/g, '').trim();
            if (clean) setTabTitle(clean);
          }
          return true;
        });
    // ── 2. Stream subscription + live output → xterm ──
    core.call('stream.subscribe', { sessionId: coreSessionId, streamType: 'stdout' }).catch(() => {});
    core.call('stream.subscribe', { sessionId: coreSessionId, streamType: 'stderr' }).catch(() => {});
    const chunkHandler = (event: any) => {
      if (event.sessionId !== coreSessionId) return;
      if (event.streamType === 'stderr') {
        term.write('\x1b[91m' + event.data + '\x1b[0m');
      } else {
        term.write(event.data);
      }
    };
    core.on('stream.chunk', chunkHandler);

    // ── 3. Stdin buffer (fed by ShellTerminal's onUserInput) ──
    const buf = new TerminalInputBuffer({
      write: (data: string) => core.call('stream.write', { sessionId: coreSessionId, streamType: 'stdin', data }).catch(() => {}),
    });
    inputBufRef.current = buf;

    // ── 4. Debounced resize → Core ──
    const dr = createDebouncedResize({
      delayMs: 80,
      onResize: (cols: number, rows: number) => {
        core.call('process.resize', { sessionId: coreSessionId, cols, rows }).catch(() => {});
      },
    });
    debouncedResizeRef.current = dr;

    // ── 5. Connection banner + history replay ──
    if (sessionFresh) {
      term.writeln('\x1b[36mConnected to core stream...\x1b[0m');
    } else {
      term.writeln('\x1b[36mReconnected to existing session\x1b[0m');
    }
    // Always replay history regardless of fresh/restore.
    // For restored sessions, skip the first 20 events — they contain
    // terminal init handshake (CSI DA, cursor queries) whose raw bytes
    // render as garbage in a fresh xterm.js instance.
    const fromSeq = sessionFresh ? 0 : 20;
    core.call<{ events?: Array<{ data: string }> }>('stream.replay', {
      sessionId: coreSessionId, streamType: 'stdout', fromSeq,
    }).then(r => {
      if (r?.events) for (const evt of r.events) {
        if (evt.data) term.write(evt.data);
      }
    }).catch(() => {});
    core.call<{ events?: Array<{ data: string }> }>('stream.replay', {
      sessionId: coreSessionId, streamType: 'stderr', fromSeq,
    }).then(r => {
      if (r?.events) for (const evt of r.events) {
        if (evt.data) term.write('\x1b[91m' + evt.data + '\x1b[0m');
      }
    }).catch(() => {});
    // On restore, send Enter after replay so the shell prints a fresh prompt
    if (!sessionFresh) {
      setTimeout(() => buf.push('\r'), 300);
    }

    return {
      dispose: () => {
        osc7Disp.dispose();
        core.off('stream.chunk', chunkHandler);
        buf.dispose();
        dr.cancel();
        inputBufRef.current = null;
        debouncedResizeRef.current = null;
      },
    };
  }, [coreSessionId, core, sessionFresh, onCwdChange, onNavigatePath, setTabTitle]);

  // Feed stdin from ShellTerminal's local-echo handler
  const handleUserInput = useCallback((data: string) => {
    inputBufRef.current?.push(data);
  }, []);

  // Feed resize from ShellTerminal's ResizeObserver
  const handleResize = useCallback((cols: number, rows: number) => {
    debouncedResizeRef.current?.resize(cols, rows);
  }, []);

  // Send cd command to the terminal shell
  const sendCd = useCallback((path: string) => {
    const absPath = resolveRel(path);
    onCwdChange(absPath);
    setLastActiveDir(absPath);
    onNavigatePath?.(absPath);
    if (!coreSessionId) return;
    const qPath = absPath.replace(/\\/g, '/');
    const cdCmd = `cd "${qPath}"\r`;

    if (core?.isConnected) {
      core.call('stream.write', { sessionId: coreSessionId, streamType: 'stdin', data: cdCmd }).catch(err => coreErrors.reportError({ method: 'stream.write', error: classifyCoreError(err), timestamp: Date.now() }));
    }
  }, [coreSessionId, core, resolveRel, onNavigatePath, onCwdChange]);

  const handleSelectDir = useCallback((path: string) => {
    sendCd(path);
  }, [sendCd]);

  const handleOpenDirectoryPicker = useCallback(() => {
    setPickerOpen(true);
  }, []);

  if (!coreSessionId) {
    // ── Session picker: show existing terminal sessions to attach ──
    if (availableSessions && availableSessions.length > 0) {
      return (
        <div className="flex-1 flex flex-col min-h-0">
          <TitleBar title="TERMINAL">
            <button
              onClick={() => setPickerOpen(true)}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded text-gray-300 hover:text-white bg-gray-800/60 hover:bg-gray-700/80 shrink-0 transition-colors border border-gray-700"
              title="Browse directories"
            >
              <Folder className="w-3.5 h-3.5" />
              <span className="text-[11px] font-mono max-w-[160px] truncate" title={absoluteCwd}>{middleTruncate(absoluteCwd || '.', 32)}</span>
            </button>
          </TitleBar>
          <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] min-h-0 gap-4 px-6">
            <Terminal className="w-8 h-8 text-gray-700 shrink-0" />
            <span className="text-[10px] text-gray-500 font-bold tracking-wider">EXISTING SESSIONS</span>
            <div className="w-full max-w-sm space-y-1.5">
              {availableSessions.map(s => (
                <div key={s.runId} className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setAvailableSessions(null);
                      restoreSession(s.runId);
                    }}
                    className="flex-1 flex items-center gap-3 px-3 py-2 rounded bg-[#151515] border border-gray-700 hover:border-purple-500/50 hover:bg-[#1a1a1a] transition-colors text-left"
                  >
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-gray-200 truncate font-medium">{s.label}</div>
                      <div className="text-[9px] text-gray-600 font-mono truncate">{s.cwd}</div>
                    </div>
                    <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-mono">
                      {s.runId.slice(0, 8)}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      core.call('run.stop', { runId: s.runId, signal: 'SIGTERM', tree: true }).then(() => {
                        setAvailableSessions(prev => prev?.filter(x => x.runId !== s.runId) ?? null);
                      }).catch(() => {});
                    }}
                    className="shrink-0 px-2 py-2 rounded bg-red-900/20 border border-red-800/30 text-red-400 hover:bg-red-800/40 hover:text-red-300 transition-colors text-[9px] font-mono"
                    title={`Stop ${s.runId.slice(0, 8)}`}
                  >
                    Stop
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => { setAvailableSessions(null); createSession(); }}
              className="text-[10px] text-gray-600 hover:text-gray-400 transition-colors underline underline-offset-2"
            >
              Start new terminal instead
            </button>
          </div>

          <DirectoryPicker
            open={pickerOpen}
            onClose={() => setPickerOpen(false)}
            onSelect={handleSelectDir}
            absoluteCwd={absoluteCwd}
            initialPath="."
            title="Directory Browser"
          />
        </div>
      );
    }

    return (
      <div className="flex-1 flex flex-col min-h-0">
        <TitleBar title="TERMINAL">
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded text-gray-300 hover:text-white bg-gray-800/60 hover:bg-gray-700/80 shrink-0 transition-colors border border-gray-700"
            title="Browse directories"
          >
            <Folder className="w-3.5 h-3.5" />
            <span className="text-[11px] font-mono max-w-[160px] truncate" title={absoluteCwd}>{middleTruncate(absoluteCwd || '.', 32)}</span>
          </button>
        </TitleBar>
        <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] min-h-0 gap-3">
          <Terminal className="w-8 h-8 text-gray-700 shrink-0" />
          {error ? (
            <span className="text-[10px] text-red-400 px-4 text-center">{error}</span>
          ) : (
            <span className="text-[10px] text-gray-600">
              {sessionPickerLoading ? 'Looking for existing sessions...' : (creating ? 'Creating terminal...' : 'Starting...')}
            </span>
          )}
        </div>

        <DirectoryPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={handleSelectDir}
          absoluteCwd={absoluteCwd}
          initialPath="."
          title="Directory Browser"
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <TitleBar title="TERMINAL">
        {ptyMode && (
          <span
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded mr-1 shrink-0 ${
              ptyMode === 'pipe'
                ? 'text-gray-500 bg-gray-900/30'
                : 'text-emerald-400 bg-emerald-900/20'
            }`}
            title={`PTY mode: ${ptyMode}`}
          >
            {ptyMode.toUpperCase()}
          </span>
        )}
        <button
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-gray-300 hover:text-white bg-gray-800/60 hover:bg-gray-700/80 shrink-0 transition-colors border border-gray-700"
          title="Change directory"
        >
          <Folder className="w-3.5 h-3.5" />
          <span className="text-[11px] font-mono max-w-[160px] truncate" title={absoluteCwd}>{middleTruncate(absoluteCwd || '.', 32)}</span>
        </button>
      </TitleBar>

      <div className="flex-1 flex flex-col min-h-0">
        <ShellTerminal key={coreSessionId ?? 'pending'} onTerminalReady={onTerminalReady} onResize={handleResize} onUserInput={handleUserInput} onOpenDirectoryPicker={handleOpenDirectoryPicker} />
      </div>

      <DirectoryPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleSelectDir}
        absoluteCwd={absoluteCwd}
        initialPath="."
        title="Terminal Directory"
      />
    </div>
  );
}
