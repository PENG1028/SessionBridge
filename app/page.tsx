'use client';

// Prerendering disabled — page uses browser-only APIs (WebSocket, localStorage, indexedDB)
export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSession } from '../lib/use-ws';
import {
  Square,
} from 'lucide-react';
import { MobileSidebar } from './console/sidebar/mobile-sidebar';
import { MobileRightPanel } from './console/sidebar/mobile-right-panel';
import { useSessionSearch } from './console/shell/use-session-search';
import { LeftSidebar } from './console/sidebar/left-sidebar';
import { RightSidebar } from './console/sidebar/right-sidebar';
import { StatusBar } from './console/shell/status-bar';
import { ConsoleHeader } from './console/shell/console-header';
import { getAdapterViewId, getAdapterCapabilities, syncAdapterViewsFromExtensionData, syncAdapterMetaFromExtensionData, syncAdapterCapabilitiesFromExtensionData, getViewEntry, getAllAdapterTypes, resolveChromePolicy, type ChromePolicy } from './console/main/view-registry';
import { __coreViewsRegistered } from './console/main/register-core-views';
import { syncExtensionPanels } from './console/panels/panel-registry';
import { __extensionPanelComponentsRegistered } from './console/panels/register-panel-components';
import { syncChromeContributions } from './console/chrome/chrome-registry';
import { syncContextMenus } from './console/menus/context-menu-registry';
import { evaluateWhen } from '../lib/evaluate-when';
import { getDefaultAdapterId } from '../extensions/registry';
void __extensionPanelComponentsRegistered;
void __coreViewsRegistered;
import { useNotification } from './console/shared/notification-context';
import { sessionStore } from '../lib/session-store';
import { useMessageSessions } from './console/hooks/use-message-sessions';
import { useHistoryLoader } from './console/hooks/use-history-loader';
import { useCommandHandlers } from './console/hooks/use-command-handlers';
import { useKeyboardShortcuts } from './console/hooks/use-keyboard-shortcuts';
import { useContextMenu } from './console/hooks/use-context-menu';
import type { ContextMenuRequest, ContextMenuItemSpec } from './console/menus/context-menu-types';
import { registerBuiltinCommands } from './console/commands/register-builtin-commands';
import { registerCommand, getCommand } from './console/commands/command-registry';
import { __coreActionsRegistered } from './console/actions/register-core-actions';
import { getAction, getActions } from './console/actions/action-registry';
import { runWorkbenchCommand } from './console/actions/workbench-command-dispatch';
import type { ActionRunContext } from './console/actions/action-types';
// Register core actions into action registry (module-level side effect)
void __coreActionsRegistered;
import type { ContextMenuItem } from './console/shell/context-menu';
import { ConsoleOverlays } from './console/overlays/console-overlays';
import { InstanceBar } from './console/stage/instance-bar';
import { KeyHintOverlay } from './console/chrome/key-hint-overlay';
import { MobileExtraKeys } from './console/chrome/mobile-extra-keys';
import { LayoutProvider, useLayout, SidebarSlot, MainSlot, FocusProvider, RuntimePolicyProvider, useFocus, useRuntimePolicy, WorkbenchProvider } from './console/workbench';
import { WorkbenchLayout } from './console/stage/workbench-layout';
import { appReducer, createAppInitialState, getActiveWorkbenchState, createInitialState, findPane as findPaneInTree, saveLayoutsToStorage, loadLayoutsFromStorage, restoreInstanceStatesFromStorage, genTabId, genPaneId, type ViewType, type PaneTab, type LayoutNode, type WorkbenchAction, type AppWorkbenchState, type AppWorkbenchAction } from './console/stage/workbench-state';

// ==========================================
// Types
// ==========================================
type Phase = 'idle' | 'running' | 'done' | 'error';

interface Block {
  id: string;
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'unknown';
  /** Human-readable label for what Claude is doing */
  semantic: string;
  /** Raw tool name from Claude (Read, Bash, Edit, etc.) */
  toolName: string;
  /** Detail: file path for file ops, command for bash, query for search */
  detail: string;
  /** Output/result content */
  output: string;
  /** Raw tool input args JSON (for Edit/Write diff) */
  toolArgs: string;
  status: 'running' | 'done' | 'error';
  exitCode: number;
  /** For thinking: the full thinking text */
  content: string;
  /** UI-only: whether thinking block is expanded */
  expanded: boolean;
  /** Raw JSON for unknown fallback */
  rawData: string;
  /** Persistence-only: whether tool result is fully captured */
  isComplete?: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  blocks: Block[];
  isPending: boolean;
  isCompactSummary?: boolean;
}

/** A turn = one user message + all following assistant messages */
type Turn = {
  userMsg: Message;
  assistantMsgs: Message[];
};

/** Live tool activity for floating task panel */
interface ToolActivity {
  id: string;
  toolName: string;
  detail: string;
  semantic: string;
  status: 'running' | 'done' | 'error';
}

/** Background task tracking */
interface TaskInfo {
  id: string;
  description: string;
  taskType: string;
  startTime: number;
  lastToolName?: string;
  summary?: string;
  usage?: { totalTokens?: number; toolUses?: number; durationMs?: number };
}

/** Convert persisted messages from session-store into app UI messages. */
function toAppMessages(sessionId: string, msgs: import('../lib/session-store').Message[]): Message[] {
  return msgs.map((m, i) => ({
    id: `${sessionId}_${i}`,
    role: m.role,
    content: m.content,
    timestamp: typeof m.timestamp === 'number'
      ? new Date(m.timestamp).toLocaleTimeString()
      : m.timestamp || getTime(),
    blocks: (m.blocks || []) as Block[],
    isPending: false,
    isCompactSummary: (m as any).isCompactSummary,
  }));
}

/** Strip UI-only fields before persisting to session-store IndexedDB. */
function toStorageMessages(msgs: Message[]): import('../lib/session-store').Message[] {
  return msgs.map(m => ({
    role: m.role,
    content: m.content,
    timestamp: Date.parse(m.timestamp) || Date.now(),
    blocks: m.blocks as import('../lib/session-store').Block[],
  }));
}

