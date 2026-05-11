'use client';

import { Folder, Cpu } from 'lucide-react';
import { FileExplorer } from './file-explorer';
import { InstanceList } from './instance-list';

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
  fileTree: Record<string, { items: any[]; loaded: boolean }>;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onSendFile: (path: string) => void;
  instances: any[];
  activeInstanceId: string | null;
  onActivate: (id: string) => void;
  onKill: (id: string) => void;
  onCommand: (cmdId: string) => void;
}

export function MobileSidebar({
  open, onClose,
  fileTree, expandedDirs, onToggleDir, onOpenFile, onSendFile,
  instances, activeInstanceId, onActivate, onKill, onCommand,
}: MobileSidebarProps) {
  if (!open) return null;

  return (
    <div className="md:hidden fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      {/* Sheet */}
      <div className="relative w-64 bg-[#0d0d0d] border-r border-gray-800 flex flex-col overflow-y-auto animate-slide-in">
        <div className="flex items-center justify-between p-2 border-b border-gray-800 shrink-0">
          <span className="text-[10px] font-bold text-gray-500 tracking-wider">MENU</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">&times;</button>
        </div>

        {/* Files */}
        <div className="p-3 border-b border-gray-800 text-[10px] font-bold text-gray-500 flex items-center gap-2 tracking-wider">
          <Folder className="w-3.5 h-3.5" /> FILES
        </div>
        <div className="p-1.5 text-xs max-h-40 overflow-y-auto">
          {fileTree['.']?.loaded ? (
            <FileExplorer
              entries={fileTree['.']?.items || []} path="." depth={0}
              fileTree={fileTree} expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              onOpenFile={onOpenFile}
              onSendFile={onSendFile}
            />
          ) : (
            <div className="text-gray-600 text-[10px] p-3 italic">Loading...</div>
          )}
        </div>

        {/* Instances */}
        <div className="p-2 border-b border-gray-800 text-[10px] font-bold text-gray-500 tracking-wider">
          <span className="flex items-center gap-1.5"><Cpu className="w-3 h-3" /> INSTANCES</span>
        </div>
        <InstanceList
          instances={instances} activeInstanceId={activeInstanceId}
          onActivate={onActivate} onKill={onKill}
        />

        {/* Quick Actions */}
        <div className="p-2 border-t border-gray-800 bg-[#151515] mt-auto">
          <div className="text-[10px] text-gray-500 mb-1.5 font-bold tracking-wider">ACTIONS</div>
          <div className="flex flex-wrap gap-1">
            <button onClick={() => onCommand('host.npmTest')}
              className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700">npm test</button>
            <button onClick={() => onCommand('host.gitStatus')}
              className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700">git status</button>
          </div>
        </div>
      </div>
    </div>
  );
}
