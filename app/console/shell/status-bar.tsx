'use client';

import { RuntimeControlCenter } from './runtime-control-center';

export interface StatusBarProps {
  queueStatus: { processing: boolean; source: string | null; queueDepth: number };
  onSetMode?: (mode: string) => void;
  onSetEffort?: (level: string) => void;
}

export function StatusBar({
  queueStatus,
  onSetMode,
  onSetEffort,
}: StatusBarProps) {
  return (
    <div className="h-7 shrink-0 bg-[#0d0d0d] border-t border-gray-800 flex items-center px-3 gap-2 text-[10px] z-30">
      <RuntimeControlCenter onSetMode={onSetMode} onSetEffort={onSetEffort} />

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

      {/* Keyboard shortcut hints */}
      <span className="text-[9px] text-gray-600 hidden md:flex items-center gap-3">
        <kbd className="px-1 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-500">Esc</kbd>
        <span className="text-gray-700">Stop</span>
        <kbd className="px-1 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-500">⌘K</kbd>
        <span className="text-gray-700">Commands</span>
        <kbd className="px-1 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-500">⌘L</kbd>
        <span className="text-gray-700">Clear</span>
        <kbd className="px-1 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-500">⌘⇧C</kbd>
        <span className="text-gray-700">Copy</span>
      </span>
    </div>
  );
}
