'use client';

// ─── useWorkbenchLayout ───────────────────────────────────────────
// Manages the workbench pane/tab layout state and persistence.
// Extracted from page.tsx: appState, dispatch, tab management,
// layout persistence, pane focus, enter node logic.

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useSetActiveNode } from '../core/core-client-provider';
import {
  appReducer,
  createAppInitialState,
  getActiveWorkbenchState,
  createInitialState,
  findPane as findPaneInTree,
  saveLayoutsToStorage,
  loadLayoutsFromStorage,
  restoreInstanceStatesFromStorage,
  genTabId,
  type PaneTab,
  type LayoutNode,
  type ViewType,
  type AppWorkbenchState,
  type WorkbenchAction,
  type AppWorkbenchAction,
} from './workbench-state';
import type { InstanceInfo } from '../../../lib/use-ws';
import type { ConnStatus } from '../../../lib/use-ws';

export function useWorkbenchLayout(
  connStatus: ConnStatus,
  instances: InstanceInfo[],
) {
  const setActiveNode = useSetActiveNode();
  const [appState, setAppState] = useState<AppWorkbenchState>(() => createAppInitialState());

  const appDispatch = useCallback((action: AppWorkbenchAction) => {
    setAppState(prev => appReducer(prev, action));
  }, []);

  const activeWorkbenchDispatch = useCallback((action: WorkbenchAction) => {
    setAppState(prev => {
      const activeId = prev.activeInstanceId;
      if (activeId && prev.instanceStates[activeId]) {
        return appReducer(prev, { type: 'INSTANCE_ACTION', instanceId: activeId, action });
      }
      return appReducer(prev, { type: 'GLOBAL_ACTION', action });
    });
  }, []);

  const activeWorkbenchState = useMemo(
    () => getActiveWorkbenchState(appState),
    [appState],
  );

  const appStateRef = useRef(appState);
  appStateRef.current = appState;

  // ── Sync activeInstanceId → CoreClient targetNodeId ──
  useEffect(() => {
    setActiveNode(appState.activeInstanceId || null);
  }, [appState.activeInstanceId, setActiveNode]);

  // ── Pane focus ──
  const paneFocus = useMemo(() => {
    if (!activeWorkbenchState) return null;
    const activePane = activeWorkbenchState.root.kind === 'pane'
      ? activeWorkbenchState.root
      : findPaneInTree(activeWorkbenchState.root, activeWorkbenchState.activePaneId);
    if (!activePane) return null;
    const activeTab = activePane.tabs.find(t => t.id === activePane.activeTabId) || activePane.tabs[0];
    if (!activeTab) return null;
    return { paneId: activePane.id, viewType: activeTab.viewType, instanceId: activeTab.instanceId };
  }, [activeWorkbenchState]);

  // ── Restore saved layouts from localStorage when connected ──
  const instancesRestoredRef = useRef(false);
  const wasDisconnectedRef = useRef(true);

  useEffect(() => {
    if (connStatus.status === 'connected') {
      if (wasDisconnectedRef.current) {
        wasDisconnectedRef.current = false;
        instancesRestoredRef.current = false;
      }
    } else {
      wasDisconnectedRef.current = true;
    }
  }, [connStatus.status]);

  useEffect(() => {
    if (connStatus.status !== 'connected' || instancesRestoredRef.current) return;
    instancesRestoredRef.current = true;

    const saved = loadLayoutsFromStorage();
    if (!saved) return;

    const { states, persistentTabs } = restoreInstanceStatesFromStorage(
      saved.instanceStates, saved.persistentTabs as PaneTab[], [],
    );
    const mergedIds = new Set([...(saved.workbenchInstanceIds || []), ...Object.keys(states)]);

    setAppState(prev => {
      let next = prev;
      if (persistentTabs.length > 0) next = { ...next, persistentTabs };
      for (const [id, state] of Object.entries(states)) {
        if (!next.instanceStates[id]) {
          next = appReducer(next, { type: 'RESTORE_INSTANCE_STATE', instanceId: id, state });
        }
      }
      if (mergedIds.size > 0) {
        next = appReducer(next, { type: 'SET_WORKBENCH_INSTANCES', instanceIds: [...mergedIds] });
      }
      if (saved.activeInstanceId && next.instanceStates[saved.activeInstanceId]) {
        next = appReducer(next, { type: 'SET_ACTIVE_INSTANCE', instanceId: saved.activeInstanceId });
      }
      return next;
    });
  }, [connStatus.status]);

  // ── Auto-save layouts to localStorage with debounce ──
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      if (Object.keys(appState.instanceStates).length === 0 && appState.workbenchInstanceIds.length === 0) return;
      saveLayoutsToStorage(appState.instanceStates, appState.persistentTabs, appState.workbenchInstanceIds, appState.activeInstanceId);
    }, 500);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [appState.instanceStates, appState.persistentTabs, appState.workbenchInstanceIds, appState.activeInstanceId]);

  // Save on beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      const state = appStateRef.current;
      if (Object.keys(state.instanceStates).length > 0 || state.workbenchInstanceIds.length > 0) {
        saveLayoutsToStorage(state.instanceStates, state.persistentTabs, state.workbenchInstanceIds, state.activeInstanceId);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // ── Enter a node ──
  const handleEnterNode = useCallback((nodeId: string) => {
    const currentState = appStateRef.current;
    if (currentState.activeInstanceId === nodeId) {
      setAppState(prev => appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: null }));
    } else {
      setAppState(prev => {
        if (prev.instanceStates[nodeId]) {
          return appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: nodeId });
        }
        const newLayout = createInitialState();
        return appReducer(
          { ...prev, instanceStates: { ...prev.instanceStates, [nodeId]: newLayout } },
          { type: 'SET_ACTIVE_INSTANCE', instanceId: nodeId },
        );
      });
    }
  }, []);

  // ── Tab operations ──
  const handleReopenKeptTab = useCallback((tab: PaneTab) => {
    const active = getActiveWorkbenchState(appStateRef.current);
    const pane = findPaneInTree(active.root, active.activePaneId);
    if (pane) {
      activeWorkbenchDispatch({ type: 'ADD_TAB', paneId: pane.id, tab: { ...tab, id: genTabId() } });
    }
  }, [activeWorkbenchDispatch]);

  const handleRequestView = useCallback((paneId: string, tabId: string, viewType: ViewType) => {
    const state = appStateRef.current;
    const active = getActiveWorkbenchState(state);
    const pane = findPaneInTree(active.root, paneId) || active.bottom;
    const existingTab = pane?.tabs.find(t => t.id === tabId);
    activeWorkbenchDispatch({
      type: 'SET_TAB_VIEW', paneId, tabId, viewType,
      title: viewType.charAt(0).toUpperCase() + viewType.slice(1),
      instanceId: existingTab?.instanceId,
    });
  }, [activeWorkbenchDispatch]);

  const handleReorderTabs = useCallback((paneId: string, tabId: string, targetId: string) => {
    activeWorkbenchDispatch({ type: 'REORDER_TABS', paneId, tabId, targetId });
  }, [activeWorkbenchDispatch]);

  const handleCloseTab = useCallback((_paneId: string, _tabId: string, tab: PaneTab) => {
    if (!tab.instanceId) return;
    const isKept = appStateRef.current.persistentTabs.some(t => t.id === tab.id);
    if (isKept) return;
    setAppState(prev => appReducer(prev, { type: 'REMOVE_INSTANCE_LAYOUT', instanceId: tab.instanceId! }));
  }, []);

  // ── Closed kept tabs ──
  const closedKeptTabs = useMemo(() => {
    const openTabIds = new Set<string>();
    const collect = (node: LayoutNode) => {
      if (node.kind === 'pane') node.tabs.forEach(t => openTabIds.add(t.id));
      else node.children.forEach(collect);
    };
    collect(activeWorkbenchState.root);
    if (activeWorkbenchState.bottom) {
      activeWorkbenchState.bottom.tabs.forEach(t => openTabIds.add(t.id));
    }
    return appState.persistentTabs.filter(t => !openTabIds.has(t.id));
  }, [activeWorkbenchState, appState.persistentTabs]);

  return {
    appState, setAppState,
    appStateRef,
    appDispatch,
    activeWorkbenchDispatch,
    activeWorkbenchState,
    paneFocus,
    handleEnterNode,
    handleReopenKeptTab,
    handleRequestView,
    handleReorderTabs,
    handleCloseTab,
    closedKeptTabs,
  };
}
