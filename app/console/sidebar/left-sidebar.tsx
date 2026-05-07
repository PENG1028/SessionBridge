'use client';

import { Folder, Upload } from 'lucide-react';
import { FileExplorer } from './file-explorer';
import { InstanceList } from './instance-list';
import { evaluateWhen, type WhenContext } from '../../../lib/evaluate-when';
import { useRef, useCallback } from 'react';

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
  onQuickAction: (cmd: string) => void;
  onRewind: () => void;
  projectCwd: string;
  /** When context for evaluating panel visibility conditions. */
  whenContext: WhenContext;
  /** Dynamic extension panels from manifests */
  extensionPanels?: { id: string; title: string; icon: string; defaultVisible: boolean; when?: string }[];
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
  onQuickAction,
  onRewind,
  projectCwd,
  whenContext,
  extensionPanels,
}: LeftSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const data = (reader.result as string).split(',')[1] || '';
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: file.name, data, encoding: 'base64' }),
        });
        const result = await res.json();
        if (result.success) { /* file tree will refresh on next toggle */ }
      } catch {}
    };
    reader.readAsDataURL(file);
    // Reset so same file can be re-selected
    e.target.value = '';
  }, []);

  const handleCreate = () => {
    const dir = prompt('Directory for new instance:', projectCwd || '.');
    if (dir) onCreateInstance(dir);
  };

  // Show shell-specific quick actions when terminal is active
  const isTerminal = evaluateWhen('activeAdapterId == shell', whenContext);

  return (
    <aside className="w-56 border-r border-gray-800 bg-[#0d0d0d] flex flex-col hidden md:flex shrink-0">
      <div className="p-3 border-b border-gray-800 text-[10px] font-bold text-gray-500 flex items-center gap-2 tracking-wider">
        <Folder className="w-3.5 h-3.5" />
        FILES
        <button
          onClick={() => fileInputRef.current?.click()}
          className="ml-auto text-gray-600 hover:text-gray-300 transition-colors"
          title="Upload file to workspace"
        >
          <Upload className="w-3 h-3" />
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
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
          {isTerminal ? (
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

      {/* Extension panels (from manifests, filtered by when condition) */}
      {extensionPanels && extensionPanels.filter(p => evaluateWhen(p.when, whenContext)).length > 0 && (
        <div className="border-t border-gray-800 bg-[#151515]">
          <div className="p-2 text-[10px] font-bold text-gray-500 tracking-wider">EXTENSIONS</div>
          <div className="px-2 pb-2 space-y-0.5">
            {extensionPanels.filter(p => evaluateWhen(p.when, whenContext)).map(p => (
              <div key={p.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-800 text-gray-400 text-[10px] transition-colors cursor-default">
                <span>{p.title}</span>
                <span className="text-[7px] text-gray-700 ml-auto">{p.defaultVisible ? 'visible' : 'hidden'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
