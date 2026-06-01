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
import { getAdapterViewId, getAdapterCapabilities, getViewEntry, getAllAdapterTypes, resolveChromePolicy, type ChromePolicy } from './console/main/view-registry';
import { ensureBootstrapped } from './console/bootstrap';
import { CoreClientProvider, useCore, useSetActiveNode, useActiveNodeId, useLocalNodeId, useTargetReachability } from './console/core/core-client-provider';
import { CoreErrorProvider } from './console/core/core-error-provider';
import { CoreErrorBanner } from './console/core/core-error-banner';
import { classifyCoreError } from './console/core/core-error';
import { useCoreErrors } from './console/core/use-core-call';
import { useAppSync } from './console/core/use-app-sync';
import { normalizeWsUrlAndToken, stripTokenFromWsUrl } from './console/core/core-url';


ensureBootstrapped();
import { useNotification } from './console/shared/notification-context';
import { sessionStore } from '../lib/session-store';
import { useMessageSessions } from './console/hooks/use-message-sessions';
import { useHistoryLoader } from './console/hooks/use-history-loader';
import { useCommandHandlers } from './console/hooks/use-command-handlers';
import { useKeyboardShortcuts } from './console/hooks/use-keyboard-shortcuts';
import { useContextMenu } from './console/hooks/use-context-menu';
import type { ContextMenuRequest, ContextMenuItemSpec } from './console/menus/context-menu-types';
import { registerBuiltinCommands } from './console/commands/register-builtin-commands';
// Host component registration is now driven by plugin.yaml → syncAllPlugins
import './console/plugin-host'; // side-effect: registers host component library
import { registerCommand, getCommand } from './console/commands/command-registry';
import { getAction, getActions } from './console/actions/action-registry';
import { runWorkbenchCommand } from './console/actions/workbench-command-dispatch';
import type { ActionRunContext } from './console/actions/action-types';
import type { ContextMenuItem } from './console/shell/context-menu';
import { ConsoleOverlays } from './console/overlays/console-overlays';
import { getLastActiveDir, setLastActiveDir, getRestoreLastPath, addPathBookmark, setBookmarkScope } from './lib/path-bookmarks';
import { NodeBar } from './console/stage/node-bar';
import { NodeNetworkView } from './console/sidebar/node-network-view';
import { KeyHintOverlay } from './console/chrome/key-hint-overlay';
import { LayoutProvider, useLayout, SidebarSlot, MainSlot, FocusProvider, RuntimePolicyProvider, useFocus, useRuntimePolicy, WorkbenchProvider } from './console/workbench';
import { WorkbenchLayout } from './console/stage/workbench-layout';
import { appReducer, createAppInitialState, getActiveWorkbenchState, createInitialState, findPane as findPaneInTree, ensureInstanceTab, saveLayoutsToStorage, loadLayoutsFromStorage, restoreInstanceStatesFromStorage, genTabId, collectAllTabs, type ViewType, type PaneTab, type LayoutNode, type WorkbenchState, type WorkbenchAction, type AppWorkbenchState, type AppWorkbenchAction } from './console/stage/workbench-state';


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

/**
 * Computes wsUrl / token from search params, then wraps the app in
 * CoreClientProvider so useCore() works via the server-side proxy.
 *
 * Core connection target is configurable from the Settings panel
 * via POST /api/core/target. useSession() still uses wsUrl/token
 * for legacy terminal/chat sessions.
 */
function PageContent() {
  const defaultUrl = typeof window !== 'undefined'
    ? location.port === '3000'
      ? 'ws://localhost:9090/ws'
      : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
    : 'ws://localhost:9090/ws';
  const params = typeof window !== 'undefined' ? new URL(window.location.href).searchParams : new URLSearchParams();
  const urlParam = params.get('url');
  const tokenParam = params.get('token');
  // Normalize: extract any token from urlParam, explicit tokenParam wins
  const initNormalized = normalizeWsUrlAndToken(urlParam || defaultUrl, tokenParam || undefined);
  const [wsUrl, setWsUrl] = useState(() => initNormalized.wsUrl);
  const [token, setToken] = useState<string | undefined>(initNormalized.token);
  const [reconnectKey, setReconnectKey] = useState(0);

  return (
    <CoreClientProvider forceOffline={false} reconnectKey={reconnectKey}>
      <CoreErrorProvider>
        <AppCore wsUrl={wsUrl} setWsUrl={setWsUrl} token={token} setToken={setToken} onReconnect={() => setReconnectKey(k => k + 1)} />
      </CoreErrorProvider>
    </CoreClientProvider>
  );
}

interface AppCoreProps {
  wsUrl: string;
  setWsUrl: (url: string) => void;
  token: string | undefined;
  setToken: React.Dispatch<React.SetStateAction<string | undefined>>;
  onReconnect: () => void;
}

