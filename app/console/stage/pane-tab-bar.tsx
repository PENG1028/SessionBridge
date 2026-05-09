'use client';

import { useState, useCallback, useRef, type DragEvent } from 'react';
import { Plus, X } from 'lucide-react';
import type { PaneTab } from './workbench-state';
import { getViewEntry } from '../main/view-registry';

interface PaneTabBarProps {
  tabs: PaneTab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTab: () => void;
  onContextTab?: (tab: PaneTab, e: React.MouseEvent) => void;
  onReorderTabs?: (tabId: string, targetId: string) => void;
}

function tabIcon(viewType: string): string {
  if (viewType === 'empty') return '+';
  const entry = getViewEntry(viewType);
  return entry ? entry.meta.title.charAt(0) : '?';
}

export function PaneTabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onAddTab, onContextTab, onReorderTabs }: PaneTabBarProps) {
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, tab: PaneTab) => {
    e.preventDefault();
    if (onContextTab) {
      onContextTab(tab, e);
    }
  }, [onContextTab]);

  const handleDragStart = useCallback((e: DragEvent<HTMLDivElement>, tabId: string) => {
    dragRef.current = tabId;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', tabId);
    const el = e.currentTarget;
    requestAnimationFrame(() => { el.classList.add('opacity-30'); });
  }, []);

  const handleDragEnd = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.currentTarget.classList.remove('opacity-30');
    setDragOverTabId(null);
    dragRef.current = null;
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>, tabId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTabId(tabId);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverTabId(null);
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>, targetId: string) => {
    e.preventDefault();
    setDragOverTabId(null);
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId && draggedId !== targetId && onReorderTabs) {
      onReorderTabs(draggedId, targetId);
    }
  }, [onReorderTabs]);

  return (
    <div className="flex items-center h-7 bg-[#0d0d0d] border-b border-gray-800 shrink-0 overflow-hidden select-none">
      <div className="flex-1 flex items-center overflow-x-auto">
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;
          const isDragOver = dragOverTabId === tab.id;
          return (
            <div
              key={tab.id}
              draggable
              onDragStart={(e) => handleDragStart(e, tab.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, tab.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, tab.id)}
              className={`group flex items-center gap-1 px-2 h-full text-[10px] border-r border-gray-800 cursor-pointer shrink-0 transition-colors ${
                isActive
                  ? 'bg-[#111] text-gray-200 border-b-2 border-b-purple-500'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-[#0a0a0a]'
              } ${isDragOver ? 'border-l-2 border-l-purple-500' : ''}`}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab)}
            >
              <span className="font-mono text-[9px]">{tabIcon(tab.viewType)}</span>
              <span className="truncate max-w-[100px]">{tab.title}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                  className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all p-0.5"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        onClick={onAddTab}
        className="px-1.5 h-full text-gray-500 hover:text-gray-200 hover:bg-[#0a0a0a] border-l border-gray-800 shrink-0 transition-colors"
        title="Add view"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );
}
