'use client';

import { Folder } from 'lucide-react';
import { FileExplorer } from './file-explorer';
import { InstanceList } from './instance-list';

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
  activeViewId: string | null;
  onQuickAction: (cmd: string) => void;
  onRewind: () => void;
  projectCwd: string;
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
  activeViewId,
  onQuickAction,
  onRewind,
  projectCwd,
}: LeftSidebarProps) {
  const handleCreate = () => {
    const dir = prompt('Directory for new instance:', projectCwd || '.');
    if (dir) onCreateInstance(dir);
  };

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

      <InstanceList
        instances={instances}
        activeInstanceId={activeInstanceId}
        onActivate={onActivateInstance}
        onCreate={handleCreate}
        onKill={onKillInstance}
      />

      {/* Quick actions */}
      <div className="p-2 border-t border-gray-800 bg-[#151515]">
        <div className="text-[10px] text-gray-500 mb-1.5 font-bold tracking-wider">QUICK ACTIONS</div>
        <div className="flex flex-wrap gap-1">
          <button onClick={() => onQuickAction('npm test')}
            className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors">npm test</button>
          <button onClick={() => onQuickAction('git status')}
            className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors">git status</button>
          {activeViewId === 'terminal' ? (
            <button onClick={() => onQuickAction('ls')}
              className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors">ls</button>
          ) : (
            <>
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
