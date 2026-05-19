'use client';

import { useState, useCallback, useRef, useEffect, type DragEvent } from 'react';
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
  /** Kept-but-closed tabs for ≡ menu */
  closedKeptTabs?: PaneTab[];
  /** Reopen a kept tab from ≡ menu */
  onReopenKeptTab?: (tab: PaneTab) => void;
  /** IDs of kept/persistent tabs (shown with distinct style) */
  persistentTabIds?: string[];
}

function tabIcon(viewType: string): string {
  if (viewType === 'empty') return '+';
  const entry = getViewEntry(viewType);
  return entry ? entry.meta.title.charAt(0) : '?';
}

export function PaneTabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onAddTab, onContextTab, onReorderTabs, closedKeptTabs, onReopenKeptTab, persistentTabIds }: PaneTabBarProps) {
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [showKeptMenu, setShowKeptMenu] = useState(false);
  const keptMenuRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<string | null>(null);

  // Close kept-tab menu on outside click
  useEffect(() => {
    if (!showKeptMenu) return;
    const handler = (e: MouseEvent) => {
      if (keptMenuRef.current && !keptMenuRef.current.contains(e.target as Node)) {
        setShowKeptMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showKeptMenu]);

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

  const keptIds = persistentTabIds ? new Set(persistentTabIds) : null;

  return (
    <div className="flex items-center h-7 bg-[#0d0d0d] border-b border-gray-800 shrink-0 overflow-visible select-none z-[1]">
      {/* Tabs + "+" at end */}
      <div className="flex-1 flex items-center overflow-x-auto">
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;
          const isDragOver = dragOverTabId === tab.id;
          const isKept = keptIds?.has(tab.id);
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
              } ${isDragOver ? 'border-l-2 border-l-purple-500' : ''} ${
                isKept && !isActive ? 'border-b border-b-purple-500/30' : ''
              }`}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab)}
            >
              <span className="font-mono text-[9px]">{tabIcon(tab.viewType)}</span>
              <span className="truncate max-w-[100px]">{tab.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onCloseTab(tab.id); }}
                className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all p-0.5"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          );
        })}
        {/* "+" sits after the last tab */}
        <button
          onClick={onAddTab}
          className="px-1.5 h-full text-gray-500 hover:text-gray-200 hover:bg-[#0a0a0a] shrink-0 transition-colors"
          title="Add view"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* ≡ menu for kept-but-closed tabs — far right */}
      {closedKeptTabs && closedKeptTabs.length > 0 && (
        <div className="relative" ref={keptMenuRef}>
          <button
            onClick={() => setShowKeptMenu(v => !v)}
            className="px-1.5 h-full text-gray-500 hover:text-gray-200 hover:bg-[#0a0a0a] border-l border-gray-800 shrink-0 transition-colors"
            title="Kept tabs"
          >
            <span className="text-sm font-bold leading-none">&#x2261;</span>
          </button>
          {showKeptMenu && (
            <div className="absolute top-full right-0 mt-0 z-50 bg-[#1a1a1a] border border-gray-700 rounded shadow-xl min-w-[160px] py-1">
              {closedKeptTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => { onReopenKeptTab?.(tab); setShowKeptMenu(false); }}
                  className="w-full text-left px-3 py-1.5 text-[11px] text-gray-300 hover:bg-gray-700/50 hover:text-white transition-colors"
                >
                  {tab.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
