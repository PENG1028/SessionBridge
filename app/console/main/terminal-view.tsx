'use client';

import { Terminal, Folder } from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useWorkbench } from '../workbench/workbench-context';
import { useCore } from '../core/core-client-provider';
import ShellTerminal from '../../shell-terminal';
import { DirectoryPicker } from '../dialogs/directory-picker';
import { TitleBar } from '../shared/title-bar';
import { getLastActiveDir, getRestoreLastPath, setLastActiveDir } from '../../lib/path-bookmarks';

const DEBUG_SURFACE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debugSurface');
function debugLog(...args: any[]) { if (DEBUG_SURFACE) console.log('[debugSurface]', ...args); }

interface TerminalViewProps {
  instanceId?: string;
  _surfaceId?: string;
}

/** Envelope helper — same format as ShellTerminal. */
function env(type: string, body: Record<string, unknown> = {}) {
  return JSON.stringify({ v: 1, ts: Date.now(), type, body });
}

export function TerminalView({ instanceId, _surfaceId }: TerminalViewProps) {
  const { wsUrl, token, createInstance, bindCurrentTabInstance, ensureSurfacePublished, projectCwd, homeDir, activeNodeWsUrl } = useWorkbench();
  const core = useCore();
  // Compute API base URL: remote node gets proxied, local uses empty (same-origin)
  const apiBaseUrl = activeNodeWsUrl !== wsUrl ? activeNodeWsUrl.replace(/^ws/, 'http') : '';
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coreSessionId, setCoreSessionId] = useState<string | null>(null);
  const autoCreated = useRef(false);
  const surfacePublished = useRef(false);
  const [cwd, setCwd] = useState(() => {
    if (typeof window !== 'undefined' && getRestoreLastPath()) {
      return getLastActiveDir() || homeDir || projectCwd || '.';
    }
    return homeDir || projectCwd || '.';
  });
  const [pickerOpen, setPickerOpen] = useState(false);

  // Debug: log mount/render with current props
  useEffect(() => {
    debugLog('TerminalView mount/update', { instanceId, _surfaceId, autoCreated: autoCreated.current, surfacePublished: surfacePublished.current });
  });

  // Auto-create a new shell instance when no instanceId
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  useEffect(() => {
    if (instanceId || autoCreated.current) return;
    autoCreated.current = true;
    debugLog('TerminalView auto-creating instance', { cwd: cwdRef.current, coreConnected: core?.isConnected });
    setCreating(true);
    setError(null);
    (async () => {
      try {
        // Prefer CoreClient run.create when core is connected
        if (core?.isConnected) {
          const run = await core.call<{ runId: string; sessionId: string }>('run.create', {
            command: 'bash',
            pty: true,
            cols: 80,
            rows: 24,
            cwd: cwdRef.current,
            label: 'Terminal',
            pluginId: 'shell',
          });
          if (run?.runId && run?.sessionId) {
            debugLog('TerminalView core.run.create SUCCESS', { runId: run.runId, sessionId: run.sessionId });
            setCoreSessionId(run.sessionId);
            bindCurrentTabInstance(run.runId, undefined);
            return;
          }
        }
        // Fallback: relay createInstance
        const result = await createInstance(cwdRef.current, 'Terminal', 'shell');
        if (result?.instance?.id) {
          debugLog('TerminalView auto-create SUCCESS', { instanceId: result.instance.id, surfaceId: result.surface?.surfaceId });
          bindCurrentTabInstance(result.instance.id, result.surface);
        } else {
          debugLog('TerminalView auto-create FAIL', { error: result?.error });
          setError(result?.error || 'Failed to create terminal instance');
        }
      } catch (err) {
        debugLog('TerminalView auto-create EXCEPTION', { error: String(err) });
        setError(String(err));
      } finally {
        setCreating(false);
      }
    })();
  }, [instanceId, core, createInstance, bindCurrentTabInstance, projectCwd]);

  // Publish surface for tabs that already have an instanceId (e.g. restored
  // from localStorage or synced via workbench.tabs). Without this, other
  // devices cannot discover the terminal via surface.subscribeNode.
  useEffect(() => {
    if (instanceId && !_surfaceId && !surfacePublished.current) {
      debugLog('TerminalView triggering ensureSurfacePublished', { instanceId, _surfaceId });
      if (ensureSurfacePublished(instanceId)) {
        debugLog('TerminalView ensureSurfacePublished OK', { instanceId });
        surfacePublished.current = true;
      } else {
        debugLog('TerminalView ensureSurfacePublished returned false', { instanceId });
      }
    }
  }, [instanceId, _surfaceId, ensureSurfacePublished]);

  // Sync cwd when projectCwd changes — but only if RESTORE is OFF
  // or there's no saved last-active directory.
  useEffect(() => {
    if (projectCwd) {
      if (getRestoreLastPath() && getLastActiveDir()) return;
      setCwd(projectCwd);
    }
  }, [projectCwd]);

  /** Resolve a relative path (from picker, e.g. "./src/foo") to absolute using project root.
   *  Leaves already-absolute paths untouched so Windows paths (F:/...) aren't
   *  incorrectly joined onto a Linux projectCwd when connected to a remote relay. */
  const resolveRel = useCallback((rel: string): string => {
    // Already absolute on Unix or Windows — use as-is
    const normalized = rel.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return normalized;
    const base = (projectCwd || '.').replace(/\\/g, '/').replace(/\/$/, '');
    const r = normalized.replace(/^\.\/?/, '');
    return r ? base + '/' + r : base;
  }, [projectCwd]);

  // Send cd command to the terminal shell
  const sendCd = useCallback((path: string) => {
    const absPath = resolveRel(path);
    setCwd(absPath);
    setLastActiveDir(absPath);
    if (!instanceId && !coreSessionId) return;
    const qPath = absPath.replace(/\\/g, '/');
    const cdCmd = `cd "${qPath}"\r`;

    // CoreClient mode: use stream.write
    if (core?.isConnected && coreSessionId) {
      core.call('stream.write', { sessionId: coreSessionId, data: cdCmd }).catch(() => {});
      return;
    }

    // Fallback: transient WebSocket for relay
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      const helloBody: Record<string, unknown> = { role: 'browser', features: ['cd-helper'] };
      if (token) helloBody.token = token;
      ws.send(env('hello', helloBody));
      ws.send(env('shell.input', { data: cdCmd, instanceId }));
      setTimeout(() => ws.close(), 500);
    };
    ws.onerror = () => {};
  }, [instanceId, coreSessionId, core, wsUrl, token, resolveRel]);

  const handleSelectDir = useCallback((path: string) => {
    sendCd(path);
  }, [sendCd]);

  const handleOpenDirectoryPicker = useCallback(() => {
    setPickerOpen(true);
  }, []);

  if (!instanceId) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <TitleBar title="TERMINAL">
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded text-gray-300 hover:text-white bg-gray-800/60 hover:bg-gray-700/80 shrink-0 transition-colors border border-gray-700"
            title="Browse directories"
          >
            <Folder className="w-3.5 h-3.5" />
            <span className="text-[11px] font-mono">{cwd}</span>
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
          initialPath="."
          title="Directory Browser"
          baseUrl={apiBaseUrl}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <TitleBar title="TERMINAL">
        <button
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-gray-300 hover:text-white bg-gray-800/60 hover:bg-gray-700/80 shrink-0 transition-colors border border-gray-700"
          title="Change directory"
        >
          <Folder className="w-3.5 h-3.5" />
          <span className="text-[11px] font-mono max-w-[160px] truncate">{cwd}</span>
        </button>
      </TitleBar>

      <div className="flex-1 flex flex-col min-h-0">
        <ShellTerminal wsUrl={wsUrl} instanceId={instanceId} token={token} _surfaceId={_surfaceId} onOpenDirectoryPicker={handleOpenDirectoryPicker} core={core} coreSessionId={coreSessionId ?? undefined} />
      </div>

      <DirectoryPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleSelectDir}
        initialPath="."
        title="Terminal Directory"
        baseUrl={apiBaseUrl}
      />
    </div>
  );
}
