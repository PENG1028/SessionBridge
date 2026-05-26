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
import { CoreClientProvider, useCore } from './console/core/core-client-provider';
import { useCorePluginRegistrySync } from './console/core/use-core-plugin-sync';
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
import { registerBuiltinHostComponents, registerPluginHostComponents } from './console/plugin-host';
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
import { appReducer, createAppInitialState, getActiveWorkbenchState, createInitialState, findPane as findPaneInTree, ensureInstanceTab, saveLayoutsToStorage, loadLayoutsFromStorage, restoreInstanceStatesFromStorage, genTabId, collectAllTabs, buildStateFromTabs, workbenchReducer, type ViewType, type PaneTab, type LayoutNode, type WorkbenchState, type WorkbenchAction, type AppWorkbenchState, type AppWorkbenchAction } from './console/stage/workbench-state';

const DEBUG_SURFACE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debugSurface');
function debugLog(...args: any[]) { if (DEBUG_SURFACE) console.log('[debugSurface]', ...args); }

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

/**
 * Computes wsUrl / token from search params and localStorage, then
 * wraps the app in CoreClientProvider so useCore() receives the same
 * wsUrl / token that useSession() uses.
 *
 * Default connection mode: "proxy" (server-side Core call via /api/core/call).
 * Direct mode only activated via explicit ?coreMode=direct query param.
 * In direct mode, ?url and ?token query params are used for WebSocket URL.
 */
function PageContent() {
  const defaultUrl = typeof window !== 'undefined'
    ? location.port === '3000'
      ? 'ws://localhost:8080/ws'
      : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
    : 'ws://localhost:8080/ws';
  const params = typeof window !== 'undefined' ? new URL(window.location.href).searchParams : new URLSearchParams();
  const urlParam = params.get('url');
  const tokenParam = params.get('token');
  const coreModeParam = params.get('coreMode');
  // Normalize: extract any token from urlParam, explicit tokenParam wins
  const initNormalized = normalizeWsUrlAndToken(urlParam || defaultUrl, tokenParam || undefined);
  const [wsUrl, setWsUrl] = useState(() => initNormalized.wsUrl);
  const [token, setToken] = useState<string | undefined>(initNormalized.token);
  const [reconnectKey, setReconnectKey] = useState(0);
  // Default to proxy mode; direct mode only with explicit query param
  const [coreMode, setCoreMode] = useState<'proxy' | 'direct'>(coreModeParam === 'direct' ? 'direct' : 'proxy');

  return (
    <CoreClientProvider wsUrl={wsUrl} token={token} mode={coreMode} forceOffline={false} reconnectKey={reconnectKey}>
      <AppCore wsUrl={wsUrl} setWsUrl={setWsUrl} token={token} setToken={setToken} onReconnect={() => setReconnectKey(k => k + 1)} coreMode={coreMode} setCoreMode={setCoreMode} />
    </CoreClientProvider>
  );
}

interface AppCoreProps {
  wsUrl: string;
  setWsUrl: (url: string) => void;
  token: string | undefined;
  setToken: React.Dispatch<React.SetStateAction<string | undefined>>;
  onReconnect: () => void;
  coreMode: 'proxy' | 'direct';
  setCoreMode: (mode: 'proxy' | 'direct') => void;
}

