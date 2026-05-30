'use client';

import { Terminal, Folder } from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useWorkbench } from '../workbench/workbench-context';
import ShellTerminal from '../../shell-terminal';
import { DirectoryPicker } from '../dialogs/directory-picker';
import { TitleBar } from '../shared/title-bar';
import { getLastActiveDir, getRestoreLastPath, setLastActiveDir } from '../../lib/path-bookmarks';
import { useCore, useCoreStatus } from '../core/core-client-provider';
import { TerminalView as PluginHostTerminalView } from '../plugin-host/plugin-components';

const DEBUG_SURFACE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debugSurface');
function debugLog(...args: any[]) { if (DEBUG_SURFACE) console.log('[debugSurface]', ...args); }

interface TerminalViewProps {
  instanceId?: string;
  _surfaceId?: string;
}

export function TerminalView({ instanceId }: TerminalViewProps) {
  const { token, bindCurrentTabInstance, projectCwd, homeDir, onNavigatePath, absoluteCwd, onCwdChange } = useWorkbench();
  const core = useCore();
  const coreStatus = useCoreStatus();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coreSessionId, setCoreSessionId] = useState<string | null>(null);
  const [ptyMode, setPtyMode] = useState<string | null>(null);
  const [sessionFresh, setSessionFresh] = useState(true);
  const autoCreated = useRef(false);
  const prevInstanceId = useRef<string | undefined>(instanceId);
  const [pickerOpen, setPickerOpen] = useState(false);

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
    // Always create a fresh terminal session on the active target node.
    // CoreClient injects targetNodeId automatically so run.create goes
    // to the correct node — no need to check for detached runs here.
    debugLog('TerminalView creating new session via run.create', { cwd: cwdRef.current });
    setCreating(true);
    setSessionFresh(true);
    setError(null);
    return core.call<{ runId: string; sessionId: string; ptyMode?: string }>('run.create', {
      pty: true,
      cols: 80,
      rows: 24,
      cwd: cwdRef.current,
      label: 'Terminal',
      pluginId: 'shell',
      policy: { restartRestore: true },
    }).then(run => {
      if (run?.sessionId) {
        debugLog('TerminalView run.create SUCCESS', { runId: run.runId, sessionId: run.sessionId, ptyMode: run.ptyMode });
        setPtyMode(run.ptyMode || null);
        setCoreSessionId(run.sessionId);
        bindCurrentTabInstance(run.runId, undefined);
      } else {
        throw new Error('run.create returned no sessionId');
      }
    }).catch(err => {
      debugLog('TerminalView create FAIL', { error: String(err) });
      setError(String(err));
      throw err;
    }).finally(() => {
      setCreating(false);
    });
  }, [core, bindCurrentTabInstance]);

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
  useEffect(() => {
    if (projectCwd && absoluteCwd !== projectCwd) {
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
      core.call('stream.write', { sessionId: coreSessionId, streamType: 'stdin', data: cdCmd }).catch(() => {});
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
            <span className="text-[11px] font-mono">{absoluteCwd}</span>
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
          <span className="text-[11px] font-mono max-w-[160px] truncate">{absoluteCwd}</span>
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

/** Wrapper for plugin-host TerminalView, used by view registration (register-core-views.ts).
 *  Bridges useCore() into the HostComponentProps shape that PluginHostTerminalView expects. */
export function TerminalViewWrapper() {
  const core = useCore();
  return (
    <PluginHostTerminalView
      core={core}
      config={{ componentId: 'TerminalView', pluginId: 'terminal', title: 'Terminal' }}
      container={{ surface: 'main.editor', width: 0, height: 0 }}
    />
  );
}