function AppCore({ wsUrl, setWsUrl, token, setToken, onReconnect }: AppCoreProps) {
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
    if (typeof window !== 'undefined' && new URL(window.location.href).searchParams.has('url')) return; // URL param takes precedence
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
          if (savedHost === host) {
            // Migrate: strip any token from old localStorage value
            const { wsUrl: cleanUrl, token: migratedToken } = normalizeWsUrlAndToken(saved);
            setWsUrl(cleanUrl);
            // If the old URL had a token and no explicit token is set, migrate it
            if (migratedToken) {
              setToken(prev => prev ?? migratedToken);
            }
            // Immediately persist clean URL (no token) to localStorage
            localStorage.setItem('bridge-ws-url', cleanUrl);
          }
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
      if (urlHost === curHost) localStorage.setItem('bridge-ws-url', stripTokenFromWsUrl(wsUrl)); // belt-and-suspenders: strip in case state somehow has token
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileRightOpen, setMobileRightOpen] = useState(false);
  // Timer to refresh task durations and queue every 5s
  useEffect(() => {
    if (activeTasks.size === 0 && !phase) return;
    const timer = setInterval(() => setTaskTimer(t => t + 1), 5000);
    return () => clearInterval(timer);
  }, [activeTasks.size, phase]);
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
  const [nodeFileTree, setNodeFileTree] = useState<Record<string, Record<string, {items: any[]; loaded: boolean; error?: string}>>>({});
  const [nodeExpandedDirs, setNodeExpandedDirs] = useState<Record<string, string[]>>({});

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


  const { connStatus, msgLog, sendInput, sendCommand, serverBlocks, sessions, activeSessionId, activateSession, spawnSession, isWorkspace, queueStatus, instances, activeInstanceId, activateInstance, createInstance, killInstance } = useSession(wsUrl, token ?? undefined, undefined, undefined, undefined, onSystemNotify, dismiss);

  // ── Core plugin manifest → extension points sync ──
  const handleCorePluginCommand = useCallback((commandId: string) => {
    sendCommand(commandId, {});
  }, [sendCommand]);
  useAppSync(core, handleCorePluginCommand);

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

  // Derived active-node file tree values
  const fileTree = nodeFileTree[activeNodeWsUrl] || {};
  const expandedDirs = new Set(nodeExpandedDirs[activeNodeWsUrl] || [absoluteCwd || '.']);

  // Sync bookmark scope with active node
  useEffect(() => {
    try {
      const host = activeNodeWsUrl !== wsUrl ? new URL(activeNodeWsUrl).hostname : null;
      setBookmarkScope(host);
      window.dispatchEvent(new CustomEvent('sb-bookmarks-changed'));
    } catch {}
  }, [activeNodeWsUrl, wsUrl]);

  const fetchDir = useCallback(async (dir: string) => {
    if (!core?.isConnected) return;
    try {
      const res = await core.call<{ path: string; entries: Array<{ name: string; isDir: boolean; size: number; mode: string }> }>('fs.list', { path: dir });
      const entries = res?.entries ?? [];
      const prefix = dir.endsWith('/') ? dir : dir + '/';
      const items = entries.map((e: { name: string; isDir: boolean }) => ({ name: e.name, type: e.isDir ? 'dir' : 'file', path: prefix + e.name }));
      setNodeFileTree(prev => ({
        ...prev,
        [activeNodeWsUrl]: { ...(prev[activeNodeWsUrl] || {}), [dir]: {items, loaded: true} }
      }));
    } catch (err) {
      setNodeFileTree(prev => ({
        ...prev,
        [activeNodeWsUrl]: { ...(prev[activeNodeWsUrl] || {}), [dir]: {items: [], loaded: true, error: String(err)} }
      }));
    }
  }, [activeNodeWsUrl, core]);
  // Fetch root when active node changes, core connects, or absoluteCwd is resolved
  useEffect(() => { if (absoluteCwd) fetchDir(absoluteCwd); }, [fetchDir, core.isConnected, absoluteCwd]);

  const onNavigatePath = useCallback((path: string) => {
    setLastActiveDir(path);
    fetchDir(path);
    setNodeExpandedDirs(prev => ({...prev, [activeNodeWsUrl]: [absoluteCwd, path]}));
  }, [fetchDir, activeNodeWsUrl, absoluteCwd]);

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
  const activeViewChrome = paneFocus ? getViewEntry(paneFocus.viewType)?.meta.chrome : undefined;
  const chromePolicy = resolveChromePolicy(activeViewChrome);
  const showStatusBar = chromePolicy.statusBar !== 'hidden';
  const activeSidebarReqs = paneFocus ? getViewEntry(paneFocus.viewType)?.meta.sidebarRequirements : undefined;

  // Effective sidebar open state: sidebarRequirements drive defaults per view;
  // manual toggle (sidebarOverride) takes precedence.
  // Sidebars are hidden when no node is active (NodeNetworkView visible).
  const noActiveNode = !appState.activeInstanceId;
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
  const effectiveLeftOpen = noActiveNode ? false : state.sidebarOverride
    ? state.leftSidebarOpen
    : activeSidebarReqs?.left === 'hidden' ? false
    : activeSidebarReqs?.left === 'shown' ? true
    : state.leftSidebarOpen;
  const effectiveRightOpen = noActiveNode ? false : state.sidebarOverride
    ? state.rightSidebarOpen
    : activeSidebarReqs?.right === 'hidden' ? false
    : activeSidebarReqs?.right === 'shown' ? true
    : state.rightSidebarOpen;

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

  const addLog = useCallback((msg: string) => setLogs(prev => [...prev, msg]), []);

  const handleInterrupt = useCallback(() => {
    sendCommand('interrupt');
    addLog('[System] ⏹ Interrupting Claude...');
    setPhase('idle');
    setCurrentActivity('Interrupted');
  }, [sendCommand, addLog]);

  // ── Remote node project info (legacy /api/info removed; uses hostname fallback) ──
  const activeNodeProjectInfo = useMemo(() => {
    if (activeNodeWsUrl === wsUrl) return projectInfo;
    try {
      const host = new URL(activeNodeWsUrl).hostname;
      return { cwd: '.', projectName: host, homeDir: '.' };
    } catch {
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
      // Clear in-memory messages — sessionKey is always 'default' in non-workspace mode
      setMessagesBySession({});
      // Skip old server blocks they belong to the old project
      processedRef.current = serverBlocks.length;
      historyLoadedRef.current = false; // reload history for new directory
      setPhase('idle'); setCurrentActivity(null);
      setProjectInfo({ cwd: dir, projectName: dir.split(/[/\\]/).pop() || '', homeDir: dir });
      addLog(`[System] Switched to ${dir.split(/[/\\]/).pop() || dir}`);
      setNodeFileTree(prev => ({...prev, [wsUrl]: {}}));
      setNodeExpandedDirs(prev => ({...prev, [wsUrl]: [absoluteCwd || '.']}));
      fetchDir(absoluteCwd || '.');
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
    activeNodeWsUrl,
    activateInstance,
    activeExternalSession,
    clearExternalSession: () => {
      setActiveExternalSession(null);
      try { localStorage.removeItem('sessionbridge-active-session'); } catch {}
      historyLoadedRef.current = false;
      window.location.reload();
    },
    onNavigatePath,
    absoluteCwd: absoluteCwd || activeNodeProjectInfo?.cwd || '.',
    onCwdChange: (path: string) => { setAbsoluteCwd(path); },
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
    activeNodeProjectInfo?.cwd, absoluteCwd,
    activeExternalSession,
    onNavigatePath,
    cmdPanelRef, scrollContainerRef, actionEndRef,
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
      {showBanner && (
        <div className="flex items-center justify-center gap-2 px-3 py-1.5 text-[11px] font-bold tracking-wider uppercase"
          style={{ backgroundColor: connStatus.status === 'connecting' ? '#1a3a1a' : '#3a1a1a', color: connStatus.status === 'connecting' ? '#4ade80' : '#f87171' }}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusColor}`} />
          {connStatus.status === 'connecting' ? 'Connecting to server...' : `Disconnected from server${connStatus.retryCount ? ` (retry #${connStatus.retryCount})` : ''}`}
        </div>
      )}

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
          onToggleDir={(dirPath) => {
            setNodeExpandedDirs(prev => {
              const current = prev[activeNodeWsUrl] || [absoluteCwd || '.'];
              const isExpanded = current.includes(dirPath);
              const next = isExpanded
                ? current.filter(d => d !== dirPath)
                : [...current, dirPath];
              if (!isExpanded) fetchDir(dirPath);
              return { ...prev, [activeNodeWsUrl]: next };
            });
          }}
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
          <WorkbenchProvider value={workbenchContextValue}>
          <div className="flex flex-col flex-1 min-h-0 min-w-0" style={{ display: appState.activeInstanceId ? 'flex' : 'none' }}>
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
        onToggleDir={(dirPath) => {
          setNodeExpandedDirs(prev => {
            const current = prev[activeNodeWsUrl] || [absoluteCwd || '.'];
            const isExpanded = current.includes(dirPath);
            const next = isExpanded
              ? current.filter(d => d !== dirPath)
              : [...current, dirPath];
            if (!isExpanded) fetchDir(dirPath);
            return { ...prev, [activeNodeWsUrl]: next };
          });
        }}
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
