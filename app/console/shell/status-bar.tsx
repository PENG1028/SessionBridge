'use client';

import { useRef } from 'react';
import { Ban, CheckCircle2, Cpu, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';

export interface StatusBarProps {
  permissionMode: string;
  effortLevel: string;
  showModePicker: boolean;
  onToggleModePicker: () => void;
  onSetMode: (mode: string) => void;
  onSetEffort: (level: string) => void;
  queueStatus: { processing: boolean; source: string | null; queueDepth: number };
  modePickerRef: React.RefObject<HTMLDivElement | null>;
}

export function StatusBar({
  permissionMode,
  effortLevel,
  showModePicker,
  onToggleModePicker,
  onSetMode,
  onSetEffort,
  queueStatus,
  modePickerRef,
}: StatusBarProps) {
  return (
    <div className="h-7 shrink-0 bg-[#0d0d0d] border-t border-gray-800 flex items-center px-3 gap-2 text-[10px] z-30">
      <div ref={modePickerRef} className="relative">
        <button onClick={onToggleModePicker}
          className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#1a1a1a] border border-gray-700 hover:border-purple-600 text-gray-400 hover:text-gray-200 transition-colors"
        >
          {permissionMode === 'default' && <Ban className="w-3 h-3 text-yellow-500" />}
          {permissionMode === 'acceptEdits' && <CheckCircle2 className="w-3 h-3 text-green-500" />}
          {permissionMode === 'plan' && <Cpu className="w-3 h-3 text-purple-500" />}
          <span className="font-medium">
            {permissionMode === 'default' ? 'Ask before edits'
             : permissionMode === 'acceptEdits' ? 'Edit automatically'
             : 'Plan mode'}
          </span>
          <ChevronDown className="w-2.5 h-2.5 text-gray-600" />
        </button>

        {showModePicker && (
          <div className="absolute bottom-full left-0 mb-1 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-2xl shadow-black/50 overflow-hidden z-50" style={{ minWidth: '200px' }}>
            <div className="px-3 py-1.5 text-[9px] text-gray-600 font-bold tracking-wider border-b border-gray-800">PERMISSION MODE</div>
            <div className="py-1">
              {(['default', 'acceptEdits', 'plan'] as const).map(mode => (
                <button key={mode}
                  onClick={() => onSetMode(mode)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-800 ${
                    permissionMode === mode ? 'bg-purple-900/10' : ''
                  }`}
                >
                  {mode === 'default' && <Ban className="w-3.5 h-3.5 text-yellow-500" />}
                  {mode === 'acceptEdits' && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                  {mode === 'plan' && <Cpu className="w-3.5 h-3.5 text-purple-500" />}
                  <div className="flex flex-col">
                    <span className={`text-[10px] ${permissionMode === mode ? 'text-purple-300 font-bold' : 'text-gray-200'}`}>
                      {mode === 'default' ? 'Ask before edits'
                       : mode === 'acceptEdits' ? 'Edit automatically'
                       : 'Plan mode'}
                    </span>
                    <span className="text-[8px] text-gray-600">
                      {mode === 'default' ? 'Claude asks before each edit'
                       : mode === 'acceptEdits' ? 'Claude edits files directly'
                       : 'Claude plans before acting'}
                    </span>
                  </div>
                  {permissionMode === mode && <ChevronRight className="w-3 h-3 text-purple-500 ml-auto shrink-0" />}
                </button>
              ))}
            </div>
            <div className="border-t border-gray-800">
              <div className="px-3 py-1.5 text-[9px] text-gray-600 font-bold tracking-wider">EFFORT (thinking)</div>
              <div className="py-1">
                {(['low', 'medium', 'high'] as const).map(level => (
                  <button key={level}
                    onClick={() => onSetEffort(level)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-800 ${
                      effortLevel === level ? 'bg-purple-900/10' : ''
                    }`}
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${effortLevel === level ? 'text-purple-400' : 'text-gray-600'}`} />
                    <div className="flex flex-col">
                      <span className={`text-[10px] ${effortLevel === level ? 'text-purple-300 font-bold' : 'text-gray-200'}`}>
                        {level === 'low' ? 'Off'
                         : level === 'medium' ? 'On'
                         : 'Max'}
                      </span>
                      <span className="text-[8px] text-gray-600">
                        {level === 'low' ? 'No extended thinking'
                         : level === 'medium' ? 'Enable extended thinking'
                         : 'Maximum thinking depth'}
                      </span>
                    </div>
                    {effortLevel === level && <ChevronRight className="w-3 h-3 text-purple-500 ml-auto shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <span className="text-gray-700">|</span>

      {/* Effort quick display */}
      <span className={`text-[9px] ${effortLevel === 'low' ? 'text-gray-600' : 'text-purple-400'}`}>
        Effort: {effortLevel === 'low' ? 'Off' : effortLevel === 'medium' ? 'On' : 'Max'}
      </span>

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
