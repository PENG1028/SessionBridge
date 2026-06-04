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
  const { token, bindCurrentTabInstance, createInstance, projectCwd, onNavigatePath, absoluteCwd, onCwdChange } = useWorkbench();
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
      const result = await createInstance(cwdRef.current, 'Terminal', 'shell');
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
      createSession();
    }
  }, [instanceId, core, coreSessionId, bindCurrentTabInstance, coreStatus, restoreSession, createSession]);

  // Sync cwd when projectCwd changes (node switch) — push into the unified source.
  // Guard: skip '.' as projectCwd since node.info may not return cwd,
  // and '.' would overwrite the real absoluteCwd from env.cwd.
  useEffect(() => {
    if (projectCwd && absoluteCwd !== projectCwd && projectCwd !== '.') {
      onCwdChange(projectCwd);
    }
  }, [projectCwd, absoluteCwd, onCwdChange]);

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
            <span className="text-[10px] text-gray-600">{creating ? 'Creating terminal...' : 'Starting...'}</span>
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
        <ShellTerminal core={core} coreSessionId={coreSessionId} fresh={sessionFresh} onOpenDirectoryPicker={handleOpenDirectoryPicker} />
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
