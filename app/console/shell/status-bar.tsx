'use client';

import { useState, useCallback } from 'react';
import { Folder } from 'lucide-react';
import { RuntimeControlCenter } from './runtime-control-center';
import { useFocus } from '../workbench/focus-context';
import { getStatusBarChromeItems } from '../chrome/chrome-registry';
import { runWorkbenchCommand } from '../actions/workbench-command-dispatch';
import { useCore } from '../core/core-client-provider';
import { DirectoryPicker } from '../dialogs/directory-picker';

export interface StatusBarProps {
  queueStatus: { processing: boolean; source: string | null; queueDepth: number };
  onSetMode?: (mode: string) => void;
  onSetEffort?: (level: string) => void;
  absoluteCwd?: string;
  terminalCwd?: string;
  onNavigatePath?: (path: string) => void;
}

export function StatusBar({
  queueStatus, onSetMode, onSetEffort, absoluteCwd, terminalCwd, onNavigatePath,
}: StatusBarProps) {
  let statusBarLeft: any[] = [];
  let statusBarRight: any[] = [];
  let actionCtx: any = null;
  let focus: ReturnType<typeof useFocus> | null = null;
  try {
    focus = useFocus();
    statusBarLeft = getStatusBarChromeItems(focus.whenContext).filter(i => (i.side || 'left') === 'left');
    statusBarRight = getStatusBarChromeItems(focus.whenContext).filter(i => i.side === 'right');
    actionCtx = {
      view: focus.viewId,
      activeAdapterId: focus.adapterId || '',
      isRunning: focus.isRunning,
      instanceId: focus.instanceId,
    };
  } catch {}

  const core = useCore();
  const [pickerOpen, setPickerOpen] = useState(false);
  const isTerminalView = focus?.viewId === 'terminal';

  const sendCd = useCallback((path: string) => {
    const instId = focus?.instanceId;
    if (!instId) return;
    const qPath = path.replace(/\\/g, '/');
    const cdCmd = `cd "${qPath}"\r`;

    if (core?.isConnected) {
      core.call('stream.write', { sessionId: instId, streamType: 'stdin', data: cdCmd })
        .catch(() => {});
    }
    onNavigatePath?.(path);
  }, [focus?.instanceId, core, onNavigatePath]);

  return (
    <div className="h-7 shrink-0 bg-[#0d0d0d] border-t border-gray-800 flex items-center px-3 gap-2 text-[10px] z-30">
      <RuntimeControlCenter onSetMode={onSetMode} onSetEffort={onSetEffort} />

      {/* Terminal directory picker button */}
      {isTerminalView && focus?.instanceId && (
        <>
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1 text-gray-400 hover:text-white transition-colors shrink-0"
            title="Change directory"
          >
            <Folder className="w-2.5 h-2.5" />
          </button>
          <span className="text-gray-700">|</span>
        </>
      )}

      {/* Phase 4J: StatusBar left chrome contributions */}
      {statusBarLeft.map(item => (
        <span key={item.id}
          className={`flex items-center gap-1 text-[9px] text-gray-500 ${item.command ? 'cursor-pointer hover:text-gray-300' : ''}`}
          title={item.title || item.text}
          onClick={() => {
            if (item.command) {
              runWorkbenchCommand({ command: item.command }, actionCtx);
            }
          }}
        >
          {item.icon && <span className="w-2.5 h-2.5 text-gray-600">{item.icon}</span>}
          <span>{item.text}</span>
        </span>
      ))}

      {/* Queue status indicator */}
      {queueStatus.processing && (
        <>
          <span className="text-gray-700">|</span>
          <span className={`text-[9px] flex items-center gap-1 ${
            queueStatus.source === 'web' ? 'text-purple-400' : 'text-yellow-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              queueStatus.source === 'web' ? 'bg-purple-400' : 'bg-yellow-500'
            } animate-pulse-dot`} />
            {queueStatus.source === 'web' ? 'Web processing' : 'Terminal busy'}
            {queueStatus.queueDepth > 0 && ` (+${queueStatus.queueDepth})`}
          </span>
        </>
      )}

      <span className="flex-1" />

      {/* Phase 4J: StatusBar right chrome contributions */}
      {statusBarRight.map(item => (
        <span key={item.id}
          className={`flex items-center gap-1 text-[9px] text-gray-500 ${item.command ? 'cursor-pointer hover:text-gray-300' : ''}`}
          title={item.title || item.text}
          onClick={() => {
            if (item.command) {
              runWorkbenchCommand({ command: item.command }, actionCtx);
            }
          }}
        >
          <span>{item.text}</span>
        </span>
      ))}

      <DirectoryPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={sendCd}
        absoluteCwd={terminalCwd || absoluteCwd || '.'}
        initialPath="."
        title="Terminal Directory"
      />
    </div>
  );
}