function AppCore({ wsUrl, setWsUrl, token, setToken, onReconnect, coreMode, setCoreMode }: AppCoreProps) {
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
  const [projectInfo, setProjectInfo] = useState<{cwd: string; projectName: string; homeDir?: string} | null>(null);
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
      // Re-read browserId
      try {
        const id = sessionStorage.getItem('bridge-browser-id');
        if (id) setBrowserId(id);
      } catch {}
    } else if (msg.type === 'workbench.tabs') {
      // Server sent updated workbench tabs for a node
      const nodeId: string = msg.nodeId;
      let tabs: any[] = Array.isArray(msg.tabs) ? msg.tabs : [];
      if (!nodeId) return;
      // Detect stale terminal tabs: instanceId === nodeId but no _surfaceId
      for (const t of tabs) {
        if (t.viewType === 'terminal' && t.instanceId === nodeId && !t._surfaceId) {
          t._stale = true;
          debugLog('stale tab detected (workbench.tabs)', { tabId: t.id, instanceId: t.instanceId, nodeId });
        }
      }
      setAppState(prev => {
        const currentWs = prev.instanceStates[nodeId];
        if (!currentWs) {
          // First time seeing this node's tabs — create workbench state
          return { ...prev, instanceStates: { ...prev.instanceStates, [nodeId]: buildStateFromTabs(tabs as PaneTab[]) } };
        }
        const currentTabs = collectAllTabs(currentWs);
        // Don't let empty server tabs overwrite locally-initialized tabs
        // (e.g. after createInitialState set instanceId from peer.id)
        if (tabs.length === 0 && currentTabs.length > 0) {
          return prev;
        }
        // Only update if tabs actually differ — compare full fields:
        // id, title, viewType, instanceId, _stale.  A tab can change from 'empty'
        // to 'terminal' without its id changing, and we must pick that up.
        const tabEq = (a: any, b: any) =>
          a.id === b.id && a.title === b.title && a.viewType === b.viewType && a.instanceId === b.instanceId;
        if (tabs.length === currentTabs.length && tabs.every((t, i) => tabEq(t, currentTabs[i]))) {
          return prev;
        }
        // Preserve active tab selection if the tab still exists
        const currentActiveId = currentWs.root.kind === 'pane' ? currentWs.root.activeTabId : '';
        const newWs = buildStateFromTabs(tabs as PaneTab[], currentActiveId);
        return {
          ...prev,
          instanceStates: { ...prev.instanceStates, [nodeId]: newWs },
        };
      });
    } else if (msg.type === 'surface.published') {
      const surface = msg.surface;
      debugLog('RECEIVED surface.published', { surfaceId: surface?.surfaceId, nodeId: surface?.nodeId, viewType: surface?.viewType, instanceId: surface?.runtimeRef?.instanceId });
      if (surface?.surfaceId && surface.nodeId) {
        const instIdForAck = surface.runtimeRef?.instanceId;
        if (instIdForAck) {
          for (const key of Array.from(surfacePublishInFlightRef.current)) {
            if (key.startsWith(`${surface.nodeId}:${instIdForAck}:`)) {
              surfacePublishInFlightRef.current.delete(key);
            }
          }
        }
        setAppState(prev => {
          let currentWs = prev.instanceStates[surface.nodeId];
          if (!currentWs) {
            currentWs = createInitialState(surface.nodeId);
          }
          // Already tracked by surfaceId
          if (collectAllTabs(currentWs).some(t => t._surfaceId === surface.surfaceId || t.id === surface.surfaceId)) { debugLog('surface.published SKIP: tab already tracked', { surfaceId: surface.surfaceId }); return prev; }
          const instId = surface.runtimeRef?.instanceId;
          const activePane = findPaneInTree(currentWs.root, currentWs.activePaneId);
          if (!activePane) return prev;
          // Merge: if the current tab shares the same instanceId, upgrade it with surface metadata in-place
          if (instId) {
            const existingTab = activePane.tabs.find(t => t.instanceId === instId && !t._surfaceId);
            if (existingTab) {
              debugLog('surface.published MERGE: upgrading existing tab with surface metadata', { tabId: existingTab.id, instanceId: instId, surfaceId: surface.surfaceId });
              currentWs = workbenchReducer(currentWs, {
                type: 'SET_TAB_VIEW',
                paneId: activePane.id,
                tabId: existingTab.id,
                viewType: existingTab.viewType,
                title: surface.title || existingTab.title,
                instanceId: instId,
                _surfaceId: surface.surfaceId,
              });
              return { ...prev, instanceStates: { ...prev.instanceStates, [surface.nodeId]: currentWs } };
            }
          }
          // No existing tab to upgrade — create new one
          debugLog('surface.published CREATE: adding new tab', { surfaceId: surface.surfaceId, viewType: surface.viewType, instanceId: instId });
          const tab: PaneTab = {
            id: surface.surfaceId,
            title: surface.title || 'Shared',
            viewType: surface.viewType,
            instanceId: instId,
            pluginId: surface.pluginId,
            _surfaceId: surface.surfaceId,
          };
          currentWs = workbenchReducer(currentWs, { type: 'ADD_TAB', paneId: activePane.id, tab, activate: false });
          // Clean up empty placeholder tab when real surface tab was added
          const paneAfterAdd = findPaneInTree(currentWs.root, currentWs.activePaneId);
          if (paneAfterAdd) {
            const emptyTabs = paneAfterAdd.tabs.filter(t => t.viewType === 'empty');
            const realTabs = paneAfterAdd.tabs.filter(t => t.viewType !== 'empty');
            if (realTabs.length > 0 && emptyTabs.length > 0) {
              for (const empty of emptyTabs) {
                currentWs = workbenchReducer(currentWs, { type: 'CLOSE_TAB', paneId: paneAfterAdd.id, tabId: empty.id });
              }
            }
            // Detect stale terminal tabs: instanceId === nodeId but no _surfaceId
            for (const t of paneAfterAdd.tabs) {
              if (t.viewType === 'terminal' && t.instanceId === surface.nodeId && !t._surfaceId && !t._stale) {
                debugLog('stale tab detected (surface.published)', { tabId: t.id, instanceId: t.instanceId, nodeId: surface.nodeId });
              }
            }
          }
          return { ...prev, instanceStates: { ...prev.instanceStates, [surface.nodeId]: currentWs } };
        });
      }
    } else if (msg.type === 'surface.list') {
      const nodeId: string = msg.nodeId;
      const surfaces: any[] = Array.isArray(msg.surfaces) ? msg.surfaces : [];
      debugLog('RECEIVED surface.list', { nodeId, surfaceCount: surfaces.length });
      if (nodeId && surfaces.length > 0) {
        setAppState(prev => {
          let currentWs = prev.instanceStates[nodeId];
          if (!currentWs) {
            // surface.list arrived before setAppState committed this nodeId.
            // Create a minimal state instead of dropping the list — otherwise
            // the surfaces are lost until the user re-enters the node.
            currentWs = createInitialState(nodeId);
          }
          const surfaceIds = new Set(surfaces.map(s => s.surfaceId));
          for (const s of surfaces) {
            // Skip if surface tab already exists
            if (collectAllTabs(currentWs).some(t => t._surfaceId === s.surfaceId || t.id === s.surfaceId)) { debugLog('surface.list SKIP: tab already exists', { surfaceId: s.surfaceId }); continue; }
            // Merge: if a localStorage-restored tab shares the same instanceId, upgrade it with surface metadata
            const instId = s.runtimeRef?.instanceId;
            const existingPane = findPaneInTree(currentWs.root, currentWs.activePaneId);
            if (instId && existingPane) {
              const existingTab = existingPane.tabs.find(t => t.instanceId === instId && !t._surfaceId);
              if (existingTab) {
                debugLog('surface.list MERGE: upgrading existing tab with surface metadata', { tabId: existingTab.id, instanceId: instId, surfaceId: s.surfaceId });
                currentWs = workbenchReducer(currentWs, {
                  type: 'SET_TAB_VIEW',
                  paneId: existingPane.id,
                  tabId: existingTab.id,
                  viewType: existingTab.viewType,
                  title: s.title || existingTab.title,
                  instanceId: instId,
                  _surfaceId: s.surfaceId,
                });
                continue;
              }
            }
            if (!existingPane) continue;
            debugLog('surface.list CREATE: adding new tab', { surfaceId: s.surfaceId, viewType: s.viewType, instanceId: instId });
            const tab: PaneTab = {
              id: s.surfaceId,
              title: s.title,
              viewType: s.viewType,
              instanceId: instId,
              pluginId: s.pluginId,
              _surfaceId: s.surfaceId,
            };
            const shouldActivate = existingPane.tabs.every(t => t.viewType === 'empty');
            currentWs = workbenchReducer(currentWs, { type: 'ADD_TAB', paneId: existingPane.id, tab, activate: shouldActivate });
          }
          // Detect stale surface references: tabs with _surfaceId pointing to
          // a surface that no longer exists in the relay's surface list.
          const activePane2 = findPaneInTree(currentWs.root, currentWs.activePaneId);
          if (activePane2) {
            for (const t of activePane2.tabs) {
              if (t._surfaceId && !surfaceIds.has(t._surfaceId)) {
                debugLog('stale surface removed (surface.list)', { tabId: t.id, _surfaceId: t._surfaceId, nodeId });
                currentWs = workbenchReducer(currentWs, {
                  type: 'SET_TAB_VIEW',
                  paneId: activePane2.id,
                  tabId: t.id,
                  viewType: t.viewType,
                  title: t.title,
                  instanceId: t.instanceId,
                  _surfaceId: undefined,
                  _stale: true,
                } as any);
              }
            }
          }
          // Detect stale terminal tabs: instanceId === nodeId but no _surfaceId
          const allTabs = collectAllTabs(currentWs);
          for (const t of allTabs) {
            if (t.viewType === 'terminal' && t.instanceId === nodeId && !t._surfaceId && !t._stale) {
              debugLog('stale tab detected (surface.list)', { tabId: t.id, instanceId: t.instanceId, nodeId });
            }
          }
          // Clean up empty placeholder tab (from createInitialState) when
          // real tabs exist. Without this the empty "New" tab persists
          // alongside real surface tabs, causing visual duplication.
          const activePane = findPaneInTree(currentWs.root, currentWs.activePaneId);
          if (activePane) {
            const emptyTabs = activePane.tabs.filter(t => t.viewType === 'empty');
            const realTabs = activePane.tabs.filter(t => t.viewType !== 'empty');
            if (realTabs.length > 0 && emptyTabs.length > 0) {
              for (const empty of emptyTabs) {
                currentWs = workbenchReducer(currentWs, { type: 'CLOSE_TAB', paneId: activePane.id, tabId: empty.id });
              }
            }
          }
          return { ...prev, instanceStates: { ...prev.instanceStates, [nodeId]: currentWs } };
        });
      }
    } else if (msg.type === 'surface.closed') {
      const closedId: string = msg.surfaceId;
      if (closedId) {
        debugLog('RECEIVED surface.closed', { surfaceId: closedId });
        setAppState(prev => {
          const next = { ...prev, instanceStates: { ...prev.instanceStates } };
          for (const [nid, ws] of Object.entries(next.instanceStates)) {
            // Walk all panes (root + bottom), not just the active one
            const panes: any[] = [];
            function collectPanes(node: any) {
              if (!node) return;
              if (node.kind === 'pane') panes.push(node);
              if (node.children) for (const c of node.children) collectPanes(c);
            }
            collectPanes(ws.root);
            if (ws.bottom) collectPanes(ws.bottom);
            for (const pane of panes) {
              const tab = pane.tabs.find((t: PaneTab) => t._surfaceId === closedId || t.id === closedId);
              if (tab) {
                // If this is the only real tab, strip surface metadata instead of
                // closing — keeps at least one tab visible and avoids ShellTerminal
                // trying to connect to a dead operation.
                const realTabs = pane.tabs.filter((t: PaneTab) => t.viewType !== 'empty');
                if (realTabs.length <= 1 && tab.viewType !== 'empty') {
                  debugLog('surface.closed STRIP: last real tab, removing surface metadata', { tabId: tab.id, surfaceId: closedId });
                  next.instanceStates[nid] = workbenchReducer(ws, {
                    type: 'SET_TAB_VIEW',
                    paneId: pane.id,
                    tabId: tab.id,
                    viewType: tab.viewType,
                    title: tab.title,
                    instanceId: tab.instanceId,
                    _surfaceId: undefined,
                    _stale: true,
                  } as any);
                } else {
                  debugLog('surface.closed CLOSE_TAB', { tabId: tab.id, surfaceId: closedId });
                  next.instanceStates[nid] = workbenchReducer(ws, { type: 'CLOSE_TAB', paneId: pane.id, tabId: tab.id });
                }
              }
            }
          }
          return next;
        });
      }
    } else if (msg.type === 'runtime.replay') {
      // Relay sends replay to main WS when surface.subscribeNode triggers
      // subscribe for each surface. Shell terminal handles replay on its own
      // WebSocket; here we cache the latest output for tab previews.
      const surfaceId: string = msg.surfaceId;
      const outputs: any[] = Array.isArray(msg.outputs) ? msg.outputs : [];
      if (surfaceId && outputs.length > 0) {
        setAppState(prev => {
          const next = { ...prev, tabOutputs: { ...prev.tabOutputs, [surfaceId]: outputs } };
          return next;
        });
      }
    } else if (msg.type === 'runtime.output') {
      const surfaceId: string = msg.surfaceId;
      if (surfaceId && msg.data != null) {
        setAppState(prev => {
          const existing = prev.tabOutputs?.[surfaceId] || [];
          const chunk = { stream: msg.stream || 'stdout', data: msg.data, seq: msg.seq };
          return { ...prev, tabOutputs: { ...prev.tabOutputs, [surfaceId]: [...existing, chunk].slice(-200) } };
        });
      }
    } else if (msg.type === 'runtime.status') {
      const surfaceId: string = msg.surfaceId;
      if (surfaceId) {
        setAppState(prev => ({
          ...prev,
          runtimeStatuses: { ...prev.runtimeStatuses, [surfaceId]: msg.status },
        }));
      }
    } else if (msg.type === 'runtime.result') {
      const surfaceId: string = msg.surfaceId;
      if (surfaceId) {
        setAppState(prev => ({
          ...prev,
          runtimeResults: { ...prev.runtimeResults, [surfaceId]: msg },
        }));
      }
    }
  }, []);

  const { connStatus, msgLog, sendInput, sendCommand, serverBlocks, sessions, activeSessionId, activateSession, spawnSession, isWorkspace, queueStatus, instances, activeInstanceId, activateInstance, createInstance, killInstance, sendMessage } = useSession(wsUrl, token ?? undefined, undefined, undefined, undefined, onSystemNotify, dismiss, handleSystemMessage);
  const core = useCore();

  // ── Core plugin manifest → extension points sync ──
  const handleCorePluginCommand = useCallback((commandId: string) => {
    sendCommand(commandId, {});
  }, [sendCommand]);
  useCorePluginRegistrySync(core, handleCorePluginCommand);

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

  // Plugin contributions are registered by useCorePluginRegistrySync via CoreClient.

  // ── Workbench pane/tab layout state (Phase 4N: per-instance workbench) ──
  const [appState, setAppState] = useState<AppWorkbenchState>(() => createAppInitialState());
  const appDispatch = useCallback((action: AppWorkbenchAction) => {
    setAppState(prev => appReducer(prev, action));
  }, []);

  // Workbench actions that change the tab structure (need cross-device sync)
  const structuralActions = new Set([
    'ADD_TAB', 'CLOSE_TAB', 'SET_TAB_VIEW', 'SPLIT_PANE', 'UNSPLIT_PANE',
    'REORDER_TABS', 'ADD_EMPTY_PANE', 'ADD_BOTTOM_PANE', 'REMOVE_PANE',
    'SPLIT_PANE_VERTICAL', 'SPLIT_PANE_HORIZONTAL', 'CLEAR_INSTANCE_TABS',
  ]);

  // Set inside setState updater (runs during render), flushed via useEffect
  // after React commits. This avoids reading the ref before the updater executes
  // in concurrent / batched update scenarios.
  const pendingSyncRef = useRef<{ nodeId: string; tabs: any[] } | null>(null);
  const surfacePublishInFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (pendingSyncRef.current) {
      const q = pendingSyncRef.current;
      pendingSyncRef.current = null;
      sendMessage('workbench.tabs', q);
    }
  }, [appState.instanceStates, sendMessage]);

  const activeWorkbenchDispatch = useCallback((action: WorkbenchAction) => {
    // When closing a tab backed by a surface, tell the server to clean up
    // the surface so it doesn't persist and reappear on next page load.
    if (action.type === 'CLOSE_TAB') {
      const curState = appStateRef.current;
      const activeId = curState.activeInstanceId;
      if (activeId && curState.instanceStates[activeId]) {
        const ws = curState.instanceStates[activeId];
        const pane = findPaneInTree(ws.root, action.paneId) || ws.bottom;
        if (pane && pane.kind === 'pane') {
          const tab = pane.tabs.find(t => t.id === action.tabId);
          if (tab?._surfaceId) {
            sendMessage?.('surface.close', { surfaceId: tab._surfaceId });
          }
        }
      }
    }
    setAppState(prev => {
      const activeId = prev.activeInstanceId;
      if (activeId && prev.instanceStates[activeId]) {
        const next = appReducer(prev, { type: 'INSTANCE_ACTION', instanceId: activeId, action });
        if (structuralActions.has(action.type)) {
          const ws = next.instanceStates[activeId];
          if (ws) {
            pendingSyncRef.current = { nodeId: activeId, tabs: collectAllTabs(ws) };
          }
        }
        return next;
      }
      return appReducer(prev, { type: 'GLOBAL_ACTION', action });
    });
  }, [sendMessage]);
  const activeWorkbenchState = useMemo(() => getActiveWorkbenchState(appState), [appState]);
  const appStateRef = useRef(appState);
  appStateRef.current = appState;
  const activeNodeWsUrl = useMemo(() => {
    const nodeId = appState.activeInstanceId;
    return nodeId?.startsWith('upstream:') ? nodeId.slice('upstream:'.length) : wsUrl;
  }, [appState.activeInstanceId, wsUrl]);

  // ── File open: CoreClient fs.read → relay HTTP fallback ──
  const handleOpenFile = useCallback((filePath: string) => {
    const fetchRelay = () => {
      const prefix = activeNodeWsUrl === wsUrl ? '' : wsToHttpUrl(activeNodeWsUrl);
      fetch(`${prefix}/api/read-file?path=${encodeURIComponent(filePath)}`)
        .then(r => r.json())
        .then(data => {
          if (data.content !== undefined) {
            setViewingFile({ path: data.path || filePath, content: data.content });
          }
        })
        .catch(() => {});
    };

    if (core?.isConnected) {
      core.call<{ path: string; content: string }>('fs.read', { path: filePath })
        .then(data => {
          if (data.content !== undefined) {
            setViewingFile({ path: data.path || filePath, content: data.content });
          }
        })
        .catch(() => fetchRelay());
      return;
    }

    fetchRelay();
  }, [core, activeNodeWsUrl, wsUrl]);

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
    // Prefer CoreClient fs.list when connected
    if (core?.isConnected) {
      try {
        const res = await core.call<{ path: string; entries: Array<{ name: string; isDir: boolean; size: number; mode: string }> }>('fs.list', { path: dir });
        const entries = res?.entries ?? [];
        const items = entries.map((e: { name: string; isDir: boolean }) => ({ name: e.name, type: e.isDir ? 'dir' : 'file' }));
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
      return;
    }
    // Fallback: relay HTTP API
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
  }, [activeNodeWsUrl, wsUrl, core]);
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

  // Track instance IDs for lifecycle management — workbench tab sync is now
  // server-driven (workbench.subscribe/workbench.tabs messages).
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
  // Plugin commands are registered directly by useCorePluginRegistrySync.
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

    // Plugin host initialization: register builtin host components
    // and plugin host components (TerminalView, SystemInfoPanel, etc.).
    registerBuiltinHostComponents();
    registerPluginHostComponents();

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
    }
    // else: fresh start — no saved layouts. Server-driven sync will provide
    // tabs when the user enters a node via workbench.subscribe/workbench.tabs.
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
      // Toggle off — back to node view
      sendMessage('workbench.unsubscribe', { nodeId });
      sendMessage('surface.unsubscribeNode', { nodeId });
      setAppState(prev => appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: null }));
    } else {
      // Subscribe to this node's workbench tabs (server will send workbench.tabs)
      sendMessage('workbench.subscribe', { nodeId });
      // Subscribe to shared surfaces for live output + replay
      sendMessage('surface.subscribeNode', { nodeId });
      // Enter this node — create workbench layout if needed
      setAppState(prev => {
        if (prev.instanceStates[nodeId]) {
          return appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: nodeId });
        }
        // Start with empty initial state; server tabs arrive async via workbench.tabs
        const newLayout = createInitialState();
        return appReducer(
          { ...prev, instanceStates: { ...prev.instanceStates, [nodeId]: newLayout } },
          { type: 'SET_ACTIVE_INSTANCE', instanceId: nodeId }
        );
      });
    }
  }, [sendMessage]);

  const handleRefreshNode = useCallback(() => {
    const nodeId = appStateRef.current.activeInstanceId;
    if (!nodeId) return;
    sendMessage('surface.subscribeNode', { nodeId });
    sendMessage('workbench.subscribe', { nodeId });
  }, [sendMessage]);

  // Periodic surface sync — safety net for cross-relay push notification gaps.
  // Re-subscribes to the active node's surfaces every 30s so new tabs from
  // other devices are discovered even if surface.published push was missed.
  useEffect(() => {
    const nodeId = appState.activeInstanceId;
    if (!nodeId) return;
    const id = setInterval(() => {
      sendMessage('surface.subscribeNode', { nodeId });
      sendMessage('workbench.subscribe', { nodeId });
    }, 30_000);
    return () => clearInterval(id);
  }, [appState.activeInstanceId, sendMessage]);

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

  // ── Upstream relay connection (removed — use Core mesh node.invite/node.peer instead) ──
  const [upstreamUrl, setUpstreamUrl] = useState<string | undefined>(undefined);
  const [upstreamConnectingUrl, setUpstreamConnectingUrl] = useState<string | undefined>(undefined);
  const [upstreamError, setUpstreamError] = useState<string | undefined>(undefined);
  const [upstreamErrorUrl, setUpstreamErrorUrl] = useState<string | undefined>(undefined);

  // ── Handle connect local node as leaf to a remote relay (removed) ──
  const handleConnectUpstream = useCallback(async (url: string) => {
    addLog(`[System] Relay upstream connections removed — use Core mesh (node.invite.* / node.peer.*). Ignored connect to ${url}`);
    setUpstreamConnectingUrl(undefined);
    setUpstreamError('Use Core mesh instead of legacy relay connections');
    setUpstreamErrorUrl(url);
  }, [addLog]);

  // ── Handle disconnect upstream (removed) ──
  const handleDisconnectUpstream = useCallback(async () => {
    addLog('[System] Relay upstream disconnect removed — use Core mesh (node.peer.*)');
    setUpstreamUrl(undefined);
    setUpstreamError(undefined);
    setUpstreamErrorUrl(undefined);
  }, [addLog]);

  // ── Saved connections (removed — saved relay connections no longer supported) ──
  const [connections, setConnections] = useState<any[]>([]);
  const [newConnUrl, setNewConnUrl] = useState('');
  const autoUpstreamAttemptedRef = useRef(false);
  const handleDeleteConnection = useCallback(async (_id: string) => {
    // no-op: relay connections removed
  }, []);
  const handleAddConnection = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newConnUrl.trim()) return;
    addLog('[System] Saved connections removed — use Core mesh for peer connections. Ignored add.');
    setNewConnUrl('');
  }, [newConnUrl, addLog]);

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

  const publishSurfaceForTab = useCallback((tab: PaneTab, instanceId: string) => {
    const nodeId = appStateRef.current.activeInstanceId;
    if (!nodeId) { debugLog('publishSurfaceForTab SKIP: no activeInstanceId', { tabId: tab.id, instanceId }); return false; }
    if (tab.viewType !== 'terminal') { debugLog('publishSurfaceForTab SKIP: not terminal', { tabId: tab.id, viewType: tab.viewType }); return false; }
    if (tab._surfaceId) { debugLog('publishSurfaceForTab SKIP: already has _surfaceId', { tabId: tab.id, _surfaceId: tab._surfaceId }); return false; }
    const publishKey = `${nodeId}:${instanceId}:${tab.id}`;
    if (surfacePublishInFlightRef.current.has(publishKey)) { debugLog('publishSurfaceForTab SKIP: already in flight', { publishKey }); return true; }
    debugLog('publishSurfaceForTab SENDING surface.publish', { nodeId, instanceId, tabId: tab.id });
    const sent = sendMessage('surface.publish', {
      nodeId,
      title: tab.title || 'Terminal',
      viewType: 'terminal',
      scope: 'node',
      shared: true,
      runtimeRef: { kind: 'terminal', instanceId },
      replayPolicy: { mode: 'tail', lines: 5000, bytes: 500000 },
    });
    if (!sent) { debugLog('publishSurfaceForTab FAIL: sendMessage returned false', { nodeId, instanceId, tabId: tab.id }); return false; }
    surfacePublishInFlightRef.current.add(publishKey);
    window.setTimeout(() => {
      surfacePublishInFlightRef.current.delete(publishKey);
    }, 5000);
    return true;
  }, [sendMessage]);

  // Phase 4F: Bind the active pane's current tab to an instanceId (called by views after explicit create).
  const handleBindCurrentTabInstance = useCallback((instanceId: string, surface?: any) => {
    const state = workbenchStateRef.current;
    const activePane = findPaneInTree(state.root, state.activePaneId);
    if (!activePane) { debugLog('bindCurrentTabInstance SKIP: no activePane'); return; }
    const activeTab = activePane.tabs.find(t => t.id === activePane.activeTabId);
    if (!activeTab) { debugLog('bindCurrentTabInstance SKIP: no activeTab'); return; }
    debugLog('bindCurrentTabInstance', { instanceId, tabId: activeTab.id, viewType: activeTab.viewType, title: activeTab.title, surfaceId: surface?.surfaceId });
    activeWorkbenchDispatch({
      type: 'SET_TAB_VIEW',
      paneId: activePane.id,
      tabId: activeTab.id,
      viewType: activeTab.viewType,
      title: activeTab.title,
      instanceId,
      _surfaceId: surface?.surfaceId,
    });
    if (surface?.surfaceId) {
      debugLog('bindCurrentTabInstance SKIP publish: API returned surface', { instanceId, surfaceId: surface.surfaceId });
      return;
    }
    // Publish shared surface for cross-device visibility.
    const published = publishSurfaceForTab(activeTab, instanceId);
    debugLog('bindCurrentTabInstance publishSurfaceForTab result', { instanceId, published });
  }, [activeWorkbenchDispatch, publishSurfaceForTab]);

  // Ensure a surface is published for an existing terminal tab that already
  // has an instanceId but no _surfaceId (e.g. restored from localStorage or
  // synced via workbench.tabs). Without this, other devices cannot discover
  // the terminal via surface.subscribeNode.
  const handleEnsureSurfacePublished = useCallback((instanceId: string) => {
    const state = workbenchStateRef.current;
    const nodeId = appStateRef.current.activeInstanceId;
    if (!nodeId) { debugLog('ensureSurfacePublished SKIP: no activeInstanceId', { instanceId }); return false; }
    // Walk the pane tree to find a tab with this instanceId and no _surfaceId
    function findTabInPane(pane: any): PaneTab | undefined {
      if (!pane) return undefined;
      const tab = pane.tabs?.find((t: PaneTab) => t.instanceId === instanceId && !t._surfaceId);
      if (tab) return tab;
      for (const child of pane.children || []) {
        const found = findTabInPane(child);
        if (found) return found;
      }
      return undefined;
    }
    const tab = findTabInPane(state.root) || (state.bottom ? findTabInPane(state.bottom) : undefined);
    if (tab) {
      debugLog('ensureSurfacePublished FOUND tab, calling publishSurfaceForTab', { instanceId, tabId: tab.id, tabTitle: tab.title, nodeId });
      return publishSurfaceForTab(tab, instanceId);
    }
    debugLog('ensureSurfacePublished SKIP: no matching tab found', { instanceId, nodeId });
    return false;
  }, [publishSurfaceForTab]);

  // ── Close tab: kill if not kept ──
  const handleCloseTab = useCallback((_paneId: string, _tabId: string, tab: PaneTab) => {
    const instId = tab.instanceId;
    if (instId) {
      // Kept tabs survive tab close (≡ menu revival). Non-kept → kill process.
      const isKept = appStateRef.current.persistentTabs.some(t => t.id === tab.id);
      if (!isKept) {
        // CoreClient mode: stop the run first, then fallback to relay killInstance
        if (core?.isConnected) {
          core.call('run.stop', { runId: instId }).catch(() => {});
        }
        killInstance(instId);
        setAppState(prev => appReducer(prev, { type: 'REMOVE_INSTANCE_LAYOUT', instanceId: instId }));
      }
    }
  }, [killInstance, core]);

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
    ensureSurfacePublished: handleEnsureSurfacePublished,
    activeInstanceId,
    projectCwd: activeNodeProjectInfo?.cwd || '.',
    homeDir: activeNodeProjectInfo?.homeDir || '.',
    activeNodeWsUrl,
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
        onRefreshNode={handleRefreshNode}
        onOpenConnection={() => setAppState(prev => appReducer(prev, { type: 'SET_ACTIVE_INSTANCE', instanceId: null }))}
      />

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
          onOpenFile={handleOpenFile}
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
          onOpenFile={handleOpenFile}
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
        wsUrl={wsUrl}
        token={token}
        onWsUrlChange={setWsUrl}
        onTokenChange={setToken}
        onReconnect={onReconnect}
        coreMode={coreMode}
        onCoreModeChange={setCoreMode}
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
