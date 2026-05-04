'use client';

import { Folder, Cpu } from 'lucide-react';
import { FileExplorer } from './file-explorer';

interface LeftSidebarProps {
  fileTree: Record<string, { items: any[]; loaded: boolean }>;
  expandedDirs: Set<string>;
  onToggleDir: (dirPath: string) => void;
  onOpenFile: (filePath: string) => void;
  onSendFile: (filePath: string) => void;
  instances: any[];
  activeInstanceId: string | null;
  onActivateInstance: (id: string) => void;
  onCreateInstance: (dir: string, model?: string, adapterId?: string) => void;
  onKillInstance: (id: string) => void;
  isShell: boolean;
  onQuickAction: (cmd: string) => void;
  onRewind: () => void;
  projectCwd: string;
}

function basename(p: string) {
  return p.replace(/\\/g, '/').split('/').filter(Boolean).pop() || p;
}

export function LeftSidebar({
  fileTree,
  expandedDirs,
  onToggleDir,
  onOpenFile,
  onSendFile,
  instances,
  activeInstanceId,
  onActivateInstance,
  onCreateInstance,
  onKillInstance,
  isShell,
  onQuickAction,
  onRewind,
  projectCwd,
}: LeftSidebarProps) {
  return (
    <aside className="w-56 border-r border-gray-800 bg-[#0d0d0d] flex flex-col hidden md:flex shrink-0">
      <div className="p-3 border-b border-gray-800 text-[10px] font-bold text-gray-500 flex items-center gap-2 tracking-wider">
        <Folder className="w-3.5 h-3.5" />
        FILES
      </div>

      <div className="flex-1 overflow-y-auto p-1.5 text-xs min-h-0">
        {!fileTree['.']?.loaded ? (
          <div className="text-gray-600 text-[10px] p-3 italic">Loading files...</div>
        ) : (
          <FileExplorer
            entries={fileTree['.']?.items || []}
            path="."
            depth={0}
            fileTree={fileTree}
            expandedDirs={expandedDirs}
            onToggleDir={onToggleDir}
            onOpenFile={onOpenFile}
            onSendFile={onSendFile}
          />
        )}
      </div>

      {/* Instances panel */}
      <div className="border-t border-gray-800 bg-[#111]">
        <div className="px-3 py-2 text-[10px] font-bold text-gray-500 flex items-center justify-between tracking-wider">
          <span className="flex items-center gap-1.5">
            <Cpu className="w-3 h-3" />
            INSTANCES
          </span>
          <button
            onClick={() => {
              const dir = prompt('Directory for new instance:', projectCwd || '.');
              if (dir) onCreateInstance(dir);
            }}
            className="text-[9px] px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 hover:text-white rounded border border-gray-700 transition-colors"
            title="Create new instance"
          >
            + New
          </button>
        </div>
        <div className="max-h-32 overflow-y-auto px-1 pb-2 text-[11px]">
          {instances.length === 0 ? (
            <div className="text-gray-700 text-[10px] px-2 py-1 italic">No instances</div>
          ) : (
            instances.map((inst: any) => {
              const isActive = inst.id === activeInstanceId;
              const statusColor = inst.status === 'running' ? 'bg-green-500'
                : inst.status === 'starting' ? 'bg-yellow-500'
                : inst.status === 'error' ? 'bg-red-500'
                : 'bg-gray-500';
              return (
                <div
                  key={inst.id}
                  onClick={() => onActivateInstance(inst.id)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-purple-900/30 text-purple-200'
                      : 'hover:bg-gray-800 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor}`} />
                  <span className="truncate flex-1">{inst.label}</span>
                  {inst.source === 'remote' ? (
                    <span className="text-[8px] px-1 bg-blue-900/50 text-blue-300 rounded font-medium">REMOTE</span>
                  ) : (
                    <span className="text-[8px] px-1 bg-gray-700 text-gray-300 rounded font-medium">LOCAL</span>
                  )}
                  <span className="text-[9px] text-gray-600 truncate max-w-[80px]">{basename(inst.dir)}</span>
                  {!isActive && instances.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onKillInstance(inst.id); }}
                      className="text-gray-700 hover:text-red-400 transition-colors text-[10px]"
                      title="Kill instance"
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="p-2 border-t border-gray-800 bg-[#151515]">
        <div className="text-[10px] text-gray-500 mb-1.5 font-bold tracking-wider">QUICK ACTIONS</div>
        <div className="flex flex-wrap gap-1">
          {isShell ? (
            <>
              <button onClick={() => onQuickAction('npm test')}
                className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors">npm test</button>
              <button onClick={() => onQuickAction('git status')}
                className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors">git status</button>
              <button onClick={() => onQuickAction('ls')}
                className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors">ls</button>
            </>
          ) : (
            <>
              <button onClick={() => onQuickAction('npm test')}
                className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors">npm test</button>
              <button onClick={() => onQuickAction('git status')}
                className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors">git status</button>
              <button onClick={() => onQuickAction('分析项目结构并优化代码')}
                className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors">Analyze</button>
              <button onClick={onRewind}
                className="px-1.5 py-1 bg-gray-800 hover:bg-amber-800 hover:text-amber-200 text-[9px] rounded border border-gray-700 transition-colors">↩ Rewind</button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
