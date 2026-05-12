'use client';

import type { ReactNode } from 'react';
import { PaneTabBar } from './pane-tab-bar';
import { EmptyPane } from './empty-pane';
import type { PaneState, PaneTab, ViewType } from './workbench-state';

interface PaneViewProps {
  pane: PaneState;
  isActive: boolean;
  onFocus: () => void;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTab: () => void;
  onRequestView?: (tabId: string, viewType: ViewType) => void;
  renderView: (viewType: ViewType, instanceId?: string) => ReactNode;
  onContextTab?: (tab: PaneTab, e: React.MouseEvent) => void;
  onReorderTabs?: (tabId: string, targetId: string) => void;
  closedKeptTabs?: PaneTab[];
  onReopenKeptTab?: (tab: PaneTab) => void;
  persistentTabIds?: string[];
}

export function PaneView({ pane, isActive, onFocus, onSelectTab, onCloseTab, onAddTab, onRequestView, renderView, onContextTab, onReorderTabs, closedKeptTabs, onReopenKeptTab, persistentTabIds }: PaneViewProps) {
  const activeTab = pane.tabs.find(t => t.id === pane.activeTabId) || pane.tabs[0];
  if (!activeTab) {
    return (
      <div className="flex flex-col flex-1 min-w-0 min-h-0" onClick={onFocus}>
        <div className="flex-1 flex items-center justify-center text-gray-600 text-[10px]">No tabs — close pane or add a view</div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col flex-1 min-w-0 min-h-0 ${isActive ? '' : ''}`}
      onClick={onFocus}
    >
      <PaneTabBar
        tabs={pane.tabs}
        activeTabId={pane.activeTabId}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onAddTab={onAddTab}
        onContextTab={onContextTab}
        onReorderTabs={onReorderTabs}
        closedKeptTabs={closedKeptTabs}
        onReopenKeptTab={onReopenKeptTab}
        persistentTabIds={persistentTabIds}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative">
        {pane.tabs.map(tab => (
          <div
            key={tab.id}
            className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden"
            style={tab.id === pane.activeTabId
              ? { display: 'flex', visibility: 'visible' }
              : { display: 'flex', position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none' }
            }
          >
            {tab.viewType === 'empty' ? (
              <EmptyPane onSelectView={(vt) => onRequestView?.(tab.id, vt)} />
            ) : (
              renderView(tab.viewType, tab.instanceId)
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
