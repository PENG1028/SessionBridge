'use client';

// Prerendering disabled — page uses browser-only APIs (WebSocket, localStorage, indexedDB)
export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSession } from '../../../lib/use-ws';
import { MobileSidebar } from '../sidebar/mobile-sidebar';
import { MobileRightPanel } from '../sidebar/mobile-right-panel';
import { useSessionSearch } from '../shell/use-session-search';
import { useAppChrome } from '../shell/use-app-chrome';
import { useToolTracking } from '../shell/use-tool-tracking';
import { LeftSidebar } from '../sidebar/left-sidebar';
import { RightSidebar } from '../sidebar/right-sidebar';
import { StatusBar } from '../shell/status-bar';
import { ConsoleHeader } from '../shell/console-header';
import { getAdapterViewId, getViewEntry, getAllAdapterTypes } from '../main/view-registry';
import { useCore, useSetActiveNode, useActiveNodeId, useLocalNodeId, useTargetReachability } from '../core/core-client-provider';
import { CoreErrorBanner } from '../core/core-error-banner';
import { classifyCoreError } from '../core/core-error';
import { useCoreErrors } from '../core/use-core-call';
import { useAppSync } from '../core/use-app-sync';
import { useNotification } from '../shared/notification-context';
import { sessionStore } from '../../../lib/session-store';
import { useMessageSessions } from '../hooks/use-message-sessions';
import { useHistoryLoader } from '../hooks/use-history-loader';
import { useCommandHandlers } from '../hooks/use-command-handlers';
import { useKeyboardShortcuts } from '../hooks/use-keyboard-shortcuts';
import { useContextMenu } from '../hooks/use-context-menu';
import type { ContextMenuRequest, ContextMenuItemSpec } from '../menus/context-menu-types';
import { registerBuiltinCommands } from '../commands/register-builtin-commands';
// Host component registration is now driven by plugin.yaml → syncAllPlugins
import './console/plugin-host'; // side-effect: registers host component library
import { registerCommand, getCommand } from '../commands/command-registry';
import { getAction, getActions } from '../actions/action-registry';
import { runWorkbenchCommand } from '../actions/workbench-command-dispatch';
import type { ActionRunContext } from '../actions/action-types';
import type { ContextMenuItem } from '../shell/context-menu';
import { ConsoleOverlays } from '../overlays/console-overlays';
import { getLastActiveDir, setLastActiveDir, getRestoreLastPath, addPathBookmark, setBookmarkScope } from '../../lib/path-bookmarks';
import { useFileTree } from '../files/use-file-tree';
import { NodeBar } from '../stage/node-bar';
import { NodeNetworkView } from '../../../plugins/mesh';
import { KeyHintOverlay } from '../chrome/key-hint-overlay';
import { DisconnectBanner } from './disconnect-banner';
import { WorkbenchTopBar } from './workbench-top-bar';
import { LayoutProvider, useLayout, SidebarSlot, MainSlot, FocusProvider, RuntimePolicyProvider, useFocus, useRuntimePolicy, WorkbenchProvider, SessionProvider, InputProvider, ToolActivityProvider } from '../workbench';
import { WorkbenchLayout } from '../stage/workbench-layout';
import { appReducer, createAppInitialState, getActiveWorkbenchState, createInitialState, findPane as findPaneInTree, ensureInstanceTab, saveLayoutsToStorage, loadLayoutsFromStorage, restoreInstanceStatesFromStorage, genTabId, collectAllTabs, type ViewType, type PaneTab, type LayoutNode, type WorkbenchState, type WorkbenchAction, type AppWorkbenchState, type AppWorkbenchAction } from '../stage/workbench-state';
import { useBlockProcessor } from '../hooks/use-block-processor';
import type { Phase, Block, Message, Turn, ToolActivity, TaskInfo } from '../../lib/session-types';
import { getTime, genId, shortenPath, toAppMessages, toStorageMessages, parseSessionBlocks } from '../../lib/message-utils';


// ==========================================
// Main Page
// ==========================================

interface AppCoreProps {
  wsUrl: string;
  setWsUrl: (url: string) => void;
  token: string | undefined;
  setToken: React.Dispatch<React.SetStateAction<string | undefined>>;
  onReconnect: () => void;
  isLocalPage: boolean;
  browserId: string | undefined;
}