// ==========================================
// Constants — Semantic Layer
// ==========================================
import { getSemantic } from './console/shared/tool-constants';
import { useBlockProcessor } from './console/hooks/use-block-processor';

// ==========================================
// Helpers
// ==========================================
const getTime = () => {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
};

const genId = () => Math.random().toString(36).substring(2, 11);

/** Show last 2 path segments for compact display */
function shortenPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 2) return p;
  return '...' + parts.slice(-2).join('/');
}
/** Convert API block descriptors into UI Block[] for historical session loading */
function parseSessionBlocks(apiBlocks: any[]): Block[] {
  const result: Block[] = [];
  for (const b of apiBlocks) {
    switch (b.type) {
      case 'thinking':
        result.push({
          id: genId(), type: 'thinking', semantic: 'Analyzing...',
          toolName: '', detail: '', output: '', toolArgs: '',
          status: 'done', exitCode: -1, content: b.text || '',
          expanded: true, rawData: '',
        });
        break;
      case 'text':
        result.push({
          id: genId(), type: 'text', semantic: '', toolName: '', detail: '',
          output: '', toolArgs: '', status: 'done', exitCode: -1,
          content: b.text || '', expanded: false, rawData: '',
        });
        break;
      case 'tool_use': {
        const name = b.name || '';
        const sem = getSemantic(name);
        let detail = '';
        try {
          const input = JSON.parse(b.input || '{}');
          if (name === 'Read' || name === 'Glob' || name === 'Grep')
            detail = input.file_path || input.pattern || input.path || '';
          else if (name === 'Bash' || name === 'PowerShell')
            detail = input.command || '';
          else if (name === 'Edit' || name === 'Write')
            detail = input.file_path || '';
          else if (name === 'WebSearch')
            detail = input.query || '';
        } catch {}
        result.push({
          id: genId(), type: 'tool_use', semantic: sem.label,
          toolName: name, detail, output: b.output || '', toolArgs: b.input || '',
          status: 'done', exitCode: 0, content: '', expanded: false, rawData: '',
        });
        break;
      }
      case 'tool_result':
        // Only create standalone if no preceding tool_use to attach to
        if (result.length > 0 && result[result.length - 1].type === 'tool_result' && !result[result.length - 1].output) {
          result[result.length - 1].output = (b.text || '').slice(0, 5000);
        } else {
          result.push({
            id: genId(), type: 'tool_result', semantic: 'Tool Result',
            toolName: '', detail: '', output: (b.text || '').slice(0, 5000),
            toolArgs: '', status: 'done', exitCode: 0, content: '',
            expanded: false, rawData: '',
          });
        }
        break;
    }
  }
  return result;
}

// ==========================================
// Main Page
// ==========================================
export default function Page() {
  return (
    <LayoutProvider>
      <PageContent />
    </LayoutProvider>
  );
}

