'use client';

import { Terminal, X } from 'lucide-react';
import type { PaneState, PaneTab, ViewType, WorkbenchAction } from './workbench-state.types';
import type { ReactNode } from 'react';

// ─── Bottom dock ───────────────────────────────────────────────

export function BottomDock({
  pane,
  dispatch,
  renderView,
}: {
  pane: PaneState;
  dispatch: (action: WorkbenchAction) => void;
  renderView: (viewType: ViewType, instanceId?: string, tab?: PaneTab) => ReactNode;
}) {
  const activeTab = pane.tabs.find(t => t.id === pane.activeTabId) || pane.tabs[0];

  return (
    <div className="border-t border-gray-700 shrink-0 flex flex-col bg-[#0d0d0d]" style={{ height: pane.minSize || 180 }}>
      {/* Bottom dock tab bar */}
      <div className="flex items-center h-7 bg-[#0a0a0a] border-b border-gray-800 shrink-0">
        <div className="flex items-center">
          {pane.tabs.map(tab => {
            const isActive = tab.id === pane.activeTabId;
            return (
              <button
                key={tab.id}
                onClick={() => dispatch({ type: 'SET_ACTIVE_TAB', paneId: pane.id, tabId: tab.id })}
                className={`flex items-center gap-1 px-2 h-full text-[10px] border-r border-gray-800 transition-colors ${
                  isActive
                    ? 'bg-[#111] text-gray-200 border-b-2 border-b-purple-500'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <Terminal className="w-2.5 h-2.5" />
                <span className="truncate max-w-[80px]">{tab.title}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: 'CLOSE_TAB', paneId: pane.id, tabId: tab.id }); }}
                  className="text-gray-600 hover:text-red-400 ml-0.5"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => {
            dispatch({ type: 'ADD_BOTTOM_PANE' });
          }}
          className="px-1.5 h-full text-gray-500 hover:text-gray-200 hover:bg-[#0a0a0a] border-l border-gray-800 transition-colors"
          title="Add terminal"
        >
          <Terminal className="w-3 h-3" />
        </button>
        <button
          onClick={() => dispatch({ type: 'CLOSE_BOTTOM_PANE' })}
          className="px-1.5 h-full text-gray-500 hover:text-red-400 hover:bg-[#0a0a0a] border-l border-gray-800 transition-colors"
          title="Close bottom panel"
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {activeTab && renderView(activeTab.viewType, activeTab.instanceId, activeTab)}
      </div>
    </div>
  );
}
