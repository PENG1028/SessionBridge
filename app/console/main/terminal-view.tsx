'use client';

import { Terminal, Folder } from 'lucide-react';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useWorkbench } from '../workbench/workbench-context';
import ShellTerminal from '../../shell-terminal';
import { DirectoryPicker } from '../dialogs/directory-picker';
import { TitleBar } from '../shared/title-bar';

interface TerminalViewProps {
  instanceId?: string;
}

/** Envelope helper — same format as ShellTerminal. */
function env(type: string, body: Record<string, unknown> = {}) {
  return JSON.stringify({ v: 1, ts: Date.now(), type, body });
}

export function TerminalView({ instanceId }: TerminalViewProps) {
  const { wsUrl, token, createInstance, bindCurrentTabInstance, projectCwd } = useWorkbench();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoCreated = useRef(false);
  const [cwd, setCwd] = useState(projectCwd || '.');
  const [pickerOpen, setPickerOpen] = useState(false);

  // Auto-create a new shell instance when no instanceId
  const cwdRef = useRef(cwd);
  cwdRef.current = cwd;
  useEffect(() => {
    if (instanceId || autoCreated.current) return;
    autoCreated.current = true;
    setCreating(true);
    setError(null);
    (async () => {
      try {
        const result = await createInstance(cwdRef.current, 'Terminal', 'shell');
        if (result?.instance?.id) {
          bindCurrentTabInstance(result.instance.id);
        } else {
          setError(result?.error || 'Failed to create terminal instance');
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setCreating(false);
      }
    })();
  }, [instanceId, createInstance, bindCurrentTabInstance, projectCwd]);

  // Sync cwd when projectCwd changes
  useEffect(() => {
    if (projectCwd) setCwd(projectCwd);
  }, [projectCwd]);

  /** Resolve a relative path (from picker, e.g. "./src/foo") to absolute using project root. */
  const resolveRel = useCallback((rel: string): string => {
    const base = (projectCwd || '.').replace(/\\/g, '/').replace(/\/$/, '');
    const r = rel.replace(/\\/g, '/').replace(/^\.\/?/, '');
    return r ? base + '/' + r : base;
  }, [projectCwd]);

  // Send cd command to the terminal shell via a transient WS connection
  const sendCd = useCallback((path: string) => {
    const absPath = resolveRel(path);
    setCwd(absPath);
    if (!instanceId) return;
    const qPath = absPath.replace(/\\/g, '/');
    const cdCmd = `cd "${qPath}"\r`;

    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      const helloBody: Record<string, unknown> = { role: 'browser', features: ['cd-helper'] };
      if (token) helloBody.token = token;
      ws.send(env('hello', helloBody));
      ws.send(env('shell.input', { data: cdCmd, instanceId }));
      setTimeout(() => ws.close(), 500);
    };
    ws.onerror = () => {};
  }, [instanceId, wsUrl, token, resolveRel]);

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
        <ShellTerminal wsUrl={wsUrl} instanceId={instanceId} token={token} onOpenDirectoryPicker={handleOpenDirectoryPicker} />
      </div>

      <DirectoryPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleSelectDir}
        initialPath="."
        title="Terminal Directory"
      />
    </div>
  );
}
