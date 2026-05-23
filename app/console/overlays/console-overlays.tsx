'use client';

import { Search, FileCode } from 'lucide-react';
import { ContextMenu, type ContextMenuItem } from '../shell/context-menu';
import { CommandPalette } from '../shell/command-palette';
import { ForkDialog } from '../shell/fork-dialog';
import { SearchResultsPanel } from '../shell/search-results-panel';
import { SettingsPanel } from '../shell/settings-panel';
import { useCore } from '../core/core-client-provider';
import { ApprovalCenter } from '../system-ui/approval-center';

interface ConsoleOverlaysProps {
  // Search
  showSearch: boolean;
  searchPanelRef: React.RefObject<HTMLDivElement | null>;
  searchQuery: string;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  handleSearchInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
  searchLoading: boolean;
  onCloseSearch: () => void;
  searchResults: any[];
  addLog: (msg: string) => void;
  handleLoadSession: (sessionId: string, project: string, display?: string) => void;

  // Command palette
  showCommandPalette: boolean;
  extCommands: { id: string; title: string; category?: string; when?: string }[];
  onCommand: (cmd: string, args?: any) => void;
  onCloseCommandPalette: () => void;

  // File viewer
  viewingFile: { path: string; content: string } | null;
  onCloseFileViewer: () => void;

  // Fork dialog
  forkTarget: number | null;
  turns: any[];
  forkPrompt: string;
  setForkPrompt: (v: string) => void;
  onCloseFork: () => void;
  onRewind: (targetIdx: number) => void;
  onForkSnapshot: (targetIdx: number) => void;
  onForkWithPrompt: (targetIdx: number, prompt: string) => void;

  // Context menu
  ctxMenu: { x: number; y: number; items: ContextMenuItem[] } | null;
  onCloseContextMenu: () => void;

  // Settings
  settingsOpen: boolean;
  onCloseSettings: () => void;
}

export function ConsoleOverlays(props: ConsoleOverlaysProps) {
  const core = useCore();

  return (
    <>
      {/* ═══ SEARCH SESSIONS PANEL (overlay) ════ */}
      {props.showSearch && (
        <div className="absolute inset-0 z-40 flex justify-center pt-12 pointer-events-none" style={{ top: '44px' }}>
          <div ref={props.searchPanelRef} className="w-full max-w-lg bg-[#151515] border border-gray-700 rounded-lg shadow-2xl shadow-black/60 overflow-hidden pointer-events-auto max-h-[70vh] flex flex-col">
            <div className="flex items-center gap-2 p-3 border-b border-gray-800">
              <Search className="w-4 h-4 text-gray-500 shrink-0" />
              <input ref={props.searchInputRef} type="text" value={props.searchQuery} onChange={props.handleSearchInput}
                placeholder="Search Claude Code sessions..."
                className="flex-1 bg-transparent outline-none text-gray-200 text-sm placeholder-gray-600"
              />
              {props.searchLoading && (
                <div className="w-4 h-4 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
              )}
              <button onClick={props.onCloseSearch} className="text-gray-600 hover:text-gray-400 text-lg leading-none">&times;</button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {props.searchLoading && (
                <div className="p-6 text-center text-gray-600 text-xs">Loading sessions...</div>
              )}
              {!props.searchLoading && props.searchResults.length === 0 && !props.searchQuery.trim() && (
                <div className="p-6 text-center text-gray-600 text-xs">
                  No recent sessions found
                </div>
              )}
              {!props.searchLoading && props.searchResults.length === 0 && props.searchQuery.trim() && (
                <div className="p-6 text-center text-gray-600 text-xs">No matching sessions found</div>
              )}

              {props.searchResults.length > 0 && (
                <SearchResultsPanel results={props.searchResults} onClose={props.onCloseSearch} onLog={props.addLog} onLoadSession={props.handleLoadSession} />
              )}
            </div>

            <div className="p-2 border-t border-gray-800 text-[8px] text-gray-700 text-center">
              Searches {props.searchResults.length > 0 ? `${props.searchResults.length} sessions` : 'Claude Code history'}
            </div>
          </div>
        </div>
      )}

      {/* ═══ COMMAND PALETTE (overlay) ════ */}
      {props.showCommandPalette && (
        <CommandPalette
          commands={props.extCommands}
          onCommand={(cmdId) => props.onCommand(cmdId)}
          onClose={props.onCloseCommandPalette}
        />
      )}

      {/* ═══ FILE VIEWER MODAL ════ */}
      {props.viewingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={props.onCloseFileViewer}>
          <div className="bg-[#111] border border-gray-700 rounded-lg w-3/4 max-w-3xl max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-gray-800">
              <div className="flex items-center gap-2 text-xs text-gray-300">
                <FileCode className="w-4 h-4 text-blue-400" />
                <code className="font-mono">{props.viewingFile.path}</code>
              </div>
              <button onClick={props.onCloseFileViewer} className="text-gray-500 hover:text-gray-300 text-lg leading-none">&times;</button>
            </div>
            <pre className="flex-1 overflow-y-auto p-4 text-xs text-gray-300 font-mono leading-relaxed whitespace-pre-wrap bg-[#0a0a0a]">
              {props.viewingFile.content}
            </pre>
          </div>
        </div>
      )}

      {/* ═══ FORK / REWIND DIALOG ════════════ */}
      {props.forkTarget !== null && props.turns[props.forkTarget] && (
        <ForkDialog
          forkTarget={props.forkTarget}
          turn={props.turns[props.forkTarget]}
          forkPrompt={props.forkPrompt}
          setForkPrompt={props.setForkPrompt}
          onClose={props.onCloseFork}
          onRewind={props.onRewind}
          onForkSnapshot={props.onForkSnapshot}
          onForkWithPrompt={props.onForkWithPrompt}
        />
      )}

      {/* ═══ SETTINGS PANEL ════ */}
      <SettingsPanel
        open={props.settingsOpen}
        onClose={props.onCloseSettings}
      />

      {/* ═══ CONTEXT MENU ════ */}
      {props.ctxMenu && (
        <ContextMenu items={props.ctxMenu.items} x={props.ctxMenu.x} y={props.ctxMenu.y} onClose={props.onCloseContextMenu} />
      )}

      {/* ═══ APPROVAL CENTER (global overlay) ════ */}
      <ApprovalCenter core={core} />
    </>
  );
}
