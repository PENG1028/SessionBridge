'use client';

import { Square } from 'lucide-react';
import { useSessionContext } from '../workbench/session-context';
import { useInputContext } from '../workbench/input-context';
import { useWorkbench } from '../workbench/workbench-context';

// ─── WorkbenchTopBar ───────────────────────────────────────────
// The header bar above the workbench layout showing session info,
// message count, phase indicator, and stop button.
// Reads from the split contexts directly via hooks.

export function WorkbenchTopBar() {
  const { phase, handleInterrupt, messages } = useSessionContext();
  const { inputValue } = useInputContext();
  const { activeExternalSession, clearExternalSession } = useWorkbench();

  return (
    <div className="flex items-center justify-between h-7 px-2 border-b border-gray-800 bg-[#0a0a0a] shrink-0" data-copyable="false">
      <span className="flex items-center gap-2 text-[10px] font-bold text-gray-500 tracking-wider">
        WORKBENCH
        {activeExternalSession && (
          <span className="text-amber-500 text-[8px] bg-amber-900/20 px-1.5 py-0.5 rounded border border-amber-700/30">
            VIEWING: {activeExternalSession}
            <button
              onClick={clearExternalSession}
              className="ml-1.5 px-1 bg-amber-800/40 hover:bg-amber-700/60 rounded text-[7px] text-amber-300"
            >
              ✕
            </button>
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        <span className="text-gray-700 text-[8px] font-mono">
          msg:{messages.length}
        </span>
        {phase === 'running' && (
          <span className="text-purple-500 animate-pulse text-[9px]">●</span>
        )}
        {phase === 'running' && (
          <button
            onClick={handleInterrupt}
            className="text-red-400 hover:text-red-300 flex items-center gap-1 text-[8px] bg-red-900/20 px-1.5 py-0.5 rounded border border-red-800/30 transition-colors"
            title="Stop (Esc)"
          >
            <Square className="w-2 h-2 fill-current" /> STOP
          </button>
        )}
      </span>
    </div>
  );
}
