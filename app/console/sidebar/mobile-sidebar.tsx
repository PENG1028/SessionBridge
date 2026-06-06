'use client';

import { useMemo, useRef, useCallback, useState } from 'react';
import { Folder, X } from 'lucide-react';
import { FileExplorer } from './file-explorer';
import { getPanels } from '../panels/panel-registry';
import { useFocus } from '../workbench/focus-context';
import { isSelecting } from '../../../lib/click-guard';

interface MobileSidebarProps {
  open: boolean;
  onClose: () => void;
  fileTree: Record<string, { items: any[]; loaded: boolean; error?: string }>;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onSendFile: (path: string) => void;
  onBookmarkDir?: (path: string) => void;
  onCommand: (cmdId: string) => void;
  activeView?: string;
  activeInstanceId?: string | null;
  onKill?: (id: string) => void;
  absoluteCwd?: string;
}

export function MobileSidebar({
  open, onClose,
  fileTree, expandedDirs, onToggleDir, onOpenFile, onSendFile, onBookmarkDir,
  onCommand, activeView, activeInstanceId, onKill, absoluteCwd,
}: MobileSidebarProps) {
  const { whenContext } = useFocus();
  const panels = useMemo(() => getPanels('left', whenContext), [whenContext]);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [touchStart, setTouchStart] = useState<number | null>(null);

  // Hooks must not be conditional — declare before any early return
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches[0].clientX < 40) setTouchStart(e.touches[0].clientX);
  }, []);

  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStart === null) return;
    // Don't close drawer while user is selecting text
    if (isSelecting()) { setTouchStart(null); return; }
    const dx = e.changedTouches[0].clientX - touchStart;
    if (dx > 80) onClose();
    setTouchStart(null);
  }, [touchStart, onClose]);

  if (!open) return null;

  const hasFocus = activeView && activeView !== 'empty';

  return (
    <div className="md:hidden fixed inset-0 z-50 flex" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} data-copyable="false">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      {/* Sheet */}
      <div ref={sheetRef} className="relative w-72 max-w-[85vw] bg-[#0d0d0d] border-r border-gray-800 flex flex-col overflow-hidden animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
          <span className="text-[10px] font-bold text-gray-500 tracking-wider">MENU</span>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 p-1" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Panel sections */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {panels.length === 0 || !hasFocus ? (
            /* Files-only fallback when no panels or unfocused */
            <div className="flex flex-col min-h-0">
              {hasFocus && (
                <>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0a0a0a] border-b border-gray-800/40 shrink-0">
                    <Folder className="w-3 h-3 text-gray-400" />
                    <span className="text-[9px] font-bold text-gray-500 tracking-wider uppercase">FILES</span>
                  </div>
                  <div className="flex-1 overflow-y-auto px-1.5 py-1 text-xs">
                    {fileTree[absoluteCwd || '.']?.loaded ? (
                      <FileExplorer
                        entries={fileTree[absoluteCwd || '.']?.items || []} path="." depth={0}
                        fileTree={fileTree} expandedDirs={expandedDirs}
                        onToggleDir={onToggleDir}
                        onOpenFile={onOpenFile}
                        onSendFile={onSendFile}
                        onBookmarkDir={onBookmarkDir}
                        absoluteCwd={absoluteCwd}
                      />
                    ) : (
                      <div className="text-gray-600 text-[10px] p-3 italic">Loading...</div>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : (
            /* Panel sections from registry */
            panels.map((p) => {
              const PanelComponent = p.component;
              return (
                <div key={p.id} className="border-b border-gray-800/60 last:border-b-0">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0a0a0a] border-b border-gray-800/40 shrink-0">
                    {p.icon && <p.icon className="w-3 h-3 text-gray-400" />}
                    <span className="text-[9px] font-bold text-gray-500 tracking-wider uppercase">{p.title}</span>
                  </div>
                  <div className="px-1.5 py-1">
                    <PanelComponent
                      fileTree={fileTree}
                      expandedDirs={expandedDirs}
                      onToggleDir={onToggleDir}
                      onOpenFile={onOpenFile}
                      onSendFile={onSendFile}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Quick Actions — view-aware */}
        <div className="shrink-0 px-3 py-2 border-t border-gray-800 bg-[#151515]">
          <div className="text-[10px] text-gray-500 mb-1.5 font-bold tracking-wider">ACTIONS</div>
          <div className="flex flex-wrap gap-1">
            {activeView === 'terminal' ? (
              <>
                <button onClick={() => onCommand('shell.clear')}
                  className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 hover:text-white text-[10px] rounded border border-gray-700 active:scale-95 transition-transform">Clear</button>
                <button onClick={() => activeInstanceId && onKill?.(activeInstanceId)}
                  className="px-2 py-1.5 bg-red-900/20 hover:bg-red-800/40 hover:text-red-200 text-[10px] rounded border border-red-800/50 text-red-400 active:scale-95 transition-transform">Kill</button>
              </>
            ) : (
              <>
                <button onClick={() => onCommand('host.npmTest')}
                  className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 hover:text-white text-[10px] rounded border border-gray-700 active:scale-95 transition-transform">npm test</button>
                <button onClick={() => onCommand('host.gitStatus')}
                  className="px-2 py-1.5 bg-gray-800 hover:bg-gray-700 hover:text-white text-[10px] rounded border border-gray-700 active:scale-95 transition-transform">git status</button>
              </>
            )}
            <button onClick={() => onCommand('workbench.newSession')}
              className="px-2 py-1.5 bg-purple-900/30 hover:bg-purple-800/40 text-purple-300 text-[10px] rounded border border-purple-800/40 active:scale-95 transition-transform">New Session</button>
          </div>
        </div>
      </div>
    </div>
  );
}
