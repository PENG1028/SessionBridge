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
import { getLastActiveDir, setLastActiveDir, getRestoreLastPath, addPathBookmark, setBookmarkScope } from './lib/path-bookmarks';
import { NodeBar } from './console/stage/node-bar';
import { NodeNetworkView } from './console/sidebar/node-network-view';
import { KeyHintOverlay } from './console/chrome/key-hint-overlay';
import { MobileExtraKeys } from './console/chrome/mobile-extra-keys';
import { LayoutProvider, useLayout, SidebarSlot, MainSlot, FocusProvider, RuntimePolicyProvider, useFocus, useRuntimePolicy, WorkbenchProvider } from './console/workbench';
import { WorkbenchLayout } from './console/stage/workbench-layout';
import { appReducer, createAppInitialState, getActiveWorkbenchState, createInitialState, findPane as findPaneInTree, ensureInstanceTab, saveLayoutsToStorage, loadLayoutsFromStorage, restoreInstanceStatesFromStorage, genTabId, type ViewType, type PaneTab, type LayoutNode, type WorkbenchState, type WorkbenchAction, type AppWorkbenchState, type AppWorkbenchAction } from './console/stage/workbench-state';

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

function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '0.0.0.0';
  } catch {
    return true;
  }
}

function wsToHttpUrl(url: string): string {
  return url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
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
  // Use default URL initially for SSR/CSR consistency; restore from localStorage after mount
  const [wsUrl, setWsUrl] = useState(() => urlParam || defaultUrl);
  const [token, setToken] = useState<string | undefined>(tokenParam || undefined);

  // ── Page access mode: LOCAL (localhost) vs VIEW (remote) ──
  // Use state + effect to avoid SSR/CSR hydration mismatch
  const [isLocalPage, setIsLocalPage] = useState(false);
  const [browserId, setBrowserId] = useState<string | undefined>(undefined);
  useEffect(() => {
    setIsLocalPage(
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '0.0.0.0'
    );
    if (typeof sessionStorage !== 'undefined') {
      setBrowserId(sessionStorage.getItem('bridge-browser-id') || undefined);
    }
  }, []);

  // Hydrate wsUrl from localStorage on mount (avoids SSR/CSR mismatch)
  useEffect(() => {
    if (urlParam) return; // URL param takes precedence, already set
    // When page is loaded from localhost, always use local relay
    // Don't restore a potentially stale remote wsUrl from localStorage
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return;
    try {
      const saved = localStorage.getItem('bridge-ws-url');
      // Only restore if the saved URL points to the same host as the current page
      // (prevents stale cross-origin wsUrl from localStorage)
      if (saved && saved !== wsUrl) {
        try {
          const savedHost = new URL(saved).hostname;
          if (savedHost === host) setWsUrl(saved);
        } catch {
          // Invalid URL in storage, ignore
        }
      }
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist wsUrl to localStorage on change (only if it matches current page)
  useEffect(() => {
    try {
      const curHost = window.location.hostname;
      const urlHost = new URL(wsUrl).hostname;
      if (urlHost === curHost) localStorage.setItem('bridge-ws-url', wsUrl);
    } catch {} // ignore cross-origin or invalid URLs
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

  // ── File tree state (per-node, keyed by wsUrl) ──
  const [nodeFileTree, setNodeFileTree] = useState<Record<string, Record<string, {items: any[]; loaded: boolean; error?: string}>>>({});
  const [nodeExpandedDirs, setNodeExpandedDirs] = useState<Record<string, string[]>>({});
  const [nodeFileTreeRoot, setNodeFileTreeRoot] = useState<Record<string, string>>({});

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

  // ── Peer discovery (other devices connected to this relay) ──
  const [peers, setPeers] = useState<any[]>([]);
  const [peerLinks, setPeerLinks] = useState<any[]>([]);
  const handleSystemMessage = useCallback((msg: any) => {
    if (msg.type === 'peer.list' && Array.isArray(msg.peers)) {
      setPeers(msg.peers);
      if (Array.isArray(msg.links)) setPeerLinks(msg.links);
      // Re-read browserId — ws-client may have just generated it in onopen
      try {
        const id = sessionStorage.getItem('bridge-browser-id');
        if (id) setBrowserId(id);
      } catch {}
    }
  }, []);

  const { connStatus, msgLog, sendInput, sendShellInput, sendCommand, serverBlocks, sessions, activeSessionId, activateSession, spawnSession, isWorkspace, queueStatus, instances, activeInstanceId, activateInstance, createInstance, killInstance, extensionPointsData } = useSession(wsUrl, token ?? undefined, undefined, undefined, undefined, onSystemNotify, dismiss, handleSystemMessage);

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
  const activeNodeWsUrl = useMemo(() => {
    const nodeId = appState.activeInstanceId;
    return nodeId?.startsWith('upstream:') ? nodeId.slice('upstream:'.length) : wsUrl;
  }, [appState.activeInstanceId, wsUrl]);
  // Derived active-node file tree values
  const fileTree = nodeFileTree[activeNodeWsUrl] || {};
  const expandedDirs = new Set(nodeExpandedDirs[activeNodeWsUrl] || ['.']);
  const fileTreeRoot = nodeFileTreeRoot[activeNodeWsUrl] || '';

  // Sync bookmark scope with active node
  useEffect(() => {
    try {
      const host = activeNodeWsUrl !== wsUrl ? new URL(activeNodeWsUrl).hostname : null;
      setBookmarkScope(host);
      window.dispatchEvent(new CustomEvent('sb-bookmarks-changed'));
    } catch {}
  }, [activeNodeWsUrl, wsUrl]);

  const fetchDir = useCallback(async (dir: string) => {
    const prefix = activeNodeWsUrl !== wsUrl ? wsToHttpUrl(activeNodeWsUrl) : '';
    const apiUrl = `${prefix}/api/list?dir=${encodeURIComponent(dir)}`;
    try {
      const res = await fetch(apiUrl);
      const data = await res.json();
      if (data.items) {
        setNodeFileTreeRoot(prev => ({...prev, [activeNodeWsUrl]: data.cwd || ''}));
        setNodeFileTree(prev => ({
          ...prev,
          [activeNodeWsUrl]: { ...(prev[activeNodeWsUrl] || {}), [dir]: {items: data.items, loaded: true} }
        }));
      } else {
        setNodeFileTree(prev => ({
          ...prev,
          [activeNodeWsUrl]: { ...(prev[activeNodeWsUrl] || {}), [dir]: {items: [], loaded: true, error: data.error || 'Directory not found'} }
        }));
      }
    } catch (err) {
      setNodeFileTree(prev => ({
        ...prev,
        [activeNodeWsUrl]: { ...(prev[activeNodeWsUrl] || {}), [dir]: {items: [], loaded: true, error: String(err)} }
      }));
    }
  }, [activeNodeWsUrl, wsUrl]);
  // Fetch root when active node changes
  useEffect(() => { fetchDir('.'); }, [fetchDir]);

  const onNavigatePath = useCallback((path: string) => {
    setLastActiveDir(path);
    setNodeFileTreeRoot(prev => ({...prev, [activeNodeWsUrl]: path}));
    setNodeFileTree(prev => {
      const nodeTree = prev[activeNodeWsUrl];
      if (nodeTree?.[path]?.loaded) return prev;
      return prev;
    });
    fetchDir(path);
    setNodeExpandedDirs(prev => ({...prev, [activeNodeWsUrl]: ['.', path]}));
  }, [fetchDir, activeNodeWsUrl]);

  // Phase 4I: Instance changes (sidebar click) no longer auto-create tabs.
  // Tab is the subject — instance is a tab's binding. Only shell tabs are
  // restored on reconnect via the instances[] effect below.

  // When an instance arrives or is removed, sync workbench tabs accordingly
  const prevInstanceIds = useRef<string[]>([]);
  useEffect(() => {
    // Don't cleanup during disconnection/reconnection (server restart, etc.)
    // — instances may temporarily be empty but layouts are persisted.
    if (connStatus.status !== 'connected') return;
    const currentIds = instances.map((i: any) => i.id);
    const added = currentIds.filter(id => !prevInstanceIds.current.includes(id));
    const removed = prevInstanceIds.current.filter(id => !currentIds.includes(id));
    prevInstanceIds.current = currentIds;

    // Auto-create terminal tabs for newly added instances
    for (const id of added) {
      const inst = instances.find((i: any) => i.id === id);
      if (inst && inst.status !== 'stopped') {
        setAppState(prev => {
          const activeId = prev.activeInstanceId;
          if (!activeId) return prev;
          const ws = prev.instanceStates[activeId];
          if (!ws) return prev;
          const newWs = ensureInstanceTab(ws, id, inst.label || id.slice(0, 12), 'terminal');
          if (newWs === ws) return prev;
          return { ...prev, instanceStates: { ...prev.instanceStates, [activeId]: newWs } };
        });
      }
    }

    // Clean up layouts for removed instances
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
      // Fresh start — auto-populate with terminal tabs for all active instances
      const activeInsts = instances.filter((i: any) => i.status !== 'stopped');
      if (activeInsts.length > 0) {
        // Build initial layout with terminal tabs for all active instances
        const tabs = activeInsts.map((inst: any) => ({
          id: genTabId(),
          title: inst.label || inst.id.slice(0, 12),
          viewType: 'terminal' as const,
          instanceId: inst.id,
        }));
        let layout: WorkbenchState = {
          root: { kind: 'pane' as const, id: 'pane_1', zone: 'main' as const, tabs, activeTabId: tabs[0].id },
          activePaneId: 'pane_1',
          bottom: null,
        };
        setAppState(prev => appReducer(
          { ...prev, instanceStates: { ...prev.instanceStates, [activeInsts[0].id]: layout } },
          { type: 'SET_WORKBENCH_INSTANCES', instanceIds: activeInsts.map((i: any) => i.id) }
        ));
      }
    }
    // Prevent the removal effect from seeing these as "added"
    prevInstanceIds.current = instances.map((i: any) => i.id);
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
  const [nodeProjectInfo, setNodeProjectInfo] = useState<Record<string, { cwd: string; projectName: string }>>({});
  useEffect(() => {
    if (activeNodeWsUrl === wsUrl) return;
    let cancelled = false;
    fetch(`${wsToHttpUrl(activeNodeWsUrl)}/api/info`)
      .then(r => r.json())
      .then(info => {
        if (cancelled || !info?.cwd) return;
        setNodeProjectInfo(prev => ({
          ...prev,
          [activeNodeWsUrl]: {
            cwd: info.cwd,
            projectName: info.projectName || info.cwd,
          },
        }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeNodeWsUrl, wsUrl]);

  const activeNodeProjectInfo = useMemo(() => {
    if (activeNodeWsUrl === wsUrl) return projectInfo;
    const known = nodeProjectInfo[activeNodeWsUrl];
    if (known) return known;
    try {
      const host = new URL(activeNodeWsUrl).hostname;
      return { cwd: '.', projectName: host };
    } catch {
      return { cwd: '.', projectName: 'remote' };
    }
  }, [activeNodeWsUrl, wsUrl, projectInfo, nodeProjectInfo]);

  const createNodeInstance = useCallback(async (dir: string, label?: string, adapterId?: string) => {
    if (activeNodeWsUrl === wsUrl) return createInstance(dir, label, adapterId);
    try {
      const res = await fetch(`${wsToHttpUrl(activeNodeWsUrl)}/api/instances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir, label, adapterId }),
      });
      const result = await res.json();
      if (!res.ok && !result.error) result.error = `${res.status} ${res.statusText}`;
      addLog(`[System] Created remote instance on ${new URL(activeNodeWsUrl).hostname}: ${result.success ? 'OK' : result.error}`);
      return result;
    } catch (err) {
      const apiUrl = `${wsToHttpUrl(activeNodeWsUrl)}/api/instances`;
      addLog(`[Error] Remote instance create failed (${apiUrl}): ${err}`);
      return { success: false, error: `Failed to fetch ${apiUrl}: ${String(err)}` };
    }
  }, [activeNodeWsUrl, wsUrl, createInstance, addLog]);

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
      setNodeFileTree(prev => ({...prev, [wsUrl]: {}}));
      setNodeExpandedDirs(prev => ({...prev, [wsUrl]: ['.']}));
      setNodeFileTreeRoot(prev => ({...prev, [wsUrl]: ''}));
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

  // ── Enter a node (from NodeBar or NodeNetworkView) ──
  const handleEnterNode = useCallback((nodeId: string) => {
    const currentState = appStateRef.current;
    if (currentState.activeInstanceId === nodeId) {
      // Toggle off — back to node view
      setAppState(prev => appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: null }));
    } else {
      // Enter this node — create workbench layout if needed
      setAppState(prev => {
        if (prev.instanceStates[nodeId]) {
          return appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: nodeId });
        }
        // Auto-populate with terminal tabs for ALL active instances
        const activeInsts = instances.filter((i: any) => i.status !== 'stopped');
        if (activeInsts.length > 0) {
          const tabs = activeInsts.map((inst: any) => ({
            id: genTabId(),
            title: inst.label || inst.id.slice(0, 12),
            viewType: 'terminal' as const,
            instanceId: inst.id,
          }));
          const layout: WorkbenchState = {
            root: { kind: 'pane' as const, id: 'pane_1', zone: 'main' as const, tabs, activeTabId: tabs[0].id },
            activePaneId: 'pane_1',
            bottom: null,
          };
          return appReducer(
            { ...prev, instanceStates: { ...prev.instanceStates, [nodeId]: layout } },
            { type: 'SET_ACTIVE_INSTANCE', instanceId: nodeId }
          );
        }
        // No active instances — start with empty pane
        const newLayout = createInitialState(nodeId.startsWith('inst_') ? nodeId : undefined);
        return appReducer(
          { ...prev, instanceStates: { ...prev.instanceStates, [nodeId]: newLayout } },
          { type: 'SET_ACTIVE_INSTANCE', instanceId: nodeId }
        );
      });
    }
  }, [instances]);

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

  // ── Upstream relay connection (local node connected as leaf) ──
  const [upstreamUrl, setUpstreamUrl] = useState<string | undefined>(undefined);
  const [upstreamConnectingUrl, setUpstreamConnectingUrl] = useState<string | undefined>(undefined);
  const [upstreamError, setUpstreamError] = useState<string | undefined>(undefined);
  const [upstreamErrorUrl, setUpstreamErrorUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    fetch('/api/connect', { method: 'GET' }).then(r => r.json()).then(data => {
      if (data?.relayUrl) setUpstreamUrl(data.relayUrl);
    }).catch(() => {});
  }, []);

  // ── Handle connect local node as leaf to a remote relay ──
  const handleConnectUpstream = useCallback(async (url: string) => {
    setUpstreamError(undefined);
    setUpstreamErrorUrl(undefined);
    setUpstreamConnectingUrl(url);
    addLog(`[System] Connecting local node upstream to ${url}...`);
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relayUrl: url }),
      });
      const data = await res.json();
      setUpstreamConnectingUrl(undefined);
      if (data.ok) {
        setUpstreamUrl(url);
        setUpstreamError(undefined);
        setUpstreamErrorUrl(undefined);
      } else {
        const errMsg = data.error || '连接失败';
        setUpstreamError(errMsg);
        setUpstreamErrorUrl(url);
        addLog(`[Error] Failed to connect: ${errMsg}`);
      }
    } catch (err) {
      setUpstreamConnectingUrl(undefined);
      const errMsg = String(err);
      setUpstreamError(errMsg);
      setUpstreamErrorUrl(url);
      addLog(`[Error] Failed to connect: ${errMsg}`);
    }
  }, [addLog]);

  // ── Handle disconnect upstream ──
  const handleDisconnectUpstream = useCallback(async () => {
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disconnect: true }),
      });
      const data = await res.json();
      if (data.ok) {
        addLog('[System] Disconnected upstream');
        setUpstreamUrl(undefined);
        setUpstreamError(undefined);
        setUpstreamErrorUrl(undefined);
      } else {
        addLog(`[Error] Failed to disconnect: ${data.error || 'unknown error'}`);
      }
    } catch (err) {
      addLog(`[Error] Failed to disconnect: ${err}`);
    }
  }, [addLog]);

  // ── Saved connections (project-level) ──────────────
  const [connections, setConnections] = useState<any[]>([]);
  const [newConnUrl, setNewConnUrl] = useState('');
  const autoUpstreamAttemptedRef = useRef(false);
  useEffect(() => {
    fetch('/api/connections').then(r => r.json()).then((data: any) => {
      if (data?.connections) setConnections(data.connections);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (autoUpstreamAttemptedRef.current || upstreamUrl) return;
    const remoteConnections = connections.filter((c: any) => !isLocalUrl(c.url));
    if (remoteConnections.length !== 1) return;
    autoUpstreamAttemptedRef.current = true;
    void handleConnectUpstream(remoteConnections[0].url);
  }, [connections, upstreamUrl, handleConnectUpstream]);
  const handleDeleteConnection = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/connections/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data?.connections) setConnections(data.connections);
    } catch {}
  }, []);
  const handleAddConnection = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newConnUrl.trim()) return;
    const id = 'conn_' + Date.now().toString(36);
    const name = newConnUrl.replace(/^wss?:\/\//, '').split(':')[0] || 'server';
    // Rough network type classification
    const urlLower = newConnUrl.toLowerCase();
    const networkType = urlLower.includes('127.0.0.1') || urlLower.includes('localhost') ? 'loopback'
      : urlLower.match(/^wss?:\/\/(10\.|192\.168\.)/) ? 'lan'
      : urlLower.match(/^wss?:\/\/(172\.(1[6-9]|2\d|3[01])\.)/) ? 'lan'
      : 'wan';
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name, url: newConnUrl.trim(), networkType }),
      });
      const data = await res.json();
      if (data?.connections) setConnections(data.connections);
      setNewConnUrl('');
    } catch {}
  }, [newConnUrl]);

  const nodeBarPeers = useMemo(() => {
    if (!upstreamUrl || isLocalUrl(upstreamUrl)) return peers;

    try {
      const upstream = new URL(upstreamUrl);
      const upstreamId = `upstream:${upstreamUrl}`;
      const alreadyListed = peers.some((peer: any) =>
        peer.id === upstreamId ||
        (!peer.isLocal && peer.ip === upstream.hostname)
      );
      if (alreadyListed) return peers;

      const saved = connections.find((conn: any) => conn.url === upstreamUrl);
      const networkType = saved?.networkType === 'lan' ? 'lan' : 'wan';
      return [
        ...peers,
        {
          id: upstreamId,
          name: saved?.name || upstream.hostname,
          ip: upstream.hostname,
          type: 'agent',
          role: 'relay',
          networkType,
          hasPublicAccess: networkType === 'wan',
          connectedAt: Date.now(),
        },
      ];
    } catch {
      return peers;
    }
  }, [peers, upstreamUrl, connections]);

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
    wsUrl: activeNodeWsUrl,
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
    createInstance: createNodeInstance,
    instances,
    bindCurrentTabInstance: handleBindCurrentTabInstance,
    activeInstanceId,
    projectCwd: activeNodeProjectInfo?.cwd || '.',
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
    activeNodeWsUrl, token, logs, messages, turns,
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
    createNodeInstance, handleBindCurrentTabInstance, activateInstance, activeInstanceId,
    activeNodeProjectInfo?.cwd,
    activeExternalSession,
    cmdPanelRef, scrollContainerRef, actionEndRef,
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

      {/* ── Node bar — shows peers (+ local node) for entering workbenches ── */}
      <NodeBar
        peers={nodeBarPeers}
        wsUrl={wsUrl}
        activeNodeId={appState.activeInstanceId}
        onEnterNode={handleEnterNode}
        onOpenConnection={() => setAppState(prev => appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: null }))}
      />

      <MobileExtraKeys activeInstanceId={appState.activeInstanceId} statusBarHidden={!showStatusBar} sendShellInput={sendShellInput} />

      <div className="flex flex-1 overflow-hidden">
        <SidebarSlot open={effectiveLeftOpen}>
          <LeftSidebar
          fileTree={fileTree}
          expandedDirs={expandedDirs}
          onToggleDir={(dirPath) => {
            setNodeExpandedDirs(prev => {
              const current = prev[activeNodeWsUrl] || ['.'];
              const isExpanded = current.includes(dirPath);
              const next = isExpanded
                ? current.filter(d => d !== dirPath)
                : [...current, dirPath];
              if (!isExpanded) fetchDir(dirPath);
              return { ...prev, [activeNodeWsUrl]: next };
            });
          }}
          onOpenFile={(filePath) => {
            fetch(`${activeNodeWsUrl === wsUrl ? '' : wsToHttpUrl(activeNodeWsUrl)}/api/read-file?path=${encodeURIComponent(filePath)}`)
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
          onBookmarkDir={(dirPath) => {
            addPathBookmark(dirPath);
          }}
          onCommand={(cmdId) => runWorkbenchCommand({ command: cmdId }, actionRunContext)}
          projectCwd={activeNodeProjectInfo?.cwd || '.'}
          instances={instances.filter((i: any) => appState.workbenchInstanceIds.includes(i.id) && (i.status === 'running' || i.status === 'starting'))}
          activeInstanceId={activeInstanceId}
          onActivateInstance={activateInstance}
          onCreateInstance={(dir, label, adapterId) => createNodeInstance(dir, label, adapterId)}
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
              const boundInstance = instanceId ? instances.find((i: any) => i.id === instanceId) : null;
              const resolvedViewId = boundInstance?.adapterId
                ? getAdapterViewId(boundInstance.adapterId) || viewType
                : viewType;
              return <MainSlot viewId={resolvedViewId} instanceId={instanceId} />;
            }}
          />
          </div>) : (
            <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
              <div className="p-6 space-y-6 max-w-3xl mx-auto w-full">
                <NodeNetworkView
                  peers={peers}
                  links={peerLinks}
                  wsUrl={wsUrl}
                  connections={connections}
                  onDeleteConnection={handleDeleteConnection}
                  newConnUrl={newConnUrl}
                  onNewConnUrlChange={setNewConnUrl}
                  onAddConnection={handleAddConnection}
                  onEnterNode={handleEnterNode}
                  upstreamUrl={upstreamUrl}
                  onConnectUpstream={handleConnectUpstream}
                  onDisconnectUpstream={handleDisconnectUpstream}
                  upstreamConnectingUrl={upstreamConnectingUrl}
                  upstreamError={upstreamError}
                  upstreamErrorUrl={upstreamErrorUrl}
                  upstreamStatus={upstreamUrl ? 'connected' : undefined}
                  isLocalPage={isLocalPage}
                  browserId={browserId}
                />
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
            fetch(`${activeNodeWsUrl === wsUrl ? '' : wsToHttpUrl(activeNodeWsUrl)}/api/read-file?path=${encodeURIComponent(filePath)}`)
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
          onNavigatePath={onNavigatePath}
          currentActiveDir={fileTreeRoot || '.'}
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
        onToggleDir={(dirPath) => {
          setNodeExpandedDirs(prev => {
            const current = prev[activeNodeWsUrl] || ['.'];
            const isExpanded = current.includes(dirPath);
            const next = isExpanded
              ? current.filter(d => d !== dirPath)
              : [...current, dirPath];
            if (!isExpanded) fetchDir(dirPath);
            return { ...prev, [activeNodeWsUrl]: next };
          });
        }}
        onOpenFile={(filePath) => {
          fetch(`${activeNodeWsUrl === wsUrl ? '' : wsToHttpUrl(activeNodeWsUrl)}/api/read-file?path=${encodeURIComponent(filePath)}`)
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
        onBookmarkDir={(dirPath) => {
          addPathBookmark(dirPath);
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
          fetch(`${activeNodeWsUrl === wsUrl ? '' : wsToHttpUrl(activeNodeWsUrl)}/api/read-file?path=${encodeURIComponent(filePath)}`)
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
