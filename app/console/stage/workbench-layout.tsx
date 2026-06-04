'use client';

import { useCallback, type ReactNode } from 'react';
import type { PaneTab, ViewType, WorkbenchState, WorkbenchAction } from './workbench-state.types';
import { genTabId, findPane } from './workbench-state';
import { LayoutNodeRenderer } from './layout-node-renderer';
import { BottomDock } from './bottom-dock';

interface WorkbenchLayoutProps {
  state: WorkbenchState;
  dispatch: (action: WorkbenchAction) => void;
  renderView: (viewType: ViewType, instanceId?: string, tab?: PaneTab) => ReactNode;
  onRequestView?: (paneId: string, tabId: string, viewType: ViewType) => void;
  onContextTab?: (tab: PaneTab, e: React.MouseEvent) => void;
  onReorderTabs?: (paneId: string, tabId: string, targetId: string) => void;
  closedKeptTabs?: PaneTab[];
  onReopenKeptTab?: (tab: PaneTab) => void;
  onCloseTab?: (paneId: string, tabId: string, tab: PaneTab) => void;
  persistentTabIds?: string[];
}

// ─── Main layout ───────────────────────────────────────────────

export function WorkbenchLayout({ state, dispatch, renderView, onRequestView, onContextTab, onReorderTabs, closedKeptTabs, onReopenKeptTab, onCloseTab: onBeforeCloseTab, persistentTabIds }: WorkbenchLayoutProps) {
  const onFocusPane = useCallback((id: string) => {
    dispatch({ type: 'FOCUS_PANE', paneId: id });
  }, [dispatch]);

  const onSelectTab = useCallback((paneId: string, tabId: string) => {
    dispatch({ type: 'SET_ACTIVE_TAB', paneId, tabId });
  }, [dispatch]);

  const onCloseTab = useCallback((paneId: string, tabId: string) => {
    const pane = findPane(state.root, paneId) || state.bottom;
    const tab = pane && pane.kind === 'pane' ? pane.tabs.find(t => t.id === tabId) : undefined;
    if (tab) onBeforeCloseTab?.(paneId, tabId, tab);
    dispatch({ type: 'CLOSE_TAB', paneId, tabId });
  }, [dispatch, state, onBeforeCloseTab]);

  const onAddTab = useCallback((paneId: string) => {
    const tabId = genTabId();
    dispatch({
      type: 'ADD_TAB',
      paneId,
      tab: { id: tabId, title: 'New', viewType: 'empty' },
    });
  }, [dispatch]);

  const handleReorderTabs = useCallback((paneId: string, tabId: string, targetId: string) => {
    dispatch({ type: 'REORDER_TABS', paneId, tabId, targetId });
  }, [dispatch]);

  return (
    <div className="flex flex-col flex-1 min-w-0 min-h-0">
      {/* Main area */}
      <LayoutNodeRenderer
        node={state.root}
        activePaneId={state.activePaneId}
        onFocusPane={onFocusPane}
        onSelectTab={onSelectTab}
        onCloseTab={onCloseTab}
        onAddTab={onAddTab}
        onRequestView={onRequestView}
        renderView={renderView}
        onContextTab={onContextTab}
        onReorderTabs={handleReorderTabs}
        closedKeptTabs={closedKeptTabs}
        onReopenKeptTab={onReopenKeptTab}
        persistentTabIds={persistentTabIds}
      />

      {/* Bottom dock */}
      {state.bottom && (
        <BottomDock pane={state.bottom} dispatch={dispatch} renderView={renderView} />
      )}
    </div>
  );
}
