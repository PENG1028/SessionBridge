'use client';

import { useState, useRef, useEffect, type RefObject } from 'react';
import { Play, Square, ChevronRight, Folder, FileCode, Terminal } from 'lucide-react';
import { SLASH_COMMANDS } from '../markdown';

// ─── Props ──────────────────────────────────────────

export interface ChatInputProps {
  // Input state
  inputValue: string;
  setInputValue: (v: string) => void;
  handleSubmit: (overrideCmd?: string) => void;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  // Commands
  showCommands: boolean;
  setShowCommands: React.Dispatch<React.SetStateAction<boolean>>;
  handleCommandClick: (cmd: string) => void;
  cmdPanelRef: RefObject<HTMLDivElement | null>;
  // File suggestions
  showFileSuggest: boolean;
  fileSuggestions: any[];
  handleFileSuggestionClick: (item: any) => void;
  // State
  phase: string;
  disabled: boolean;
  handleInterrupt: () => void;
}

// ─── Component ──────────────────────────────────────

export function ChatInput({
  inputValue, setInputValue, handleSubmit, handleInputChange, handleKeyDown,
  showCommands, setShowCommands, handleCommandClick, cmdPanelRef,
  showFileSuggest, fileSuggestions, handleFileSuggestionClick,
  phase, disabled, handleInterrupt,
}: ChatInputProps) {
  const isRunning = phase === 'running';

  // ── Disabled state ──
  if (disabled) {
    return (
      <div className="shrink-0 px-4 py-3 bg-gradient-to-t from-black via-[#0a0a0a] to-transparent">
        <div className="flex items-center gap-1.5 bg-[#151515] border border-gray-700 p-2 rounded-lg opacity-50">
          <button type="button" disabled className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0 text-gray-600 cursor-not-allowed">
            {'/>'}
          </button>
          <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
          <input type="text" disabled
            placeholder="Switch to the active instance to send commands"
            className="flex-1 bg-transparent outline-none text-gray-200 placeholder-gray-700 text-sm min-w-0 cursor-not-allowed"
          />
          <button disabled
            className="px-4 py-1.5 bg-gray-800 text-gray-600 text-xs font-bold rounded flex items-center gap-1.5 shrink-0 cursor-not-allowed">
            <Play className="w-3 h-3 fill-current" /> EXEC
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 px-4 py-3 bg-gradient-to-t from-black via-[#0a0a0a] to-transparent relative">
      {/* ── Slash command panel (floating above input) ── */}
      {showCommands && (
        <div ref={cmdPanelRef}
          className="absolute bottom-full left-4 right-4 mb-2 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-2xl shadow-black/50 overflow-hidden"
        >
          <div className="p-2 border-b border-gray-800 text-[10px] text-gray-500 font-bold tracking-wider px-3 py-1.5">
            QUICK COMMANDS
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {SLASH_COMMANDS.map(sc => (
              <button key={sc.cmd} onClick={() => sc.ok && handleCommandClick(sc.cmd)}
                className={`w-full flex items-center gap-3 px-3 py-2 transition-colors text-left ${
                  sc.ok ? 'hover:bg-gray-800 cursor-pointer' : 'opacity-40 cursor-not-allowed'
                }`}
                title={sc.ok ? sc.cmd + ' ' + sc.desc : 'Not available in current mode'}
              >
                <code className={`text-[11px] font-bold shrink-0 w-16 ${sc.ok ? 'text-purple-400' : 'text-gray-600'}`}>{sc.cmd}</code>
                <span className="text-[10px] truncate">{sc.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── @ file suggestions ── */}
      {showFileSuggest && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-2xl shadow-black/50 overflow-hidden z-50">
          <div className="p-1.5 border-b border-gray-800 text-[10px] text-gray-500 px-3 py-1">FILES</div>
          <div className="max-h-40 overflow-y-auto py-1">
            {fileSuggestions.map((item: any) => (
              <button key={item.path || item.name}
                onClick={() => handleFileSuggestionClick(item)}
                className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800 transition-colors text-left"
              >
                {item.type === 'dir'
                  ? <Folder className="w-3 h-3 text-yellow-600 shrink-0" />
                  : <FileCode className="w-3 h-3 text-blue-500 shrink-0" />
                }
                <span className="text-[10px] text-gray-300 truncate">{item.path || item.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Input area ── */}
      <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
        className={`flex items-center gap-1.5 bg-[#151515] border ${
          isRunning
            ? 'border-purple-800 shadow-[0_0_12px_rgba(168,85,247,0.15)]'
            : 'border-gray-700 focus-within:border-purple-500'
        } p-2 rounded-lg transition-all`}
      >
        {/* Commands toggle button */}
        <button type="button" onClick={() => setShowCommands(v => !v)}
          className={`text-xs font-bold px-1.5 py-0.5 rounded shrink-0 transition-colors ${
            showCommands ? 'text-purple-400 bg-purple-900/20' : 'text-gray-500 hover:text-gray-300'
          }`}
          title="Slash commands"
        >
          {'/>'}
        </button>

        <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />

        {/* Text input */}
        <input type="text" value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={isRunning}
          placeholder={isRunning ? 'Claude is working...' : 'Type instructions or press Quick Actions...'}
          className="flex-1 bg-transparent outline-none text-gray-200 placeholder-gray-600 text-sm disabled:opacity-50 min-w-0 msg-input"
        />

        {/* Submit / Stop */}
        {!isRunning ? (
          <button type="submit"
            className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded flex items-center gap-1.5 transition-colors shrink-0"
            title="Submit (Enter)">
            <Play className="w-3 h-3 fill-current" /> EXEC
          </button>
        ) : (
          <button type="button" onClick={handleInterrupt}
            className="px-4 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs font-bold rounded flex items-center gap-1.5 transition-colors shrink-0 animate-pulse"
            title="Stop current task (Esc)">
            <Square className="w-3 h-3 fill-current" /> STOP
          </button>
        )}
      </form>
    </div>
  );
}
