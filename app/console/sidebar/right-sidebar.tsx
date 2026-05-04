'use client';

import { FileCode, GitBranch, ChevronRight, AlertCircle } from 'lucide-react';
import { TaskPanel } from '../panels/task-panel';

interface RightSidebarProps {
  isClaude: boolean;
  activeTasks: Map<string, any>;
  queueInfo: { isProcessing: boolean; queueDepth: number; queue: any[] };
  onNewSession: () => void;
  onQuickCompact: () => void;
  onSaveSnapshot: () => void;
  snapshots: { id: string; name: string; msgs: any[]; ts: string }[];
  onLoadSnapshot: (id: string) => void;
  onForkSnapshot: (id: string) => void;
  knownFiles: Map<string, string>;
  onOpenFile: (filePath: string) => void;
  shortenPath: (p: string) => string;
  logs: string[];
  msgLog: any[];
  terminalTab: 'log' | 'raw';
  onTerminalTabChange: (tab: 'log' | 'raw') => void;
  logsEndRef: React.RefObject<HTMLDivElement | null>;
}

export function RightSidebar({
  isClaude,
  activeTasks,
  queueInfo,
  onNewSession,
  onQuickCompact,
  onSaveSnapshot,
  snapshots,
  onLoadSnapshot,
  onForkSnapshot,
  knownFiles,
  onOpenFile,
  shortenPath,
  logs,
  msgLog,
  terminalTab,
  onTerminalTabChange,
  logsEndRef,
}: RightSidebarProps) {
  return (
    <aside className="w-72 border-l border-gray-800 bg-[#0d0d0d] flex flex-col hidden lg:flex shrink-0">
      {isClaude && <TaskPanel tasks={activeTasks} queueInfo={queueInfo} />}

      {/* Actions */}
      <div className="p-3 border-b border-gray-800 bg-[#111] space-y-2">
        <div className="text-[10px] text-gray-500 font-bold tracking-wider">ACTIONS</div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={onNewSession}
            className="flex-1 px-2 py-1.5 bg-[#1a1a1a] hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] rounded border border-gray-700 transition-colors">
            + New Session
          </button>
          <button onClick={onQuickCompact}
            className="px-2 py-1.5 bg-[#1a1a1a] hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] rounded border border-gray-700 transition-colors"
            title="Compress context to free tokens">
            /compact
          </button>
          <button onClick={onSaveSnapshot}
            className="px-2 py-1.5 bg-[#1a1a1a] hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] rounded border border-gray-700 transition-colors"
            title="Save current conversation as snapshot">
            + Snapshot
          </button>
        </div>
      </div>

      {/* Snapshots */}
      {snapshots.length > 0 && (
        <div className="border-b border-gray-800 bg-[#111]">
          <div className="p-2 text-[10px] font-bold text-gray-500 flex items-center gap-2 tracking-wider">
            <GitBranch className="w-3 h-3" />
            SNAPSHOTS
            <span className="text-gray-700 font-normal">{snapshots.length}</span>
          </div>
          <div className="max-h-28 overflow-y-auto px-2 pb-2 space-y-0.5">
            {snapshots.slice().reverse().map(s => (
              <div key={s.id} className="flex items-center gap-1 group">
                <button
                  onClick={() => onLoadSnapshot(s.id)}
                  className="flex-1 flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] transition-colors text-left min-w-0"
                  title={s.name}
                >
                  <ChevronRight className="w-2 h-2 shrink-0 text-gray-600" />
                  <span className="truncate text-[9px]">{s.name}</span>
                  <span className="text-[7px] text-gray-700 ml-auto shrink-0">{s.ts.slice(5, 16)}</span>
                </button>
                <button
                  onClick={() => onForkSnapshot(s.id)}
                  className="opacity-0 group-hover:opacity-100 px-1 text-[8px] text-purple-600 hover:text-purple-400 transition-opacity"
                  title="Fork from this snapshot"
                >fork</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Files in Context */}
      {knownFiles.size > 0 && (
        <div className="border-b border-gray-800 bg-[#111]">
          <div className="p-2 text-[10px] font-bold text-gray-500 flex items-center gap-2 tracking-wider">
            <FileCode className="w-3 h-3" />
            FILES IN CONTEXT
            <span className="text-gray-700 font-normal">{knownFiles.size}</span>
          </div>
          <div className="max-h-24 overflow-y-auto px-2 pb-2 space-y-0.5">
            {[...knownFiles.entries()].filter(([,t]) => t === 'file').slice(-30).map(([path]) => (
              <button key={path}
                onClick={() => onOpenFile(path)}
                className="w-full flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] transition-colors text-left"
                title={path}
              >
                <FileCode className="w-2.5 h-2.5 shrink-0 text-blue-500" />
                <span className="truncate text-[9px]">{shortenPath(path)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Raw Terminal — truth layer */}
      <div className="flex-1 flex flex-col bg-black min-h-0">
        <div className="flex border-b border-gray-800 bg-[#111] shrink-0">
          <button onClick={() => onTerminalTabChange('log')}
            className={`px-3 py-1.5 text-[10px] tracking-wider flex items-center gap-1.5 transition-colors ${
              terminalTab === 'log' ? 'text-purple-400 border-b border-purple-500 bg-[#0a0a0a]' : 'text-gray-600 hover:text-gray-400'
            }`}>
            <AlertCircle className="w-3 h-3" /> LOG
          </button>
          <button onClick={() => onTerminalTabChange('raw')}
            className={`px-3 py-1.5 text-[10px] tracking-wider flex items-center gap-1.5 transition-colors ${
              terminalTab === 'raw' ? 'text-purple-400 border-b border-purple-500 bg-[#0a0a0a]' : 'text-gray-600 hover:text-gray-400'
            }`}>
            <AlertCircle className="w-3 h-3" /> RAW
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 text-gray-400 text-xs font-mono leading-relaxed">
          {terminalTab === 'log' ? (
            logs.length === 0 ? (
              <div className="text-gray-700 text-[10px] italic">No log entries yet</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={`whitespace-pre-wrap ${
                  log.includes('Error') || log.includes('[Error]') ? 'text-red-400'
                  : log.includes('✓') || log.includes('✅') ? 'text-green-400'
                  : log.includes('> ') ? 'text-purple-300'
                  : log.includes('[Unknown]') ? 'text-yellow-500'
                  : 'text-gray-500'
                }`}>
                  {log}
                </div>
              ))
            )
          ) : (
            msgLog.length === 0 ? (
              <div className="text-gray-700 text-[10px] italic">Raw output will appear here</div>
            ) : (
              msgLog.slice(-200).map((entry) => (
                <div key={entry.id} className="text-[10px] leading-relaxed font-mono">
                  <span className="text-gray-700">{entry.time}</span>{' '}
                  <span className={`${
                    entry.type === 'output' ? 'text-gray-500'
                    : entry.type === 'block' ? 'text-purple-500'
                    : entry.type === 'input' ? 'text-green-500'
                    : entry.type === 'error' ? 'text-red-500'
                    : 'text-gray-600'
                  }`}>
                    [{entry.type}]
                  </span>{' '}
                  <span className="text-gray-400">{entry.data}</span>
                </div>
              ))
            )
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </aside>
  );
}