export function AppShell({ wsUrl, setWsUrl, token, setToken, onReconnect, isLocalPage, browserId }: AppCoreProps) {
  const { state, dispatch } = useLayout();

  // ── No virtual window — render all messages ──
  const [terminalTab, setTerminalTab] = useState<'log' | 'raw'>('log');
  const [viewingFile, setViewingFile] = useState<{path: string; content: string} | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileRightOpen, setMobileRightOpen] = useState(false);
  // ── Project / Session state ──────────────
  const [projectInfo, setProjectInfo] = useState<{cwd: string; projectName: string; homeDir?: string} | null>(null);
  const [savedSessions, setSavedSessions] = useState<{id: string; label: string; dir: string; ts: string}[]>([]);
  const [showDirSwitcher, setShowDirSwitcher] = useState(false);
  const [switchDirLocal, setSwitchDirLocal] = useState('');
  const [switching, setSwitching] = useState(false);
  const core = useCore();
  const setActiveNode = useSetActiveNode();

  useEffect(() => {
    if (!core?.isConnected) return;
    core.call<{cwd?: string; projectName?: string; homeDir?: string}>('node.info', {})
      .then(info => {
        setProjectInfo({
          cwd: info.cwd || '.',
          projectName: info.projectName || '',
          homeDir: info.homeDir || '',
        });
        const realKey = (info.cwd || '.').replace(/[/\\:]/g, '_');
        if (realKey !== 'default') {
          setMessagesBySession(prev => {
            if (!prev['default']?.length) return prev;
            const next: Record<string, Message[]> = {};
            for (const [k, v] of Object.entries(prev)) {
              next[k === 'default' ? realKey : k] = v as Message[];
            }
            return next;
          });
        }
      })
      .catch(err => coreErrors.reportError({method: "node.info", error: classifyCoreError(err), timestamp: Date.now()}));
  }, [core, core.isConnected]);

  // Re-fetch project info when the active target node changes.

  // ── Fetch real absolute working directory from Core (not from node.info) ──
  useEffect(() => {
    if (!core?.isConnected) return;
    core.call<{cwd?: string}>('env.cwd', {})
      .then(res => {
        const cwd = (res?.cwd || '').replace(/\\/g, '/');
        if (cwd) {
          setAbsoluteCwd(cwd);
          setProjectInfo(prev => prev ? { ...prev, cwd } : { cwd, projectName: '', homeDir: '' });
        }
      })
      .catch(err => coreErrors.reportError({method: "env.cwd", error: classifyCoreError(err), timestamp: Date.now()}));
  }, [core, core.isConnected]);

  // ── File tree state (per-node, keyed by wsUrl) ──
  const [absoluteCwd, setAbsoluteCwd] = useState('');

  const actionEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cmdPanelRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);

  // ── Core error reporting — unified channel ──
  const coreErrors = useCoreErrors();

  const { notify, dismiss } = useNotification();

  const onSystemNotify = useCallback((n: { id?: string; type: string; title: string; message?: string; scenarioId?: string; duration?: number; action?: { label: string; onClick: () => void } }) => {
    const severity = (n.type === 'success' || n.type === 'warning' || n.type === 'error') ? n.type : 'info';
    notify({ id: n.id, type: severity, title: n.title, message: n.message, duration: n.duration, action: n.action });
  }, [notify]);


  const { connStatus, msgLog, sendInput, sendCommand, activeSessionId, queueStatus, instances, activeInstanceId, activateInstance, createInstance, killInstance } = useSession(wsUrl, token ?? undefined, undefined, undefined, undefined, onSystemNotify, dismiss);

  // ── Tool tracking ────────────────────────
  const {
    phase, setPhase,
    currentActivity, setCurrentActivity,
    logs, setLogs, addLog,
    activeTasks, setActiveTasks,
    toolActivities, setToolActivities,
    expandedToolOutputs, setExpandedToolOutputs,
    taskTimer,
    handleInterrupt,
  } = useToolTracking(sendCommand);

  // ── Core plugin manifest → extension points sync ──
  const handleCorePluginCommand = useCallback((commandId: string) => {
    sendCommand(commandId, {});
  }, [sendCommand]);
  useAppSync(core, handleCorePluginCommand);

  const connectionUnstable = connStatus.status !== 'connected';

  // Phase 4I: activeAdapterId/viewId/isActiveRunning/whenContext are derived
  // from paneFocus below — context menu and extension commands follow the
  // current tab's binding, not the global activeInstanceId.

  // Plugin contributions are registered by useAppSync via CoreClient.

  // ── Workbench pane/tab layout state (Phase 4N: per-instance workbench) ──
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
  const activeWorkbenchState = useMemo(() => getActiveWorkbenchState(appState), [appState]);
  const appStateRef = useRef(appState);
  appStateRef.current = appState;

  // Sync activeInstanceId -> CoreClient targetNodeId.
  // Go dispatcher's localNodeID check handles local vs remote routing.
  useEffect(() => {
    setActiveNode(appState.activeInstanceId || null);
  }, [appState.activeInstanceId, setActiveNode]);

  // Re-fetch project info when the active target node changes.
  useEffect(() => {
    if (!core?.isConnected) return;
    core.call<{cwd?: string; projectName?: string; homeDir?: string}>("node.info", {})
      .then(info => {
        setProjectInfo(prev => ({
          cwd: info.cwd || prev?.cwd || ".",
          projectName: info.projectName || prev?.projectName || "",
          homeDir: info.homeDir || prev?.homeDir || "",
        }));
      })
      .catch(err => coreErrors.reportError({method: "node.info", error: classifyCoreError(err), timestamp: Date.now()}));
  }, [appState.activeInstanceId, core, core.isConnected]);

  const activeNodeWsUrl = useMemo(() => {
    const nodeId = appState.activeInstanceId;
    return nodeId?.startsWith('upstream:') ? nodeId.slice('upstream:'.length) : wsUrl;
  }, [appState.activeInstanceId, wsUrl]);

  // ── File tree state (uses activeNodeWsUrl, must be after its definition) ──
  const {
    fileTree, expandedDirs,
    fetchDir, onNavigatePath: fileTreeNavigatePath, toggleDir,
  } = useFileTree(wsUrl, activeNodeWsUrl, absoluteCwd);

  // ── File open: CoreClient fs.read ──
  const handleOpenFile = useCallback((filePath: string) => {
    if (!core?.isConnected) return;
    core.call<{ path: string; content: string }>('fs.read', { path: filePath })
      .then(data => {
        if (data.content !== undefined) {
          setViewingFile({ path: data.path || filePath, content: data.content });
        }
      })
      .catch(err => coreErrors.reportError({method: "fs.read", error: classifyCoreError(err), timestamp: Date.now()}));
  }, [core]);

  // Sync bookmark scope with active node
  useEffect(() => {
    try {
      const host = activeNodeWsUrl !== wsUrl ? new URL(activeNodeWsUrl).hostname : null;
      setBookmarkScope(host);
      window.dispatchEvent(new CustomEvent('sb-bookmarks-changed'));
      } catch { /* URL may be malformed during transition — harmless */ }
  }, [activeNodeWsUrl, wsUrl]);

  // Wraps useFileTree's onNavigatePath with bookmark persistence
  const onNavigatePath = useCallback((path: string) => {
    setLastActiveDir(path);
    fileTreeNavigatePath(path);
  }, [fileTreeNavigatePath]);

  // Phase 4I: Instance changes (sidebar click) no longer auto-create tabs.
  // Tab is the subject — instance is a tab's binding. Only shell tabs are
  // restored on reconnect via the instances[] effect below.

  const prevInstanceIds = useRef<string[]>([]);
  useEffect(() => {
    if (connStatus.status !== 'connected') return;
    prevInstanceIds.current = instances.map((i: any) => i.id);
  }, [instances, connStatus.status]);

  // ── Pane focus / Chrome policy ────────────
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
  const noActiveNode = !appState.activeInstanceId;

  // ── Shell chrome (banners, sidebars, command palette, status bar) ──
  const {
    showBanner, showCommandPalette, setShowCommandPalette,
    settingsOpen, setSettingsOpen,
    effectiveLeftOpen, effectiveRightOpen,
    showStatusBar, chromePolicy,
    toggleLeftSidebar, toggleRightSidebar,
  } = useAppChrome(connStatus, paneFocus, noActiveNode);

  // Reachability: if a remote node is selected but mesh is broken, overlay the content area.
  const reachabilityNodeId = appState.activeInstanceId ?? null;
  const localNodeId = useLocalNodeId();
  const remoteReachable = useTargetReachability(reachabilityNodeId);
  const showRemoteOverlay = !!(
    reachabilityNodeId &&
    localNodeId &&
    reachabilityNodeId !== localNodeId &&
    !remoteReachable
  );

  // ── Focus-based context (for context menu + command palette) ───
  const focusInstanceId = paneFocus?.instanceId ?? null;
  const focusAdapterId = focusInstanceId
    ? instances.find(i => i.id === focusInstanceId)?.adapterId ?? ''
    : '';
  const focusViewId = paneFocus?.viewType || '';
  const focusIsRunning = focusInstanceId
    ? instances.some(i => i.id === focusInstanceId && i.status === 'running')
    : false;
  const focusWhenContext = { activeAdapterId: focusAdapterId, view: focusViewId, isRunning: focusIsRunning };

  // Command palette entries come from the action registry only.
  // Plugin commands are registered directly by useAppSync.
  const paletteCommands = useMemo(() => {
    const registryActions: Array<{ id: string; title: string; category?: string }>
      = getActions('commandPalette', focusWhenContext as Record<string, unknown>);
    return registryActions.map(a => ({ id: a.id, title: a.title, category: a.category || 'Core' }));
  }, [focusWhenContext]);

  // ── Command registry setup (Phase 4E) ──────────────────
  // Built-in commands + extension commands are registered into the
  // command registry once per session. This runs once on mount.
  const commandsInitializedRef = useRef(false);
  useEffect(() => {
    if (commandsInitializedRef.current) return;
    commandsInitializedRef.current = true;

    registerBuiltinCommands({
      sendCommand,
      sendInput: (text: string) => sendInput(text, activeSessionId || undefined),
      killInstance,
      reload: () => window.location.reload(),
    });

    // Plugin host component library registered via side-effect import above.
    // Actual activation of components is driven by plugin.yaml → syncAllPlugins.

    // Phase 4N: keep/unkeep tab commands for context menu
    registerCommand({
      id: 'tab.keep',
      title: 'Keep Tab',
      handler: (args?: any) => {
        if (args?.tab) appDispatch({ type: 'KEEP_TAB', tab: args.tab });
      },
    });
    registerCommand({
      id: 'tab.unkeep',
      title: 'Unkeep Tab',
      handler: (args?: any) => {
        if (args?.tabId) appDispatch({ type: 'UNKEEP_TAB', tabId: args.tabId });
      },
    });
  }, [sendCommand, sendInput, killInstance, activeSessionId]);

  // Close command palette when the active view disables it
  useEffect(() => {
    if (!chromePolicy.commandPalette) {
      setShowCommandPalette(false);
    }
  }, [chromePolicy.commandPalette]);

  // ── Instance lifecycle → notifications ──
  const prevInstanceIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set(instances.map((i: any) => i.id));
    const prevIds = prevInstanceIdsRef.current;
    for (const id of currentIds) {
      if (!prevIds.has(id) && prevIds.size > 0) {
        const inst = instances.find((i: any) => i.id === id);
        if (inst) notify({ type: 'success', title: 'Instance connected', message: inst.label });
      }
    }
    for (const id of prevIds) {
      if (!currentIds.has(id)) {
        notify({ type: 'info', title: 'Instance removed', message: id });
      }
    }
    prevInstanceIdsRef.current = currentIds;
  }, [instances, notify]);

  // ── Restore saved layouts from localStorage when instances arrive (Phase 4N) ──
  const instancesRestoredRef = useRef(false);
  // Reset restore flag on reconnect so persisted layouts re-apply
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
    if (saved) {
      // CoreClient mode: no relay instances to validate against — restore all saved layouts.
      const { states, persistentTabs } = restoreInstanceStatesFromStorage(
        saved.instanceStates, saved.persistentTabs as PaneTab[], []
      );
      const mergedIds = new Set([
        ...(saved.workbenchInstanceIds || []),
        ...Object.keys(states),
      ]);
      setAppState(prev => {
        let next = prev;
        if (persistentTabs.length > 0) {
          next = { ...next, persistentTabs };
        }
        for (const [id, state] of Object.entries(states)) {
          if (!next.instanceStates[id]) {
            next = appReducer(next, { type: 'RESTORE_INSTANCE_STATE', instanceId: id, state });
          }
        }
        if (mergedIds.size > 0) {
          next = appReducer(next, { type: 'SET_WORKBENCH_INSTANCES', instanceIds: [...mergedIds] });
        }
        // Restore last active node so terminal/workbench reappears on refresh
        if (saved.activeInstanceId && next.instanceStates[saved.activeInstanceId]) {
          next = appReducer(next, { type: 'SET_ACTIVE_INSTANCE', instanceId: saved.activeInstanceId });
        }
        return next;
      });
    }
  }, [connStatus.status]);

  // Auto-enter local node on first visit (no saved layout, but CoreClient is connected)
  const autoEnterAttemptedRef = useRef(false);
  useEffect(() => {
    if (!core?.isConnected || autoEnterAttemptedRef.current) return;
    if (appState.activeInstanceId) return; // already in a node
    const saved = loadLayoutsFromStorage();
    if (saved?.activeInstanceId) return; // layout restore will handle it
    autoEnterAttemptedRef.current = true;
    core.call<{ nodeId: string }>('node.identity.get').then(identity => {
      const localId = identity?.nodeId || 'local';
      if (!appStateRef.current.activeInstanceId) {
        setAppState(prev => {
          if (prev.instanceStates[localId]) {
            return appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: localId });
          }
          const newLayout = createInitialState();
          return appReducer(
            { ...prev, instanceStates: { ...prev.instanceStates, [localId]: newLayout } },
            { type: 'SET_ACTIVE_INSTANCE', instanceId: localId }
          );
        });
      }
    }).catch(err => coreErrors.reportError({method: "node.identity.get", error: classifyCoreError(err), timestamp: Date.now()})); // node.identity.get unavailable
  }, [core?.isConnected, appState.activeInstanceId]);

  // ── Auto-save layouts to localStorage with debounce (Phase 4N) ──
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      // Don't overwrite localStorage with empty state during reconnect blips
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

  // ── Remote node project info (legacy /api/info removed; uses hostname fallback) ──
  const activeNodeProjectInfo = useMemo(() => {
    if (activeNodeWsUrl === wsUrl) return projectInfo;
    try {
      const host = new URL(activeNodeWsUrl).hostname;
      return { cwd: '.', projectName: host, homeDir: '.' };
    } catch (_e) { /* React state setters never throw — safe to ignore */ }
      return { cwd: '.', projectName: 'remote', homeDir: '.' };
    }
  }, [activeNodeWsUrl, wsUrl, projectInfo]);

  const createNodeInstance = useCallback(async (dir: string, label?: string, adapterId?: string) => {
    if (activeNodeWsUrl !== wsUrl) {
      const errMsg = 'Remote instance creation now requires Core mesh run.create routing; legacy /api/instances removed.';
      addLog(`[Error] ${errMsg}`);
      return { success: false, error: errMsg };
    }
    return createInstance(dir, label, adapterId);
  }, [activeNodeWsUrl, wsUrl, createInstance, addLog]);

  const { messagesBySession, setMessagesBySession, messages, sessionKey, updateSession, handleNewSession, isRestoring, snapshots, saveSnapshot, loadSnapshot, forkFromSnapshot, knownFiles } = useMessageSessions(
    projectInfo, true, activeSessionId, activeInstanceId, addLog, sendCommand
  );

  const { historyLoadedRef, historyLoading, historyCutoffRef, processedRef, activeExternalSession, setActiveExternalSession } = useHistoryLoader(
    projectInfo, [], addLog, setMessagesBySession
  );

  const { inputValue, setInputValue, showFileSuggest, fileSuggestions, handleSubmit, handleInputChange, handleKeyDown, handleFileSuggestionClick, submittingRef, showCommands, setShowCommands, handleQuickAction, handleCommandClick } = useCommandHandlers(
    connStatus, phase, setPhase, setCurrentActivity, sendInput, sendCommand, addLog, activeSessionId, fileTree, handleInterrupt
  );

  // ── Session action wrappers (restore old page.tsx behavior: reset page-level state on session ops) ──
  const handleNewSessionWrapper = useCallback(() => {
    handleNewSession();
    setPhase('idle');
    setCurrentActivity(null);
    setActiveExternalSession(null);
    processedRef.current = 0;
    sendCommand('clear');
  }, [handleNewSession, setPhase, setCurrentActivity, setActiveExternalSession, processedRef, sendCommand]);

  const loadSnapshotWrapper = useCallback((snapshotId: string) => {
    loadSnapshot(snapshotId);
    processedRef.current = 0;
    setPhase('idle');
    setCurrentActivity(null);
  }, [loadSnapshot, processedRef, setPhase, setCurrentActivity]);

  const forkFromSnapshotWrapper = useCallback((snapshotId: string) => {
    forkFromSnapshot(snapshotId);
    processedRef.current = 0;
    setPhase('idle');
    setCurrentActivity(null);
  }, [forkFromSnapshot, processedRef, setPhase, setCurrentActivity]);

  const handleClearSession = useCallback(() => {
    setMessagesBySession({});
    localStorage.removeItem('sessionbridge-messages');
    setLogs(['[$] session-bridge connected']);
  }, [setMessagesBySession, setLogs]);
  const handleToggleCommandPalette = useCallback(() => setShowCommandPalette(v => !v), [setShowCommandPalette]);
  const handleToggleLeftSidebar = toggleLeftSidebar;
  const handleRestart = useCallback(() => sendCommand('clear'), [sendCommand]);

  useKeyboardShortcuts(messages, handleClearSession, handleToggleCommandPalette, handleToggleLeftSidebar, handleRestart, chromePolicy.globalShortcuts, state.activeViewId);

  const handleQuickCompact = useCallback(() => {
    sendInput('/compact', activeSessionId || undefined);
    addLog('[System] Sending /compact command');
  }, [sendInput, addLog, activeSessionId]);

  const setMode = useCallback((mode: string) => {
    sendCommand('setMode', { mode });
    addLog(`[System] Permission mode: ${mode}`);
  }, [sendCommand, addLog]);

  const setEffort = useCallback((level: string) => {
    sendCommand('setEffort', { level });
    addLog(`[System] Thinking effort: ${level}`);
  }, [sendCommand, addLog]);

  // ── Switch project directory ─────────────
  const handleSwitchDir = useCallback(async (dir: string) => {
    // Persist current session messages before switching directory
    const prevKey = projectInfo?.cwd ? projectInfo.cwd.replace(/[/\\:]/g, '_') : 'default';
    const prevMsgs = messagesRef.current;
    if (prevMsgs?.length > 0) {
      sessionStore.replaceMessages(prevKey, toStorageMessages(prevMsgs)).catch(() => {});
      try {
        const cached = JSON.parse(localStorage.getItem('bridge-messages') || '{}');
        cached[prevKey] = prevMsgs;
        localStorage.setItem('bridge-messages', JSON.stringify(cached));
      } catch { /* localStorage may fail (quota/availability) — safe to ignore */ }
    }
    setSwitching(true);
    try {
      // Clear in-memory messages — sessionKey is always 'default' in non-workspace mode
      setMessagesBySession({});
      // Skip old server blocks they belong to the old project
      processedRef.current = 0;
      historyLoadedRef.current = false; // reload history for new directory
      setPhase('idle'); setCurrentActivity(null);
      setProjectInfo({ cwd: dir, projectName: dir.split(/[/\\]/).pop() || '', homeDir: dir });
      addLog(`[System] Switched to ${dir.split(/[/\\]/).pop() || dir}`);
    } /* React state setters never throw — safe to ignore */ }
    setSwitching(false);
    setShowDirSwitcher(false);
    setSwitchDirLocal('');
  }, [projectInfo, fetchDir, addLog, 0]);

  // ── Search Sessions ────────────────────────
  const {
    showSearch, setShowSearch, searchQuery, setSearchQuery,
    searchResults, setSearchResults, searchLoading, setSearchLoading,
    searchInputRef, searchPanelRef,
    handleSearchInput, openSearchPanel,
  } = useSessionSearch();

  // ── Action Run Context (Phase 4E) ─────────────────────────
  const actionRunContext = useMemo<ActionRunContext>(() => ({
    view: focusViewId,
    activeAdapterId: focusAdapterId,
    isRunning: focusIsRunning,
    instanceId: focusInstanceId,
    projectCwd: activeNodeProjectInfo?.cwd || '.',
    messages,
    workbenchState: activeWorkbenchState,
    workbenchDispatch: activeWorkbenchDispatch,
    sendCommand,
    sendInput: (text: string) => sendInput(text, activeSessionId || undefined),
    createInstance: createNodeInstance,
    killInstance,
    openSettings: () => setSettingsOpen(true),
    openSearch: openSearchPanel,
    openCommandPalette: () => setShowCommandPalette(v => !v),
    toggleLeftSidebar: () => dispatch({ type: 'TOGGLE_SIDEBAR', position: 'left' }),
    toggleRightSidebar: () => dispatch({ type: 'TOGGLE_SIDEBAR', position: 'right' }),
    notify: (n) => notify({ id: n.title, type: n.type as any, title: n.title, message: n.message }),
  }), [focusViewId, focusAdapterId, focusIsRunning, focusInstanceId, activeNodeProjectInfo?.cwd, messages, activeWorkbenchState, activeWorkbenchDispatch, sendCommand, sendInput, activeSessionId, createNodeInstance, killInstance, openSearchPanel, dispatch, notify]);

  // ── Context menu — uses actionRunContext, must be after its definition ──
  const { ctxMenu, setCtxMenu, openContextMenu, handleWorkbenchContextMenu, closeContextMenu } = useContextMenu(
    actionRunContext,
    focusWhenContext,
    getAllAdapterTypes,
    activeNodeProjectInfo?.cwd || '.',
    createNodeInstance,
  );

  // Handle command palette selection — unified dispatch through runWorkbenchCommand
  const handlePaletteSelect = useCallback((cmdId: string) => {
    runWorkbenchCommand({ command: cmdId }, actionRunContext);
  }, [actionRunContext]);

  const handleLoadSession = useCallback(async (_sessionId: string, _project: string, _display?: string) => {
    addLog('[System] Session detail loading uses Core runs API — legacy /api/sessions/detail removed.');
  }, [addLog]);

  // Close search panel on outside click
  useEffect(() => {
    if (!showSearch) return;
    const handler = (e: MouseEvent) => {
      if (searchPanelRef.current && !searchPanelRef.current.contains(e.target as Node)) {
        setShowSearch(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSearch]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    actionEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages]);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs, msgLog]);

  // ── serverBlocks → Message Store (per-session) ──
  useBlockProcessor({
    serverBlocks: [],
    sessionKey,
    updateSession,
    processedRef,
    historyCutoffRef,
    setToolActivities,
    setPhase,
    setCurrentActivity,
    addLog,
    setActiveTasks,
    onNotify: notify,
  });

  // ── Turn grouping for sticky headers ──────
  const turns = useMemo((): Turn[] => {
    const result: Turn[] = [];
    for (const msg of messages) {
      if (msg.role === 'user') {
        result.push({ userMsg: msg, assistantMsgs: [] });
      } else if (result.length > 0) {
        result[result.length - 1].assistantMsgs.push(msg);
      }
    }
    return result;
  }, [messages]);

  // ── Fork dialog state ────────────────────
  const [forkTarget, setForkTarget] = useState<number | null>(null);
  const [forkPrompt, setForkPrompt] = useState('');

  // Fork dialog callbacks
  const handleForkRewind = useCallback((targetIdx: number) => {
    const allMsgs = messagesBySession[sessionKey] || [];
    const turnMsgs: Message[] = [turns[targetIdx].userMsg, ...turns[targetIdx].assistantMsgs];
    const cutoffIdx = allMsgs.indexOf(turnMsgs[turnMsgs.length - 1]) + 1;
    updateSession(sessionKey, () => allMsgs.slice(0, cutoffIdx));
    processedRef.current = 0;
    setPhase('idle');
    setCurrentActivity(null);
    addLog(`[System] Rewound to turn ${targetIdx + 1}`);
    setForkTarget(null);
  }, [messagesBySession, sessionKey, turns, updateSession, processedRef, setPhase, setCurrentActivity, addLog, setForkTarget]);

  const handleForkSnapshot = useCallback((targetIdx: number) => {
    saveSnapshot(`Fork from turn ${targetIdx + 1}`);
    const targetText = turns[targetIdx].userMsg.content;
    addLog(`[System] Forked from turn ${targetIdx + 1}: "${targetText.slice(0, 60)}..."`);
    setForkTarget(null);
  }, [saveSnapshot, turns, addLog, setForkTarget]);

  const handleForkWithPrompt = useCallback((targetIdx: number, prompt: string) => {
    saveSnapshot(`Fork from turn ${targetIdx + 1}`);
    const targetText = turns[targetIdx].userMsg.content;
    addLog(`[System] Forked from turn ${targetIdx + 1}: "${targetText.slice(0, 60)}..." → "${prompt.slice(0, 60)}"`);
    setInputValue(prompt);
    setForkTarget(null);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.msg-input');
      input?.focus();
    }, 100);
  }, [saveSnapshot, turns, addLog, setInputValue, setForkTarget]);

  // ── Sync messagesRef for handleSwitchDir ──
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Reset submitting guard when phase leaves 'running'
  useEffect(() => {
    if (phase !== 'running') submittingRef.current = false;
  }, [phase]);

  // Close command panel on outside click
  useEffect(() => {
    if (!showCommands) return;
    const handler = (e: MouseEvent) => {
      if (cmdPanelRef.current && !cmdPanelRef.current.contains(e.target as Node)) {
        setShowCommands(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCommands]);

  // ── Connection status ──────────────────
  const statusColor = connStatus.status === 'connected' ? 'bg-green-500'
    : connStatus.status === 'connecting' ? 'bg-yellow-500'
    : showBanner ? 'bg-red-500' : 'bg-yellow-500';
  const statusText = connStatus.status === 'connected' ? 'CONNECTED'
    : connStatus.status === 'connecting' ? 'CONNECTING'
    : 'DISCONNECTED';
  const connectionLabel = connStatus.status === 'connected'
    ? 'SessionBridge'
    : 'Disconnected';
  const connectionUrl = connStatus.status === 'connected'
    ? wsUrl.replace(/^wss?:\/\//, '')
    : null;

  // Phase indicator
  const phaseColor = phase === 'idle' ? 'text-gray-500'
    : phase === 'running' ? 'text-purple-400'
    : phase === 'done' ? 'text-emerald-400'
    : 'text-red-400';
  const phaseLabel = phase === 'idle' ? 'Idle'
    : phase === 'running' ? 'Running'
    : phase === 'done' ? 'Completed'
    : 'Error';

  // ── Handle context menu on tab right-click ──
  // Phase 4K: Uses openContextMenu with tab/context chain.
  // Remaining debt: local items (Copy Name, Copy Tab ID, Type, Instance)
  // are inlined here rather than in the registry, because they reference
  // the tab object at call time. A future "tab/context" manifest or action
  // registry structure could replace these.
  const handleContextTab = useCallback((tab: PaneTab, e: React.MouseEvent) => {
    const isPersistent = appStateRef.current.persistentTabs.some(t => t.id === tab.id);
    const localItems: ContextMenuItemSpec[] = [
      { id: 'tab.copyName', title: 'Copy Name', command: 'clipboard.copy', args: { text: tab.title }, group: 'edit', order: 10 },
      { id: 'tab.copyId', title: 'Copy Tab ID', command: 'clipboard.copy', args: { text: tab.id }, group: 'edit', order: 20 },
      { id: 'tab.keepSep', title: '', separator: true, group: 'actions', order: 5 },
      {
        id: isPersistent ? 'tab.unkeep' : 'tab.keep',
        title: isPersistent ? 'Unkeep Tab' : 'Keep Tab',
        command: isPersistent ? 'tab.unkeep' : 'tab.keep',
        args: isPersistent ? { tabId: tab.id } : { tab: { id: tab.id, title: tab.title, viewType: tab.viewType, instanceId: tab.instanceId } },
        group: 'actions',
        order: 10,
      },
      { id: 'tab.sep1', title: '', separator: true, group: 'view', order: 5 },
      { id: 'tab.type', title: `Type: ${tab.viewType}`, group: 'view', order: 10 },
    ];
    if (tab.instanceId) {
      localItems.push(
        { id: 'tab.sep2', title: '', separator: true, group: 'view', order: 15 },
        { id: 'tab.instance', title: `Instance: ${tab.instanceId.slice(0, 12)}...`, group: 'view', order: 20 },
      );
    }
    openContextMenu({
      event: e,
      target: { kind: 'tab', id: tab.id, tabId: tab.id, view: tab.viewType, instanceId: tab.instanceId },
      chain: ['tab/context', 'view/context', 'workbench/context'],
      menu: 'tab/context',
      localItems,
    });
  }, [openContextMenu]);

  // ── Handle tab reorder via drag/drop ──
  const handleReorderTabs = useCallback((paneId: string, tabId: string, targetId: string) => {
    activeWorkbenchDispatch({ type: 'REORDER_TABS', paneId, tabId, targetId });
  }, [activeWorkbenchDispatch]);

  // ── Enter a node (from NodeBar or NodeNetworkView) ──
  const handleEnterNode = useCallback((nodeId: string) => {
    const currentState = appStateRef.current;
    if (currentState.activeInstanceId === nodeId) {
      // Toggle off — back to node network view
      setAppState(prev => appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: null }));
    } else {
      // Enter this node — create workbench layout if needed
      setAppState(prev => {
        if (prev.instanceStates[nodeId]) {
          return appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: nodeId });
        }
        const newLayout = createInitialState();
        return appReducer(
          { ...prev, instanceStates: { ...prev.instanceStates, [nodeId]: newLayout } },
          { type: 'SET_ACTIVE_INSTANCE', instanceId: nodeId }
        );
      });
    }
  }, []);

  // ── Closed kept tabs for ≡ menu (Phase 4N) ──
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

  const handleReopenKeptTab = useCallback((tab: PaneTab) => {
    const active = getActiveWorkbenchState(appStateRef.current);
    const pane = findPaneInTree(active.root, active.activePaneId);
    if (pane) {
      activeWorkbenchDispatch({
        type: 'ADD_TAB',
        paneId: pane.id,
        tab: { ...tab, id: genTabId() },
      });
    }
  }, [activeWorkbenchDispatch]);

  // ── Mesh/peer connections are managed through CoreClient in NodeNetworkView ──

  // ── Handle view request from pane (user picks view in EmptyPane) ──
  // Phase 4F: Opening a view NEVER auto-creates an instance. The tab is a UI
  // window that can later bind to a runtime instance via the InstancesPanel or
  // explicit "New Runtime" actions. Instance-bound views (openMode:
  // 'instance-bound') without an attached instance show an attach state.
  const workbenchStateRef = useRef(activeWorkbenchState);
  workbenchStateRef.current = activeWorkbenchState;
  const handleRequestView = useCallback((paneId: string, tabId: string, viewType: ViewType) => {
    const entry = getViewEntry(viewType);
    const defaultTitle = entry?.meta.title || viewType.charAt(0).toUpperCase() + viewType.slice(1);
    // Preserve existing instanceId so remote-agent binding isn't lost
    const state = workbenchStateRef.current;
    const pane = findPaneInTree(state.root, paneId) || state.bottom;
    const existingTab = pane?.tabs.find(t => t.id === tabId);
    activeWorkbenchDispatch({ type: 'SET_TAB_VIEW', paneId, tabId, viewType, title: defaultTitle, instanceId: existingTab?.instanceId });
  }, [activeWorkbenchDispatch]);

  // Phase 4F: Bind the active pane's current tab to an instanceId (called by views after explicit create).
  const handleBindCurrentTabInstance = useCallback((instanceId: string, surface?: any) => {
    const state = workbenchStateRef.current;
    const activePane = findPaneInTree(state.root, state.activePaneId);
    if (!activePane) return;
    const activeTab = activePane.tabs.find(t => t.id === activePane.activeTabId);
    if (!activeTab) return;
    activeWorkbenchDispatch({
      type: 'SET_TAB_VIEW',
      paneId: activePane.id,
      tabId: activeTab.id,
      viewType: activeTab.viewType,
      title: activeTab.title,
      instanceId,
      _surfaceId: surface?.surfaceId,
    });
  }, [activeWorkbenchDispatch]);

  // ── Close tab: detach from UI, leave run alive for later re-attach ──
  const handleCloseTab = useCallback((_paneId: string, _tabId: string, tab: PaneTab) => {
    const instId = tab.instanceId;
    if (!instId) return;

    const isKept = appStateRef.current.persistentTabs.some(t => t.id === tab.id);
    if (isKept) return; // kept tabs survive close via ≡ menu

    // Detach: remove UI layout binding but leave the run running.
    // The run persists in RunStore and can be re-attached later via
    // ViewSelector → Terminal or run.attach.
    setAppState(prev => appReducer(prev, { type: 'REMOVE_INSTANCE_LAYOUT', instanceId: instId }));
  }, []);

  // ── Split context values (Session, Input, ToolActivity, Workbench) ──
  // Each useMemo has a smaller dependency set, so changing inputValue won't
  // re-render components that only consume session or tool activity state.
  const sessionContextValue = useMemo(() => ({
    messages,
    turns,
    phase,
    setPhase,
    currentActivity: currentActivity as string | null,
    setCurrentActivity,
    connStatus,
    isRestoring,
    historyLoading,
    sendCommand,
    sendInput,
    handleInterrupt,
    setForkTarget,
    setForkPrompt,
  }), [
    messages, turns, phase, setPhase, currentActivity, setCurrentActivity,
    connStatus, isRestoring, historyLoading,
    sendCommand, sendInput, handleInterrupt,
    setForkTarget, setForkPrompt,
  ]);

  const inputContextValue = useMemo(() => ({
    inputValue,
    setInputValue,
    handleSubmit,
    handleInputChange,
    handleKeyDown,
    showFileSuggest,
    fileSuggestions,
    handleFileSuggestionClick,
    showCommands,
    setShowCommands,
    handleCommandClick,
    cmdPanelRef: cmdPanelRef as React.RefObject<HTMLDivElement | null>,
  }), [
    inputValue, setInputValue, handleSubmit, handleInputChange, handleKeyDown,
    showFileSuggest, fileSuggestions, handleFileSuggestionClick,
    showCommands, setShowCommands, handleCommandClick,
    cmdPanelRef,
  ]);

  const toolActivityContextValue = useMemo(() => ({
    toolActivities,
    setToolActivities,
    expandedToolOutputs,
    setExpandedToolOutputs,
  }), [
    toolActivities, setToolActivities,
    expandedToolOutputs, setExpandedToolOutputs,
  ]);

  const clearExternalSession = useCallback(() => {
    setActiveExternalSession(null);
    try { localStorage.removeItem('sessionbridge-active-session'); } catch { /* localStorage may be unavailable */ }
    historyLoadedRef.current = false;
    window.location.reload();
  }, [setActiveExternalSession]);

  const workbenchContextValue = useMemo(() => ({
    wsUrl: activeNodeWsUrl,
    token: token ?? undefined,
    logs,
    createInstance: createNodeInstance,
    instances,
    bindCurrentTabInstance: handleBindCurrentTabInstance,
    activeInstanceId,
    projectCwd: activeNodeProjectInfo?.cwd || '.',
    activeNodeWsUrl,
    activateInstance,
    activeExternalSession,
    clearExternalSession,
    onNavigatePath,
    absoluteCwd: absoluteCwd || activeNodeProjectInfo?.cwd || '.',
    onCwdChange: (path: string) => { setAbsoluteCwd(path); },
    scrollContainerRef: scrollContainerRef as React.RefObject<HTMLDivElement | null>,
    actionEndRef: actionEndRef as React.RefObject<HTMLDivElement | null>,
  }), [
    activeNodeWsUrl, token, logs,
    createNodeInstance, instances, handleBindCurrentTabInstance, activeInstanceId,
    activeNodeProjectInfo?.cwd, absoluteCwd,
    activateInstance, activeExternalSession,
    clearExternalSession,
    onNavigatePath,
    scrollContainerRef, actionEndRef,
  ]);

  return (
    <FocusProvider instances={instances} activeInstanceId={activeInstanceId} activeViewId={state.activeViewId} sessionKey={sessionKey} paneFocus={paneFocus}>
      <RuntimePolicyProvider>
    <div className="flex flex-col h-screen bg-[#0a0a0a] text-gray-300 font-mono text-sm overflow-hidden selection:bg-purple-900 selection:text-white relative" onContextMenu={handleWorkbenchContextMenu}>
      <CoreErrorBanner />
      <ConsoleHeader
        chromePolicy={chromePolicy}
        onMobileOpen={() => setMobileOpen(true)}
        onMobileRightOpen={() => setMobileRightOpen(true)}
        statusColor={statusColor}
        statusText={statusText}
        connStatus={connStatus}
        connectionUnstable={connectionUnstable}
        phaseColor={phaseColor}
        phaseLabel={phaseLabel}
        phase={phase}
        currentActivity={currentActivity}
        parsed={{}}
        openSearchPanel={openSearchPanel}
        showDirSwitcher={showDirSwitcher}
        onToggleDirSwitcher={() => setShowDirSwitcher(v => !v)}
        projectInfo={projectInfo}
        switchDirLocal={switchDirLocal}
        onSwitchDirLocalChange={setSwitchDirLocal}
        switching={switching}
        onSwitchDir={handleSwitchDir}
        savedSessions={savedSessions}
        onSelectSavedSession={(s) => {
          addLog(`[System] Previous session: ${s.label} (${s.dir})`);
          setShowDirSwitcher(false);
        }}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleDashboard={() => {
                // Add a dashboard tab to the active pane
                const tabId = 'dash_' + Date.now().toString(36);
                activeWorkbenchDispatch({
                  type: 'ADD_TAB',
                  paneId: activeWorkbenchState.activePaneId,
                  tab: { id: tabId, title: 'Dashboard', viewType: 'dashboard' },
                });
              }}
        onToggleCommandPalette={() => setShowCommandPalette(v => !v)}
        leftSidebarOpen={effectiveLeftOpen}
        rightSidebarOpen={effectiveRightOpen}
        onToggleLeftSidebar={() => dispatch({ type: 'TOGGLE_SIDEBAR', position: 'left' })}
        onToggleRightSidebar={() => dispatch({ type: 'TOGGLE_SIDEBAR', position: 'right' })}
        connectionLabel={connectionLabel}
        onOpenConnectionManager={() => setAppState(prev => appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: null }))}
      />

      {/* ── Disconnect banner (30s grace) ── */}
      <DisconnectBanner showBanner={showBanner} connStatus={connStatus} statusColor={statusColor} />

      {/* ── Node bar — shows connected mesh nodes for entering workbenches ── */}
      <NodeBar
        activeNodeId={appState.activeInstanceId}
        onEnterNode={handleEnterNode}
        onOpenConnection={() => setAppState(prev => appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: null }))}
      />

      <div className="flex flex-1 overflow-hidden">
        <SidebarSlot open={effectiveLeftOpen}>
          <LeftSidebar
          fileTree={fileTree}
          expandedDirs={expandedDirs}
          onToggleDir={toggleDir}
          onOpenFile={handleOpenFile}
          onSendFile={(filePath) => {
            setInputValue(prev => prev + `@${filePath} `);
          }}
          onBookmarkDir={(dirPath) => {
            addPathBookmark(dirPath);
          }}
          onCommand={(cmdId) => runWorkbenchCommand({ command: cmdId }, actionRunContext)}
          projectCwd={activeNodeProjectInfo?.cwd || '.'}
          absoluteCwd={absoluteCwd || activeNodeProjectInfo?.cwd || '.'}
          instances={instances.filter((i: any) => appState.workbenchInstanceIds.includes(i.id) && (i.status === 'running' || i.status === 'starting'))}
          activeInstanceId={activeInstanceId}
          onActivateInstance={activateInstance}
          onCreateInstance={(dir, label, adapterId) => createNodeInstance(dir, label, adapterId)}
          onKillInstance={killInstance}
        />
        </SidebarSlot>

        {/* ═══ CENTER: WorkbenchLayout (always mounted; hidden via CSS when no node active,
             so tab/terminal state survives node toggle) ════════ */}
        <main className="flex-1 flex flex-col relative bg-black min-w-0 min-h-0">
          {showRemoteOverlay && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0a0a0a]/80 backdrop-blur-sm">
              <div className="bg-[#111] border border-gray-800 rounded px-6 py-4 text-center max-w-sm">
                <div className="text-[10px] font-mono tracking-wider uppercase text-gray-500 mb-2">远端节点离线</div>
                <p className="text-[11px] text-gray-400 mb-3">目标节点 mesh 连接已断开，当前功能不可用。
                  请在节点管理页面重新连接。</p>
                <span className="text-[9px] text-gray-600 font-mono">{reachabilityNodeId}</span>
              </div>
            </div>
          )}
          <SessionProvider value={sessionContextValue}>
          <InputProvider value={inputContextValue}>
          <ToolActivityProvider value={toolActivityContextValue}>
          <WorkbenchProvider value={workbenchContextValue}>
          <div className="flex flex-col flex-1 min-h-0 min-w-0" style={{ display: appState.activeInstanceId ? 'flex' : 'none' }}>
          <WorkbenchTopBar />

          {/* ── WorkbenchLayout (pane/tab/view system) — fully generic, no hardcoded viewType checks ── */}
          <WorkbenchLayout
            state={activeWorkbenchState}
            dispatch={activeWorkbenchDispatch}
            onRequestView={handleRequestView}
            onContextTab={handleContextTab}
            onReorderTabs={handleReorderTabs}
            closedKeptTabs={closedKeptTabs}
            onReopenKeptTab={handleReopenKeptTab}
            onCloseTab={handleCloseTab}
            persistentTabIds={appState.persistentTabs.map(t => t.id)}
            renderView={(viewType, instanceId, tab) => {
              // Generic view resolution: instance-bound views resolve through adapter system,
              // static views use viewType directly as the registry key.
              // No viewType-specific branching — plugins can add views without touching page.tsx.
              const boundInstance = instanceId ? instances.find((i: any) => i.id === instanceId) : null;
              const resolvedViewId = boundInstance?.adapterId
                ? getAdapterViewId(boundInstance.adapterId) || viewType
                : viewType;
              return <MainSlot viewId={resolvedViewId} instanceId={instanceId} _surfaceId={tab?._surfaceId} />;
            }}
          />
          </div>
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto" style={{ display: appState.activeInstanceId ? 'none' : 'flex' }}>
              <div className="p-6 space-y-6 max-w-3xl mx-auto w-full">
                <NodeNetworkView
                  onEnterNode={handleEnterNode}
                  isLocalPage={isLocalPage}
                />
              </div>
          </div>
          </WorkbenchProvider>
          </ToolActivityProvider>
          </InputProvider>
          </SessionProvider>
        </main>

        <SidebarSlot open={effectiveRightOpen}>
          <RightSidebar
          activeTasks={activeTasks}
          onNewSession={handleNewSessionWrapper}
          onQuickCompact={handleQuickCompact}
          onSaveSnapshot={() => saveSnapshot()}
          snapshots={snapshots}
          onLoadSnapshot={loadSnapshotWrapper}
          onForkSnapshot={forkFromSnapshotWrapper}
          knownFiles={knownFiles}
          onOpenFile={handleOpenFile}
          shortenPath={shortenPath}
          logs={logs}
          msgLog={msgLog}
          terminalTab={terminalTab}
          onTerminalTabChange={setTerminalTab}
          logsEndRef={logsEndRef}
          onNavigatePath={onNavigatePath}
          currentActiveDir={absoluteCwd || '.'}
        />
        </SidebarSlot>
      </div>

      {showStatusBar && (
        <StatusBar
          queueStatus={queueStatus}
          onSetMode={setMode}
          onSetEffort={setEffort}
          absoluteCwd={absoluteCwd || '.'}
          terminalCwd={absoluteCwd || '.'}
          onNavigatePath={onNavigatePath}
        />
      )}

      {/* Custom scrollbar styles */}
      <style>{`
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #555; }
        ::-webkit-scrollbar-corner { background: transparent; }
        .prose-container p { margin: 0; overflow-wrap: break-word; line-height: 1.55; }
        .prose-container code { font-size: 11px; }
        .prose-container pre { margin: 4px 0; }
        .prose-container ul, .prose-container ol { margin: 2px 0; }
        .prose-container li { overflow-wrap: break-word; }
      `}</style>

    </div>

      {/* ═══ OVERLAYS — outside overflow-hidden to avoid clipping ════ */}
      <ConsoleOverlays
        showSearch={showSearch}
        searchPanelRef={searchPanelRef}
        searchQuery={searchQuery}
        searchInputRef={searchInputRef}
        handleSearchInput={handleSearchInput}
        searchLoading={searchLoading}
        onCloseSearch={() => setShowSearch(false)}
        searchResults={searchResults}
        addLog={addLog}
        handleLoadSession={handleLoadSession}
        showCommandPalette={showCommandPalette}
        extCommands={paletteCommands}
        onCommand={handlePaletteSelect}
        onCloseCommandPalette={() => setShowCommandPalette(false)}
        viewingFile={viewingFile}
        onCloseFileViewer={() => setViewingFile(null)}
        forkTarget={forkTarget}
        turns={turns}
        forkPrompt={forkPrompt}
        setForkPrompt={setForkPrompt}
        onCloseFork={() => setForkTarget(null)}
        onRewind={handleForkRewind}
        onForkSnapshot={handleForkSnapshot}
        onForkWithPrompt={handleForkWithPrompt}
        ctxMenu={ctxMenu}
        onCloseContextMenu={closeContextMenu}
        settingsOpen={settingsOpen}
        onCloseSettings={() => setSettingsOpen(false)}
        onReconnect={onReconnect}
      />

      <KeyHintOverlay whenContext={focusWhenContext} onCommand={handlePaletteSelect} />

      <MobileSidebar
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        fileTree={fileTree}
        expandedDirs={expandedDirs}
        onToggleDir={toggleDir}
        onOpenFile={handleOpenFile}
        onSendFile={(filePath) => {
          setInputValue(prev => prev + `@${filePath} `);
        }}
        onBookmarkDir={(dirPath) => {
          addPathBookmark(dirPath);
        }}
        activeInstanceId={activeInstanceId}
        onKill={killInstance}
        onCommand={handlePaletteSelect}
        activeView={focusViewId}
        absoluteCwd={absoluteCwd || undefined}
      />
      <MobileRightPanel
        open={mobileRightOpen}
        onClose={() => setMobileRightOpen(false)}
        activeTasks={activeTasks}
        onNewSession={handleNewSessionWrapper}
        onQuickCompact={handleQuickCompact}
        onSaveSnapshot={() => saveSnapshot()}
        snapshots={snapshots}
        onLoadSnapshot={loadSnapshotWrapper}
        onForkSnapshot={forkFromSnapshotWrapper}
        knownFiles={knownFiles}
        onOpenFile={handleOpenFile}
        shortenPath={shortenPath}
        logs={logs}
        msgLog={msgLog}
        terminalTab={terminalTab}
        onTerminalTabChange={setTerminalTab}
        logsEndRef={logsEndRef}
      />
      </RuntimePolicyProvider>
    </FocusProvider>
  );
}

