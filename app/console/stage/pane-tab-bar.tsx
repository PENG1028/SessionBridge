'use client';

import { Plus, X } from 'lucide-react';
import type { PaneTab } from './workbench-state';

interface PaneTabBarProps {
  tabs: PaneTab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTab: () => void;
}

const VIEW_ICONS: Record<string, string> = {
  terminal: '>_',
  'claude-chat': '♢',
  dashboard: '▦',
  'agent-monitor': '◎',
  logs: '☰',
  ai: '◇',
  'file-explorer': '📁',
  empty: '+',
};

export function PaneTabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onAddTab }: PaneTabBarProps) {
  return (
    <div className="flex items-center h-7 bg-[#0d0d0d] border-b border-gray-800 shrink-0 overflow-hidden">
      <div className="flex-1 flex items-center overflow-x-auto">
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={`group flex items-center gap-1 px-2 h-full text-[10px] border-r border-gray-800 cursor-pointer shrink-0 transition-colors ${
                isActive
                  ? 'bg-[#111] text-gray-200 border-b-2 border-b-purple-500'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-[#0a0a0a]'
              }`}
              onClick={() => onSelectTab(tab.id)}
            >
              <span className="font-mono text-[9px]">{VIEW_ICONS[tab.viewType] || '?'}</span>
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