function PageContent() {
  // ── Connection state: default to localhost, persist last known URL ──
  const defaultUrl = typeof window !== 'undefined'
    ? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.hostname}:8080`
    : 'ws://localhost:8080';
  const params = typeof window !== 'undefined' ? new URL(window.location.href).searchParams : new URLSearchParams();
  const urlParam = params.get('url');
  const tokenParam = params.get('token');
  const [wsUrl, setWsUrl] = useState(() => {
    // URL param wins; fall back to localStorage; then default
    if (urlParam) return urlParam;
    try {
      const saved = localStorage.getItem('bridge-ws-url');
      if (saved) return saved;
    } catch {}
    return defaultUrl;
  });
  const [token, setToken] = useState<string | undefined>(tokenParam || undefined);
  const [customServerUrl, setCustomServerUrl] = useState('');

  // Persist wsUrl to localStorage on change
  useEffect(() => {
    try { localStorage.setItem('bridge-ws-url', wsUrl); } catch {}
  }, [wsUrl]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { state, dispatch } = useLayout();

  // ── Core state ──────────────────────────
  const [phase, setPhase] = useState<Phase>('idle');
  const [currentActivity, setCurrentActivity] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>(['[$] session-bridge connected']);
  // ── No virtual window — render all messages ──
  const [terminalTab, setTerminalTab] = useState<'log' | 'raw'>('log');
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [viewingFile, setViewingFile] = useState<{path: string; content: string} | null>(null);
  // ── Background task tracking ──────────────
  const [activeTasks, setActiveTasks] = useState<Map<string, TaskInfo>>(new Map());
  const [toolActivities, setToolActivities] = useState<Map<string, ToolActivity>>(new Map());
  const [expandedToolOutputs, setExpandedToolOutputs] = useState<Set<string>>(new Set());
  const [taskTimer, setTaskTimer] = useState(0);
  const [queueInfo, setQueueInfo] = useState<{isProcessing: boolean; queueDepth: number; queue: any[]}>({isProcessing: false, queueDepth: 0, queue: []});
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileRightOpen, setMobileRightOpen] = useState(false);
  // Timer to refresh task durations and queue every 5s
  useEffect(() => {
    if (activeTasks.size === 0 && !phase) return;
    const timer = setInterval(() => setTaskTimer(t => t + 1), 5000);
    return () => clearInterval(timer);
  }, [activeTasks.size, phase]);
  // Poll queue status
  useEffect(() => {
    const poll = async () => {
      try { const r = await fetch('/api/queue'); setQueueInfo(await r.json()); } catch {}
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, []);
  // ── Project / Session state ──────────────
  const [projectInfo, setProjectInfo] = useState<{cwd: string; projectName: string} | null>(null);
  const [savedSessions, setSavedSessions] = useState<{id: string; label: string; dir: string; ts: string}[]>([]);
  const [showDirSwitcher, setShowDirSwitcher] = useState(false);
  const [switchDirLocal, setSwitchDirLocal] = useState('');
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    fetch('/api/info').then(r => r.json()).then(info => {
      setProjectInfo(info);
      // Migrate messages from the initial 'default' bucket to the project-specific key
      const realKey = info.cwd.replace(/[/\\:]/g, '_');
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
    }).catch(() => {});
  }, []);

  // ── File tree state ─────────────────────
  const [fileTree, setFileTree] = useState<Record<string, {items: any[]; loaded: boolean}>>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set(['.']));
  const [fileTreeRoot, setFileTreeRoot] = useState('');
  const fetchDir = useCallback(async (dir: string) => {
    try {
      const res = await fetch(`/api/list?dir=${encodeURIComponent(dir)}`);
      const data = await res.json();
      if (data.items) {
        setFileTreeRoot(data.cwd || '');
        setFileTree(prev => ({...prev, [dir]: {items: data.items, loaded: true}}));
      }
    } catch {}
  }, []);
  // Fetch root on mount
  useEffect(() => { fetchDir('.'); }, [fetchDir]);

  const actionEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cmdPanelRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);

  const { notify, dismiss } = useNotification();

  const onSystemNotify = useCallback((n: { id?: string; type: string; title: string; message?: string; scenarioId?: string; duration?: number; action?: { label: string; onClick: () => void } }) => {
    const severity = (n.type === 'success' || n.type === 'warning' || n.type === 'error') ? n.type : 'info';
    notify({ id: n.id, type: severity, title: n.title, message: n.message, duration: n.duration, action: n.action });
  }, [notify]);

  const { connStatus, msgLog, sendInput, sendShellInput, sendCommand, serverBlocks, sessions, activeSessionId, activateSession, spawnSession, isWorkspace, queueStatus, instances, activeInstanceId, activateInstance, createInstance, killInstance, extensionPointsData } = useSession(wsUrl, token ?? undefined, undefined, undefined, undefined, onSystemNotify, dismiss);

  // ── 30s grace before showing disconnect banner ──
  const [showBanner, setShowBanner] = useState(false);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (connStatus.status === 'connected') {
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      setShowBanner(false);
    } else if (!disconnectTimerRef.current) {
      disconnectTimerRef.current = setTimeout(() => setShowBanner(true), 30000);
    }
    return () => { if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current); };
  }, [connStatus.status]);
  const connectionUnstable = connStatus.status !== 'connected';

  // Phase 4I: activeAdapterId/viewId/isActiveRunning/whenContext are derived
  // from paneFocus below — context menu and extension commands follow the
  // current tab's binding, not the global activeInstanceId.

  // Sync adapter→viewId mapping and extension panels from extension points data
  useEffect(() => {
    syncAdapterViewsFromExtensionData(extensionPointsData);
    syncAdapterMetaFromExtensionData(extensionPointsData);
    syncAdapterCapabilitiesFromExtensionData(extensionPointsData);
    if (extensionPointsData?.views) {
      const views = extensionPointsData.views as Record<string, any>;
      syncExtensionPanels(views['sidebar-left'], views['sidebar-right']);
    }
    if (extensionPointsData?.chrome) {
      syncChromeContributions(extensionPointsData.chrome);
    }
    if (extensionPointsData?.menus) {
      syncContextMenus(extensionPointsData.menus);
    }
  }, [extensionPointsData]);

  // ── Workbench pane/tab layout state (Phase 4N: per-instance workbench) ──
  const [appState, setAppState] = useState<AppWorkbenchState>(() => createAppInitialState());
  const appDispatch = useCallback((action: AppWorkbenchAction) => {
    setAppState(prev => appReducer(prev, action));
  }, []);
  const activeWorkbenchDispatch = useCallback((action: WorkbenchAction) => {
    setAppState(prev => {
      if (prev.activeInstanceId && prev.instanceStates[prev.activeInstanceId]) {
        return appReducer(prev, { type: 'INSTANCE_ACTION', instanceId: prev.activeInstanceId, action });
      }
      return appReducer(prev, { type: 'GLOBAL_ACTION', action });
    });
  }, []);
  const activeWorkbenchState = useMemo(() => getActiveWorkbenchState(appState), [appState]);
  const appStateRef = useRef(appState);
  appStateRef.current = appState;
  // Phase 4I: Instance changes (sidebar click) no longer auto-create tabs.
  // Tab is the subject — instance is a tab's binding. Only shell tabs are
  // restored on reconnect via the instances[] effect below.

  // When an instance is killed/removed, clean up its layout
  const prevInstanceIds = useRef<string[]>([]);
  useEffect(() => {
    // Don't cleanup during disconnection/reconnection (server restart, etc.)
    // — instances may temporarily be empty but layouts are persisted.
    if (connStatus.status !== 'connected') return;
    const currentIds = instances.map((i: any) => i.id);
    const removed = prevInstanceIds.current.filter(id => !currentIds.includes(id));
    prevInstanceIds.current = currentIds;
    for (const id of removed) {
      setAppState(prev => appReducer(prev, { type: 'REMOVE_INSTANCE_LAYOUT', instanceId: id }));
    }
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
  const activeViewChrome = paneFocus ? getViewEntry(paneFocus.viewType)?.meta.chrome : undefined;
  const chromePolicy = resolveChromePolicy(activeViewChrome);
  const showStatusBar = chromePolicy.statusBar !== 'hidden';
  const activeSidebarReqs = paneFocus ? getViewEntry(paneFocus.viewType)?.meta.sidebarRequirements : undefined;

  // Effective sidebar open state: sidebarRequirements drive defaults per view;
  // manual toggle (sidebarOverride) takes precedence.
  const effectiveLeftOpen = state.sidebarOverride
    ? state.leftSidebarOpen
    : activeSidebarReqs?.left === 'hidden' ? false
    : activeSidebarReqs?.left === 'shown' ? true
    : state.leftSidebarOpen;
  const effectiveRightOpen = state.sidebarOverride
    ? state.rightSidebarOpen
    : activeSidebarReqs?.right === 'hidden' ? false
    : activeSidebarReqs?.right === 'shown' ? true
    : state.rightSidebarOpen;

  // ── Focus-based context (for context menu + extCommands) ───
  // Phase 4I: These follow the pane focus (current tab's binding), NOT the
  // global activeInstanceId. When the tab has no bound instance, adapterId
  // and viewId are '' so when-conditions don't accidentally fire.
  const focusInstanceId = paneFocus?.instanceId ?? null;
  const focusAdapterId = focusInstanceId
    ? instances.find(i => i.id === focusInstanceId)?.adapterId ?? ''
    : '';
  // viewId comes from the pane's viewType. Empty when no pane/relevant view,
  // so when-conditions like `view == "terminal"` won't fire on blank tabs.
  const focusViewId = paneFocus?.viewType || '';
  const focusIsRunning = focusInstanceId
    ? instances.some(i => i.id === focusInstanceId && i.status === 'running')
    : false;
  const focusWhenContext = { activeAdapterId: focusAdapterId, view: focusViewId, isRunning: focusIsRunning };

  // Filter extension commands by when-condition (uses focus-based context)
  const extCommands = useMemo(() => {
    if (!extensionPointsData?.commands) return [];
    const cmds = extensionPointsData.commands as Array<{ id: string; title: string; category?: string; when?: string }>;
    return cmds.filter(cmd => {
      if (!cmd.when) return true;
      return evaluateWhen(cmd.when, focusWhenContext);
    });
  }, [extensionPointsData, focusWhenContext]);

  // Phase 4E: Merge extension commands with action registry commands for command palette.
  const paletteCommands = useMemo(() => {
    const registryActions: Array<{ id: string; title: string; category?: string }>
      = getActions('commandPalette', focusWhenContext as Record<string, unknown>);
    return [
      ...extCommands.map(c => ({ id: c.id, title: c.title, category: c.category || 'Extension' })),
      ...registryActions.map(a => ({ id: a.id, title: a.title, category: a.category || 'Core' })),
    ];
  }, [extCommands, focusWhenContext]);

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

    // Sync extension manifest commands into the registry.
    // Each dispatches sendCommand with its ID as the command name.
    const allExtCmds = (extensionPointsData?.commands as any[]) || [];
    for (const cmd of allExtCmds) {
      const id = cmd.id as string;
      if (getCommand(id)) continue; // built-in takes precedence
      registerCommand({
        id,
        title: cmd.title || id,
        category: cmd.category,
        handler: () => sendCommand(id),
      });
    }

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
  }, [sendCommand, sendInput, killInstance, activeSessionId, extensionPointsData]);

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
    if (instances.length === 0 || instancesRestoredRef.current) return;
    instancesRestoredRef.current = true;

    const saved = loadLayoutsFromStorage();
    if (saved) {
      const serverIds = instances.map((i: any) => i.id);
      const { states, persistentTabs } = restoreInstanceStatesFromStorage(
        saved.instanceStates, saved.persistentTabs as PaneTab[], serverIds
      );
      // Workbench instance IDs = saved ones + any instance that has a layout
      const mergedIds = new Set([
        ...(saved.workbenchInstanceIds || []),
        ...Object.keys(states),
      ]);
      const validIds = [...mergedIds].filter(id => serverIds.includes(id));
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
        if (validIds.length > 0) {
          next = appReducer(next, { type: 'SET_WORKBENCH_INSTANCES', instanceIds: validIds });
        }
        return next;
      });
    } else {
      // Fresh start — auto-populate with the first instance from server
      const firstId = instances[0]?.id;
      if (firstId) {
        const initialLayout = createInitialState(firstId);
        setAppState(prev => appReducer(
          { ...prev, instanceStates: { ...prev.instanceStates, [firstId]: initialLayout } },
          { type: 'SET_WORKBENCH_INSTANCES', instanceIds: [firstId] }
        ));
      }
    }
  }, [instances]);

  // ── Auto-save layouts to localStorage with debounce (Phase 4N) ──
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      // Don't overwrite localStorage with empty state during reconnect blips
      if (Object.keys(appState.instanceStates).length === 0 && appState.workbenchInstanceIds.length === 0) return;
      saveLayoutsToStorage(appState.instanceStates, appState.persistentTabs, appState.workbenchInstanceIds);
    }, 500);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  }, [appState.instanceStates, appState.persistentTabs, appState.workbenchInstanceIds]);

  // Save on beforeunload
  useEffect(() => {
    const handleBeforeUnload = () => {
      const state = appStateRef.current;
      if (Object.keys(state.instanceStates).length > 0 || state.workbenchInstanceIds.length > 0) {
        saveLayoutsToStorage(state.instanceStates, state.persistentTabs, state.workbenchInstanceIds);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const addLog = useCallback((msg: string) => setLogs(prev => [...prev, msg]), []);

  const handleInterrupt = useCallback(() => {
    sendCommand('interrupt');
    addLog('[System] ⏹ Interrupting Claude...');
    setPhase('idle');
    setCurrentActivity('Interrupted');
  }, [sendCommand, addLog]);

  // ── Hook integration (extracted from page.tsx to reduce size) ──
  const { messagesBySession, setMessagesBySession, messages, sessionKey, updateSession, handleNewSession, isRestoring, snapshots, saveSnapshot, loadSnapshot, forkFromSnapshot, knownFiles } = useMessageSessions(
    projectInfo, isWorkspace, activeSessionId, activeInstanceId, addLog, sendCommand
  );

  const { historyLoadedRef, historyLoading, historyCutoffRef, processedRef, activeExternalSession, setActiveExternalSession } = useHistoryLoader(
    projectInfo, serverBlocks, addLog, setMessagesBySession
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
  const handleToggleCommandPalette = useCallback(() => setShowCommandPalette(v => !v), []);
  const handleToggleLeftSidebar = useCallback(() => dispatch({ type: 'TOGGLE_SIDEBAR', position: 'left' }), [dispatch]);
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
      } catch {}
    }
    setSwitching(true);
    try {
      await fetch('/api/session/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: dir }),
      });
	      // Clear in-memory messages — sessionKey is always 'default' in non-workspace mode
	      setMessagesBySession({});
	      // Skip old server blocks they belong to the old project
      processedRef.current = serverBlocks.length;
      historyLoadedRef.current = false; // reload history for new directory
      setPhase('idle'); setCurrentActivity(null);
      const info = await fetch('/api/info').then(r => r.json());
      setProjectInfo(info);
      addLog(`[System] Switched to ${info.projectName || info.cwd}`);
      setFileTree({});
      setExpandedDirs(new Set(['.']));
      fetchDir('.');
    } catch {}
    setSwitching(false);
    setShowDirSwitcher(false);
    setSwitchDirLocal('');
  }, [projectInfo, fetchDir, addLog, serverBlocks.length]);

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
    projectCwd: projectInfo?.cwd || '.',
    messages,
    workbenchState: activeWorkbenchState,
    workbenchDispatch: activeWorkbenchDispatch,
    sendCommand,
    sendInput: (text: string) => sendInput(text, activeSessionId || undefined),
    createInstance,
    killInstance,
    openSettings: () => setSettingsOpen(true),
    openSearch: openSearchPanel,
    openCommandPalette: () => setShowCommandPalette(v => !v),
    toggleLeftSidebar: () => dispatch({ type: 'TOGGLE_SIDEBAR', position: 'left' }),
    toggleRightSidebar: () => dispatch({ type: 'TOGGLE_SIDEBAR', position: 'right' }),
    notify: (n) => notify({ id: n.title, type: n.type as any, title: n.title, message: n.message }),
  }), [focusViewId, focusAdapterId, focusIsRunning, focusInstanceId, projectInfo, messages, activeWorkbenchState, activeWorkbenchDispatch, sendCommand, sendInput, activeSessionId, createInstance, killInstance, openSearchPanel, dispatch, notify]);

  // ── Context menu — uses actionRunContext, must be after its definition ──
  const { ctxMenu, setCtxMenu, openContextMenu, handleWorkbenchContextMenu, closeContextMenu } = useContextMenu(
    actionRunContext,
    focusWhenContext,
    getAllAdapterTypes,
    projectInfo?.cwd || '.',
    createInstance,
  );

  // Handle command palette selection — unified dispatch through runWorkbenchCommand
  const handlePaletteSelect = useCallback((cmdId: string) => {
    runWorkbenchCommand({ command: cmdId }, actionRunContext);
  }, [actionRunContext]);

  const handleLoadSession = useCallback(async (sessionId: string, project: string, display?: string) => {
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/sessions/detail?id=${encodeURIComponent(sessionId)}&project=${encodeURIComponent(project)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      if (data.messages && data.messages.length > 0) {
        // Filter out empty user messages (content was string not array in session jsonl)
        const filtered = data.messages.filter((m: any) =>
          m.role !== 'user' || m.text?.trim() || (m.blocks && m.blocks.length > 0)
        );
        const loadedMsgs: Message[] = filtered.map((m: any) => ({
          id: genId(),
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.text || '',
          timestamp: m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : getTime(),
          blocks: parseSessionBlocks(m.blocks || []),
          isPending: false,
          isCompactSummary: m.isCompactSummary === true,
        }));
        updateSession(sessionKey, () => loadedMsgs);
        setActiveExternalSession(display || sessionId);
        try { localStorage.setItem('sessionbridge-active-session', JSON.stringify({ id: sessionId, display: display || sessionId })); } catch {}
        addLog(`[System] Loaded historical session: ${display || sessionId} (${filtered.length} messages)`);
        // Log summary of block types in last message
        const last = loadedMsgs[loadedMsgs.length - 1];
        if (last && last.blocks.length > 0) {
          const types = last.blocks.map(b => b.type);
          addLog(`[System] Last message blocks: ${[...new Set(types)].join(', ')}`);
        }
      } else {
        addLog(`[System] Session "${display || sessionId}" is empty`);
        updateSession(sessionKey, () => []);
      }
      setPhase('done');
      setCurrentActivity('Loaded from history');
    } catch (err) {
      addLog(`[Error] Failed to load session: ${err}`);
    }
    setSearchLoading(false);
    setShowSearch(false);
  }, [sessionKey, updateSession, addLog]);

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
    serverBlocks,
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

  // ── Instance bar handlers (Phase 4N) ──
  const handleActivateInstanceBar = useCallback((instanceId: string) => {
    const currentState = appStateRef.current;
    if (currentState.activeInstanceId === instanceId) {
      // Toggle off — switch to global layout
      setAppState(prev => appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: null }));
    } else {
      // Switch to this instance — ensure it has a layout
      setAppState(prev => {
        if (prev.instanceStates[instanceId]) {
          return appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId });
        }
        const newLayout = createInitialState(instanceId);
        return appReducer(
          { ...prev, instanceStates: { ...prev.instanceStates, [instanceId]: newLayout } },
          { type: 'SET_ACTIVE_INSTANCE', instanceId }
        );
      });
      // Sync to server so chat views know which instance is active
      activateInstance(instanceId);
    }
  }, [activateInstance]);

  const handleCreateInstanceBar = useCallback(async () => {
    // Show connection manager
    setAppState(prev => appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: null }));
  }, []);

  const handleKillInstanceBar = useCallback((instanceId: string) => {
    killInstance(instanceId);
    setAppState(prev => appReducer(prev, { type: 'REMOVE_INSTANCE_LAYOUT', instanceId }));
  }, [killInstance]);

  const handleRenameInstanceBar = useCallback(async (instanceId: string, newLabel: string) => {
    const httpBase = wsUrl.replace(/^ws/, 'http');
    try {
      await fetch(`${httpBase}/api/aliases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instanceId, alias: newLabel }),
      });
    } catch (err) {
      console.error('Rename failed', err);
    }
  }, [wsUrl]);

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

  // ── Render ──
  // Fetch saved connections
  const [savedRelays, setSavedRelays] = useState<{id:string;name:string;url:string;token?:string}[]>([]);
  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then((cfg: any) => {
      if (cfg?.connections) setSavedRelays(cfg.connections);
    }).catch(() => {});
  }, []);

  // ── Handle view request from pane (user picks view in EmptyPane) ──
  // Phase 4F: Opening a view NEVER auto-creates an instance. The tab is a UI
  // window that can later bind to a runtime instance via the InstancesPanel or
  // explicit "New Runtime" actions. Instance-bound views (openMode:
  // 'instance-bound') without an attached instance show an attach state.
  const handleRequestView = useCallback((paneId: string, tabId: string, viewType: ViewType) => {
    const entry = getViewEntry(viewType);
    const defaultTitle = entry?.meta.title || viewType.charAt(0).toUpperCase() + viewType.slice(1);
    activeWorkbenchDispatch({ type: 'SET_TAB_VIEW', paneId, tabId, viewType, title: defaultTitle });
  }, [activeWorkbenchDispatch]);

  // Phase 4F: Bind the active pane's current tab to an instanceId (called by views after explicit create).
  const workbenchStateRef = useRef(activeWorkbenchState);
  workbenchStateRef.current = activeWorkbenchState;
  const handleBindCurrentTabInstance = useCallback((instanceId: string) => {
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
    });
  }, [activeWorkbenchDispatch]);

  // ── Close tab: kill if not kept ──
  const handleCloseTab = useCallback((_paneId: string, _tabId: string, tab: PaneTab) => {
    const instId = tab.instanceId;
    if (instId) {
      // Kept tabs survive tab close (≡ menu revival). Non-kept → kill process.
      const isKept = appStateRef.current.persistentTabs.some(t => t.id === tab.id);
      if (!isKept) {
        killInstance(instId);
        setAppState(prev => appReducer(prev, { type: 'REMOVE_INSTANCE_LAYOUT', instanceId: instId }));
      }
    }
  }, [killInstance]);

  // ── Workbench context value (provides session/chat state to all view components) ──
  const workbenchContextValue = useMemo(() => ({
    wsUrl,
    token: token ?? undefined,
    logs,
    messages,
    turns,
    phase,
    setPhase,
    currentActivity: currentActivity as string | null,
    setCurrentActivity,
    connStatus,
    isRestoring,
    historyLoading,
    inputValue,
    setInputValue,
    handleSubmit,
    handleInputChange,
    handleKeyDown,
    toolActivities,
    setToolActivities,
    expandedToolOutputs,
    setExpandedToolOutputs,
    showFileSuggest,
    fileSuggestions,
    handleFileSuggestionClick,
    showCommands,
    setShowCommands,
    handleCommandClick,
    cmdPanelRef: cmdPanelRef as React.RefObject<HTMLDivElement | null>,
    sendCommand,
    sendInput,
    handleInterrupt,
    setForkTarget,
    setForkPrompt,
    createInstance,
    instances,
    bindCurrentTabInstance: handleBindCurrentTabInstance,
    activeInstanceId,
    projectCwd: projectInfo?.cwd || '.',
    activateInstance,
    activeExternalSession,
    clearExternalSession: () => {
      setActiveExternalSession(null);
      try { localStorage.removeItem('sessionbridge-active-session'); } catch {}
      historyLoadedRef.current = false;
      window.location.reload();
    },
    scrollContainerRef: scrollContainerRef as React.RefObject<HTMLDivElement | null>,
    actionEndRef: actionEndRef as React.RefObject<HTMLDivElement | null>,
  }), [
    wsUrl, token, logs, messages, turns,
    phase, setPhase, currentActivity, setCurrentActivity,
    connStatus, isRestoring, historyLoading,
    inputValue, setInputValue,
    handleSubmit, handleInputChange, handleKeyDown,
    toolActivities, setToolActivities,
    expandedToolOutputs, setExpandedToolOutputs,
    showFileSuggest, fileSuggestions, handleFileSuggestionClick,
    showCommands, setShowCommands, handleCommandClick,
    handleInterrupt,
    sendCommand, sendInput,
    setForkTarget, setForkPrompt,
    createInstance, handleBindCurrentTabInstance, activateInstance, activeInstanceId,
    projectInfo?.cwd,
    activeExternalSession,
    cmdPanelRef, scrollContainerRef, actionEndRef, projectInfo?.cwd,
  ]);

  return (
    <FocusProvider instances={instances} activeInstanceId={activeInstanceId} activeViewId={state.activeViewId} sessionKey={sessionKey} paneFocus={paneFocus}>
      <RuntimePolicyProvider>
    <div className="flex flex-col h-screen bg-[#0a0a0a] text-gray-300 font-mono text-sm overflow-hidden selection:bg-purple-900 selection:text-white relative" onContextMenu={handleWorkbenchContextMenu}>
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
      {showBanner && (
        <div className="flex items-center justify-center gap-2 px-3 py-1.5 text-[11px] font-bold tracking-wider uppercase"
          style={{ backgroundColor: connStatus.status === 'connecting' ? '#1a3a1a' : '#3a1a1a', color: connStatus.status === 'connecting' ? '#4ade80' : '#f87171' }}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
          {connStatus.status === 'connecting' ? 'Connecting to server...' : `Disconnected from server${connStatus.retryCount ? ` (retry #${connStatus.retryCount})` : ''}`}
        </div>
      )}

      {/* ── Instance bar (Phase 4N) — only workbench-level instances, not tab-level processes ── */}
      <InstanceBar
        instances={instances.filter((i: any) => appState.workbenchInstanceIds.includes(i.id) && (i.status === 'running' || i.status === 'starting'))}
        activeInstanceId={appState.activeInstanceId}
        onActivate={handleActivateInstanceBar}
        onCreate={handleCreateInstanceBar}
        onKill={handleKillInstanceBar}
        onRename={handleRenameInstanceBar}
        onOpenConnection={() => setAppState(prev => appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: null }))}
      />

      <MobileExtraKeys activeInstanceId={appState.activeInstanceId} statusBarHidden={!showStatusBar} sendShellInput={sendShellInput} />

      <div className="flex flex-1 overflow-hidden">
        <SidebarSlot open={effectiveLeftOpen}>
          <LeftSidebar
          fileTree={fileTree}
          expandedDirs={expandedDirs}
          onToggleDir={(dirPath) => {
            setExpandedDirs(prev => {
              const next = new Set(prev);
              if (next.has(dirPath)) next.delete(dirPath);
              else { next.add(dirPath); fetchDir(dirPath); }
              return next;
            });
          }}
          onOpenFile={(filePath) => {
            fetch(`/api/read-file?path=${encodeURIComponent(filePath)}`)
              .then(r => r.json())
              .then(data => {
                if (data.content !== undefined) {
                  setViewingFile({ path: data.path || filePath, content: data.content });
                }
              })
              .catch(() => {});
          }}
          onSendFile={(filePath) => {
            setInputValue(prev => prev + `@${filePath} `);
          }}
          onCommand={(cmdId) => runWorkbenchCommand({ command: cmdId }, actionRunContext)}
          projectCwd={projectInfo?.cwd || '.'}
          instances={instances.filter((i: any) => appState.workbenchInstanceIds.includes(i.id) && (i.status === 'running' || i.status === 'starting'))}
          activeInstanceId={activeInstanceId}
          onActivateInstance={activateInstance}
          onCreateInstance={(dir, _label, adapterId) => createInstance(dir, undefined, adapterId)}
          onKillInstance={killInstance}
        />
        </SidebarSlot>

        {/* ═══ CENTER: WorkbenchLayout ════════ */}
        <main className="flex-1 flex flex-col relative bg-black min-w-0 min-h-0">
          <WorkbenchProvider value={workbenchContextValue}>
          {appState.activeInstanceId ? (
            <div className="flex flex-col flex-1 min-h-0 min-w-0">
          <div className="flex items-center justify-between h-7 px-2 border-b border-gray-800 bg-[#0a0a0a] shrink-0">
            <span className="flex items-center gap-2 text-[10px] font-bold text-gray-500 tracking-wider">
              WORKBENCH
              {activeExternalSession && (
                <span className="text-amber-500 text-[8px] bg-amber-900/20 px-1.5 py-0.5 rounded border border-amber-700/30">
                  VIEWING: {activeExternalSession}
                  <button onClick={() => {
                    setActiveExternalSession(null);
                    try { localStorage.removeItem('sessionbridge-active-session'); } catch {}
                    historyLoadedRef.current = false;
                    window.location.reload();
                  }} className="ml-1.5 px-1 bg-amber-800/40 hover:bg-amber-700/60 rounded text-[7px] text-amber-300">✕</button>
                </span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <span className="text-gray-700 text-[8px] font-mono">
                msg:{messages.length}
              </span>
              {phase === 'running' && (
                <span className="text-purple-500 animate-pulse text-[9px]">●</span>
              )}
              {phase === 'running' && (
                <button onClick={handleInterrupt}
                  className="text-red-400 hover:text-red-300 flex items-center gap-1 text-[8px] bg-red-900/20 px-1.5 py-0.5 rounded border border-red-800/30 transition-colors"
                  title="Stop (Esc)"
                >
                  <Square className="w-2 h-2 fill-current" /> STOP
                </button>
              )}
            </span>
          </div>

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
            renderView={(viewType, instanceId) => {
              // Generic view resolution: instance-bound views resolve through adapter system,
              // static views use viewType directly as the registry key.
              // No viewType-specific branching — plugins can add views without touching page.tsx.
              const resolvedViewId = instanceId
                ? getAdapterViewId(instances.find((i: any) => i.id === instanceId)?.adapterId || getAllAdapterTypes()[0]?.id || getDefaultAdapterId()) || viewType
                : viewType;
              return <MainSlot viewId={resolvedViewId} instanceId={instanceId} />;
            }}
          />
          </div>) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
              <div className="p-6 space-y-8 max-w-3xl mx-auto w-full">
                {/* ── Instances ── */}
                <section>
                  <h2 className="text-[11px] font-bold text-gray-500 tracking-wider uppercase mb-3">
                    Instances ({appState.workbenchInstanceIds.length})
                  </h2>
                  {appState.workbenchInstanceIds.length === 0 ? (
                    <div className="text-[10px] text-gray-700 italic px-2">No instances yet. Create one below.</div>
                  ) : (
                    <div className="space-y-1">
                      {instances.filter((i: any) => appState.workbenchInstanceIds.includes(i.id) && (i.status === 'running' || i.status === 'starting')).map((inst: any) => (
                        <div key={inst.id} className="flex items-center justify-between bg-[#111] border border-gray-800 rounded-lg px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              inst.status === 'running' ? 'bg-emerald-500' : inst.status === 'starting' ? 'bg-yellow-500' : 'bg-red-500'
                            }`} />
                            <span className="text-sm text-gray-200">{inst.label || inst.id.slice(0, 12)}</span>
                            {inst.source === 'remote' && <span className="text-[8px] bg-cyan-900/25 text-cyan-400 px-1 rounded font-mono">R</span>}
                          </div>
                          <button onClick={() => handleActivateInstanceBar(inst.id)}
                            className="text-[10px] px-3 py-1 bg-purple-700 hover:bg-purple-600 text-white rounded transition-colors">Launch</button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* ── Servers ── */}
                <section>
                  <h2 className="text-[11px] font-bold text-gray-500 tracking-wider uppercase mb-3">Servers</h2>
                  <div className="space-y-1">
                    {savedRelays.length === 0 ? (
                      <div className="text-[10px] text-gray-700 italic px-2">No saved servers.</div>
                    ) : (
                      savedRelays.map((r: any) => (
                        <button key={r.id} onClick={() => { setWsUrl(r.url); setToken(r.token || undefined); }}
                          className="w-full flex items-center gap-3 px-4 py-3 bg-[#111] border border-gray-800 rounded-lg hover:border-purple-700/50 text-left transition-colors"
                        >
                          <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-gray-200 truncate">{r.name}</div>
                            <div className="text-[10px] text-gray-600 truncate">{r.url}</div>
                          </div>
                          {r.url === wsUrl ? (
                            <span className="text-[9px] text-emerald-500 shrink-0">Connected</span>
                          ) : (
                            <span className="text-[10px] text-gray-500 shrink-0">Connect</span>
                          )}
                        </button>
                      ))
                    )}
                    {/* Custom URL input */}
                    <form onSubmit={(e) => { e.preventDefault(); if (customServerUrl.trim()) setWsUrl(customServerUrl.trim()); }}
                      className="flex gap-1 pt-1"
                    >
                      <input type="text" value={customServerUrl} onChange={e => setCustomServerUrl(e.target.value)}
                        placeholder="wss://server.example.com:8080"
                        className="flex-1 bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1.5 text-[11px] text-gray-200 outline-none focus:border-purple-500"
                      />
                      <button type="submit" className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-[10px] rounded border border-purple-600 shrink-0">
                        Connect
                      </button>
                    </form>
                  </div>
                </section>

                {/* ── Create Instance ── */}
                <section>
                  <h2 className="text-[11px] font-bold text-gray-500 tracking-wider uppercase mb-3">Create Instance</h2>
                  <div className="bg-[#111] border border-gray-800 rounded-lg p-4">
                    <div className="flex gap-2">
                      <button onClick={async () => {
                        const adapterId = getDefaultAdapterId();
                        const result = await createInstance(projectInfo?.cwd || '.', undefined, adapterId);
                        if (result?.success && result?.instance?.id) {
                          const id = result.instance.id;
                          const paneId = genPaneId();
                          const emptyTabId = genTabId();
                          const emptyState = {
                            root: { kind: 'pane' as const, id: paneId, tabs: [{ id: emptyTabId, title: 'Empty', viewType: 'empty' as const }], activeTabId: emptyTabId, zone: 'main' as const },
                            activePaneId: paneId,
                            bottom: null,
                          };
                          setAppState(prev => {
                            let next = prev;
                            next = appReducer(next, { type: 'ADD_WORKBENCH_INSTANCE', instanceId: id });
                            if (!next.instanceStates[id]) next = appReducer(next, { type: 'RESTORE_INSTANCE_STATE', instanceId: id, state: emptyState });
                            return appReducer(next, { type: 'SET_ACTIVE_INSTANCE', instanceId: id });
                          });
                          activateInstance(id);
                        }
                      }} className="px-4 py-2 bg-purple-700 hover:bg-purple-600 text-white rounded text-[11px] font-semibold transition-colors">
                        New Instance
                      </button>
                      <button onClick={() => {
                        setWsUrl(defaultUrl); setToken(undefined);
                      }} className="px-4 py-2 border border-gray-700 hover:border-purple-700/50 text-gray-400 hover:text-gray-200 rounded text-[11px] transition-colors">
                        Connect to Server...
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}
          </WorkbenchProvider>
        </main>

        <SidebarSlot open={effectiveRightOpen}>
          <RightSidebar
          activeTasks={activeTasks}
          queueInfo={queueInfo}
          onNewSession={handleNewSessionWrapper}
          onQuickCompact={handleQuickCompact}
          onSaveSnapshot={() => saveSnapshot()}
          snapshots={snapshots}
          onLoadSnapshot={loadSnapshotWrapper}
          onForkSnapshot={forkFromSnapshotWrapper}
          knownFiles={knownFiles}
          onOpenFile={(filePath) => {
            fetch(`/api/read-file?path=${encodeURIComponent(filePath)}`)
              .then(r => r.json())
              .then(data => {
                if (data.content !== undefined) setViewingFile({ path: data.path || filePath, content: data.content });
              })
              .catch(() => {});
          }}
          shortenPath={shortenPath}
          logs={logs}
          msgLog={msgLog}
          terminalTab={terminalTab}
          onTerminalTabChange={setTerminalTab}
          logsEndRef={logsEndRef}
        />
        </SidebarSlot>
      </div>

      {showStatusBar && (
        <StatusBar
          queueStatus={queueStatus}
          onSetMode={setMode}
          onSetEffort={setEffort}
          wsUrl={wsUrl}
          token={token}
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
      />

      <KeyHintOverlay whenContext={focusWhenContext} onCommand={handlePaletteSelect} />

      <MobileSidebar
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        fileTree={fileTree}
        expandedDirs={expandedDirs}
        onToggleDir={(path) => setExpandedDirs(prev => {
          const next = new Set(prev);
          next.has(path) ? next.delete(path) : next.add(path);
          return next;
        })}
        onOpenFile={(filePath) => {
          fetch(`/api/read-file?path=${encodeURIComponent(filePath)}`)
            .then(r => r.json())
            .then(data => {
              if (data.content !== undefined) {
                setViewingFile({ path: data.path || filePath, content: data.content });
              }
            })
            .catch(() => {});
        }}
        onSendFile={(filePath) => {
          setInputValue(prev => prev + `@${filePath} `);
        }}
        activeInstanceId={activeInstanceId}
        onKill={killInstance}
        onCommand={handlePaletteSelect}
        activeView={focusViewId}
      />
      <MobileRightPanel
        open={mobileRightOpen}
        onClose={() => setMobileRightOpen(false)}
        activeTasks={activeTasks}
        queueInfo={queueInfo}
        onNewSession={handleNewSessionWrapper}
        onQuickCompact={handleQuickCompact}
        onSaveSnapshot={() => saveSnapshot()}
        snapshots={snapshots}
        onLoadSnapshot={loadSnapshotWrapper}
        onForkSnapshot={forkFromSnapshotWrapper}
        knownFiles={knownFiles}
        onOpenFile={(filePath) => {
          fetch(`/api/read-file?path=${encodeURIComponent(filePath)}`)
            .then(r => r.json())
            .then(data => {
              if (data.content !== undefined) setViewingFile({ path: data.path || filePath, content: data.content });
            })
            .catch(() => {});
        }}
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
