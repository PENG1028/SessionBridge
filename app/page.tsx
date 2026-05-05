'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSession } from '../lib/use-ws';
import {
  Terminal, FileCode, Search,
  Square, Cpu, CheckCircle2, ChevronRight,
  Sparkles, Ban, ChevronDown,
} from 'lucide-react';
import { TerminalView } from './console/main/terminal-view';
import { ContextMenu, type ContextMenuItem } from './console/shell/context-menu';
import { MobileSidebar } from './console/sidebar/mobile-sidebar';
import { useSessionSearch } from './console/shell/use-session-search';
import { LeftSidebar } from './console/sidebar/left-sidebar';
import { RightSidebar } from './console/sidebar/right-sidebar';
import { StatusBar } from './console/shell/status-bar';
import { ConsoleHeader } from './console/shell/console-header';
import { ForkDialog } from './console/shell/fork-dialog';
import { SearchResultsPanel } from './console/shell/search-results-panel';
import { ClaudeChatView } from './console/main/claude-chat-view';
import { adapterToViewId } from './console/main/view-registry';
import { InstanceTabBar } from './console/main/instance-tab-bar';
import { useNotification } from './console/shared/notification-context';
import { sessionStore } from '../lib/session-store';

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
  const params = typeof window !== 'undefined' ? new URL(window.location.href).searchParams : new URLSearchParams();
  const token = params.get('token');
  const wsUrl = typeof window !== 'undefined'
    ? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.hostname}:8080`
    : 'ws://localhost:8080';

  // ── Core state ──────────────────────────
  const [phase, setPhase] = useState<Phase>('idle');
  const [currentActivity, setCurrentActivity] = useState<string | null>(null);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, Message[]>>({});
  const [logs, setLogs] = useState<string[]>(['[$] session-bridge connected']);
  const [inputValue, setInputValue] = useState('');
  // ── No virtual window — render all messages ──
  const [loginInput, setLoginInput] = useState("");
  const [terminalTab, setTerminalTab] = useState<'log' | 'raw'>('log');
  const [showCommands, setShowCommands] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [viewingFile, setViewingFile] = useState<{path: string; content: string} | null>(null);
  // ── Background task tracking ──────────────
  const [activeTasks, setActiveTasks] = useState<Map<string, TaskInfo>>(new Map());
  const [toolActivities, setToolActivities] = useState<Map<string, ToolActivity>>(new Map());
  const [expandedToolOutputs, setExpandedToolOutputs] = useState<Set<string>>(new Set());
  const [taskTimer, setTaskTimer] = useState(0);
  const [queueInfo, setQueueInfo] = useState<{isProcessing: boolean; queueDepth: number; queue: any[]}>({isProcessing: false, queueDepth: 0, queue: []});
  const [ctxMenu, setCtxMenu] = useState<{x:number; y:number; items:ContextMenuItem[]}|null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
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
  // ── Mode / Effort state ──────────────────
  const [permissionMode, setPermissionMode] = useState<string>('default');
  const [effortLevel, setEffortLevel] = useState<string>('low');
  const [showModePicker, setShowModePicker] = useState(false);
  const modePickerRef = useRef<HTMLDivElement>(null);
  // Fetch current mode on mount
  useEffect(() => {
    fetch('/api/mode').then(r => r.json()).then(data => {
      if (data.mode) setPermissionMode(data.mode);
      if (data.effort) setEffortLevel(data.effort);
    }).catch(() => {});
  }, []);
  // ── Project / Session state ──────────────
  const [projectInfo, setProjectInfo] = useState<{cwd: string; projectName: string} | null>(null);
  const [savedSessions, setSavedSessions] = useState<{id: string; label: string; dir: string; ts: string}[]>([]);
  const [showDirSwitcher, setShowDirSwitcher] = useState(false);
  const [switchDirLocal, setSwitchDirLocal] = useState('');
  const [switching, setSwitching] = useState(false);
  const [snapshots, setSnapshots] = useState<{id: string; name: string; msgs: Message[]; ts: string}[]>([]);
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

  // ── Session persistence (IndexedDB) ──────────
  const [isRestoring, setIsRestoring] = useState(true);

  // Restore messages from IndexedDB on mount (complete path)
  useEffect(() => {
    const activeId = sessionStore.getActiveSessionId();
    if (activeId) {
      sessionStore.loadMessages(activeId).then(msgs => {
        if (msgs.length > 0) {
          setMessagesBySession(prev => ({ ...prev, [activeId]: toAppMessages(activeId, msgs) }));
        }
        setIsRestoring(false);
      }).catch(() => setIsRestoring(false));
    } else {
      setIsRestoring(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist messages to IndexedDB (debounced) + localStorage fast path
  const idbDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isRestoring) return;
    if (idbDebounceRef.current) clearTimeout(idbDebounceRef.current);
    idbDebounceRef.current = setTimeout(() => {
      // Fast path: full-map localStorage cache
      try {
        localStorage.setItem('sb-messages', JSON.stringify(messagesBySession));
      } catch {}
      // Complete path: per-session IndexedDB writes
      for (const [sid, msgs] of Object.entries(messagesBySession)) {
        if (msgs.length > 0) {
          sessionStore.replaceMessages(sid, toStorageMessages(msgs)).catch(() => {});
        }
      }
    }, 500);
    return () => { if (idbDebounceRef.current) clearTimeout(idbDebounceRef.current); };
  }, [messagesBySession, isRestoring]);

  // ── History loading (state+ref declarations only) ──
  const historyLoadedRef = useRef(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Persist messages to localStorage ─────
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      try {
        const msgs = messagesBySession;
        const hasContent = Object.values(msgs).some(arr => arr.length > 0);
        if (hasContent) {
          localStorage.setItem('sessionbridge-messages', JSON.stringify(msgs));
        }
      } catch {}
    }, 2000);
    return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); };
  }, [messagesBySession]);

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

  // ── @ autocomplete state ────────────────
  const [showFileSuggest, setShowFileSuggest] = useState(false);
  const [fileSuggestions, setFileSuggestions] = useState<any[]>([]);
  const [atPos, setAtPos] = useState(0);
  const actionEndRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const processedRef = useRef(0);
  /** Blocks whose ts is before this value are from a stale flushBuffer replay — skip them. */
  const historyCutoffRef = useRef(0);
  const submittingRef = useRef(false);
  const cmdPanelRef = useRef<HTMLDivElement>(null);
  const messagesCacheRef = useRef<Record<string, Message[]>>({});
  const messagesRef = useRef<Message[]>([]);

  const { connStatus, parsed, msgLog, sendInput, sendCommand, serverBlocks, sessions, activeSessionId, activateSession, spawnSession, isWorkspace, queueStatus, instances, activeInstanceId, activateInstance, createInstance, killInstance } = useSession(wsUrl, token ?? undefined);
  const activeAdapterId = instances.find(i => i.id === activeInstanceId)?.adapterId || 'shell';
  const viewId = adapterToViewId[activeAdapterId] || 'terminal';

  const { notify } = useNotification();

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

  const addLog = useCallback((msg: string) => setLogs(prev => [...prev, msg]), []);

  // ── History loading ──────────────────────
  useEffect(() => {
    if (historyLoadedRef.current) return;
    if (!projectInfo?.cwd) return;
    const key = projectInfo.cwd.replace(/[/\\:]/g, '_');
    // Check if localStorage has data for this project
    try {
      const saved = localStorage.getItem('sessionbridge-messages');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed[key]?.length > 0) {
          setMessagesBySession(parsed);
          historyCutoffRef.current = Date.now();
          processedRef.current = serverBlocks.length;
          historyLoadedRef.current = true;
          addLog(`[System] Restored ${parsed[key].length} messages from localStorage`);
          // Restore active external session indicator
          try {
            const activeSaved = localStorage.getItem('sessionbridge-active-session');
            if (activeSaved) {
              const { display } = JSON.parse(activeSaved);
              setActiveExternalSession(display);
            }
          } catch {}
          return;
        }
      }
    } catch {}
    // No localStorage → load from Claude Code history API
    setHistoryLoading(true);
    const controller = new AbortController();
    fetch('/api/sessions/current', { signal: controller.signal })
      .then(r => r.json()).then(data => {
        if (data.messages?.length) {
          const loadedMsgs: Message[] = data.messages.map((m: any) => ({
            id: genId(),
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.text || '',
            timestamp: m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : getTime(),
            blocks: parseSessionBlocks(m.blocks || []),
            isPending: false,
            isCompactSummary: m.isCompactSummary === true,
          }));
          setMessagesBySession(prev => {
            if (prev[key]?.length > loadedMsgs.length) return prev;
            return { ...prev, [key]: loadedMsgs };
          });
          historyCutoffRef.current = Date.now();
          processedRef.current = serverBlocks.length;
          historyLoadedRef.current = true;
          addLog(`[System] Loaded ${loadedMsgs.length} messages from Claude Code history`);
        } else {
          addLog('[System] No Claude Code history found for this project');
        }
      }).catch((err) => {
        addLog(`[Error] History fetch failed: ${err?.message || err}`);
        console.error('[History] fetch error:', err);
      })
      .finally(() => setHistoryLoading(false));
    return () => controller.abort();
  }, [projectInfo?.cwd, addLog]);

  // ── Session-aware message helpers ────────
  // Use instance ID (multi-instance mode) or project directory (legacy) as key
  const sessionKey = isWorkspace
    ? (activeSessionId || 'default')
    : activeInstanceId
      ? activeInstanceId
      : (projectInfo?.cwd ? projectInfo.cwd.replace(/[/\\:]/g, '_') : 'default');
  const messages = messagesBySession[sessionKey] || [];

  const updateSession = useCallback((session: string, updater: (prev: Message[]) => Message[]) => {
    setMessagesBySession(prev => {
      const current = prev[session] || [];
      const updated = updater(current);
      if (!messagesCacheRef.current[session]) messagesCacheRef.current[session] = [];
      messagesCacheRef.current[session] = updated;
      return { ...prev, [session]: updated };
    });
  }, []);

  /** When a historical session is loaded, track its ID so we can show it in the UI */
  const [activeExternalSession, setActiveExternalSession] = useState<string | null>(null);

  const handleNewSession = useCallback(() => {
    const sk = sessionKey;
    updateSession(sk, () => []);
    // Clear persisted data for this session
    sessionStore.clearMessages(sk).catch(() => {});
    try {
      const cached = JSON.parse(localStorage.getItem('sb-messages') || '{}');
      delete cached[sk];
      localStorage.setItem('sb-messages', JSON.stringify(cached));
    } catch {}
    setPhase('idle');
    setCurrentActivity(null);
    setActiveExternalSession(null);
    try { localStorage.removeItem('sessionbridge-active-session'); } catch {}
    processedRef.current = 0;
    sendCommand('clear');
    addLog('[System] Session cleared — started fresh');
  }, [updateSession, sendCommand, addLog, sessionKey]);

  const handleQuickCompact = useCallback(() => {
    sendInput('/compact', activeSessionId || undefined);
    addLog('[System] Sending /compact command');
  }, [sendInput, addLog, activeSessionId]);

  const handleInterrupt = useCallback(() => {
    sendCommand('interrupt');
    addLog('[System] ⏹ Interrupting Claude...');
    setPhase('idle');
    setCurrentActivity('Interrupted');
  }, [sendCommand, addLog]);

  const handleSetMode = useCallback((mode: string) => {
    if (!['default', 'acceptEdits', 'plan'].includes(mode)) return;
    setPermissionMode(mode);
    sendCommand('setMode', { mode });
    addLog(`[System] Permission mode: ${mode}`);
    setShowModePicker(false);
  }, [sendCommand, addLog]);

  const handleSetEffort = useCallback((level: string) => {
    if (!['low', 'medium', 'high'].includes(level)) return;
    setEffortLevel(level);
    sendCommand('setEffort', { level });
    addLog(`[System] Thinking effort: ${level}`);
    setShowModePicker(false);
  }, [sendCommand, addLog]);

  // ── Switch project directory ─────────────
  const handleSwitchDir = useCallback(async (dir: string) => {
    // Persist current session messages before switching directory
    const prevKey = projectInfo?.cwd ? projectInfo.cwd.replace(/[/\\:]/g, '_') : 'default';
    const prevMsgs = messagesRef.current;
    if (prevMsgs?.length > 0) {
      sessionStore.replaceMessages(prevKey, toStorageMessages(prevMsgs)).catch(() => {});
      try {
        const cached = JSON.parse(localStorage.getItem('sb-messages') || '{}');
        cached[prevKey] = prevMsgs;
        localStorage.setItem('sb-messages', JSON.stringify(cached));
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

  // Close mode picker on outside click
  useEffect(() => {
    if (!showModePicker) return;
    const handler = (e: MouseEvent) => {
      if (modePickerRef.current && !modePickerRef.current.contains(e.target as Node)) {
        setShowModePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showModePicker]);

  // ── Session snapshots (fork) ──────────────
  const saveSnapshot = useCallback((name?: string) => {
    const currentMsgs = messagesBySession[sessionKey] || [];
    if (currentMsgs.length === 0) return;
    const label = name || `Snapshot ${snapshots.length + 1}`;
    setSnapshots(prev => [...prev, {
      id: Date.now().toString(36),
      name: label,
      msgs: JSON.parse(JSON.stringify(currentMsgs)),
      ts: new Date().toISOString().slice(0, 19),
    }]);
    addLog(`[System] Snapshot saved: ${label}`);
  }, [messagesBySession, sessionKey, snapshots.length, addLog]);

  const loadSnapshot = useCallback((snapshotId: string) => {
    const snap = snapshots.find(s => s.id === snapshotId);
    if (!snap) return;
    updateSession(sessionKey, () => JSON.parse(JSON.stringify(snap.msgs)));
    processedRef.current = 0; // Re-process blocks from server (won't replay, but resets counter)
    setPhase('idle');
    setCurrentActivity(null);
    addLog(`[System] Snapshot loaded: ${snap.name}`);
  }, [snapshots, sessionKey, updateSession, addLog]);

  const forkFromSnapshot = useCallback((snapshotId: string) => {
    const snap = snapshots.find(s => s.id === snapshotId);
    if (!snap) return;
    // Save current session first
    saveSnapshot('Auto-save before fork');
    // Load the snapshot
    loadSnapshot(snapshotId);
    addLog(`[System] Forked from snapshot: ${snap.name}`);
    sendCommand('clear');
  }, [snapshots, saveSnapshot, loadSnapshot, addLog, sendCommand]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    actionEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages]);
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs, msgLog]);

  // Reset submitting guard when phase leaves 'running'
  useEffect(() => {
    if (phase !== 'running') submittingRef.current = false;
  }, [phase]);

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

  // ── Derived: known files for explorer ──
  const knownFiles = useMemo(() => {
    const files = new Map<string, string>();
    const msgs = messagesBySession[sessionKey] || [];
    for (const msg of msgs) {
      for (const b of msg.blocks) {
        if (b.detail && (b.toolName === 'Read' || b.toolName === 'Edit' || b.toolName === 'Write')) {
          const parts = b.detail.replace(/\\/g, '/').split('/');
          parts.forEach((_, i) => {
            const p = parts.slice(0, i + 1).join('/');
            if (i === parts.length - 1) files.set(p, 'file');
            else files.set(p, 'dir');
          });
        }
      }
    }
    return files;
  }, [messagesBySession, sessionKey]);

  // ── Submit ─────────────────────────────
  const handleSubmit = useCallback((overrideCmd?: string) => {
    const cmd = (overrideCmd || inputValue).trim();
    if (!cmd || phase === 'running' || submittingRef.current) return;
    submittingRef.current = true;
    if (connStatus.status !== 'connected') {
      addLog('[System] Cannot send — not connected to relay');
      submittingRef.current = false;
      return;
    }
    setInputValue('');

    // Intercept /rewind commands — send as WS command, not user message
    if (cmd === '/rewind') {
      setCurrentActivity('Rewinding last change...');
      sendCommand('rewind');
      submittingRef.current = false;
      return;
    }
    if (cmd === '/rewind-all') {
      setCurrentActivity('Rewinding all changes...');
      sendCommand('rewind-all');
      submittingRef.current = false;
      return;
    }

    setPhase('running');
    setCurrentActivity('Processing...');
    sendInput(cmd, activeSessionId || undefined);
  }, [inputValue, phase, sendInput, sendCommand, activeSessionId]);

  // Detect @ for file autocomplete
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    const atIdx = val.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || val[atIdx - 1] === ' ')) {
      const query = val.slice(atIdx + 1).toLowerCase();
      setAtPos(atIdx);
      const root = fileTree['.']?.items || [];
      const flat: any[] = [];
      const walk = (items: any[]) => {
        for (const item of items) {
          if (item.name.toLowerCase().includes(query)) flat.push(item);
          const children = fileTree[item.path || item.name];
          if (children?.loaded) walk(children.items);
        }
      };
      walk(root);
      setFileSuggestions(flat.slice(0, 20));
      setShowFileSuggest(flat.length > 0);
    } else {
      setShowFileSuggest(false);
    }
  }, [fileTree]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && phase === 'running') {
      e.preventDefault();
      handleInterrupt();
      return;
    }
    if ((e.key === 'Enter' && !e.shiftKey) || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
      if (showFileSuggest && fileSuggestions.length > 0) {
        e.preventDefault();
        const selected = fileSuggestions[0];
        setInputValue(prev => prev.slice(0, atPos) + `@${selected.path || selected.name} `);
        setShowFileSuggest(false);
        return;
      }
      e.preventDefault();
      handleSubmit();
    }
    // Arrow up/down for command history
    if (e.key === 'ArrowUp' && !e.shiftKey && !showFileSuggest) {
      e.preventDefault();
    }
    if (e.key === 'Escape') setShowFileSuggest(false);
  }, [handleSubmit, showFileSuggest, fileSuggestions, atPos, phase, handleInterrupt]);

  const handleFileSuggestionClick = useCallback((item: any) => {
    setInputValue(prev => prev.slice(0, atPos) + `@${item.path || item.name} `);
    setShowFileSuggest(false);
  }, [atPos]);

  // ── Global keyboard shortcuts ────────────────
  useEffect(() => {
    messagesRef.current = messages;
    const handleGlobalKey = (e: KeyboardEvent) => {
      // Ctrl+L: clear main output area
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        setMessagesBySession({});
        localStorage.removeItem('sessionbridge-messages');
        setLogs(['[$] session-bridge connected']);
        return;
      }
      // Ctrl+Shift+C: copy last assistant message
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'c') {
        e.preventDefault();
        const msgs = messagesRef.current;
        const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant');
        if (lastAssistant?.content) {
          navigator.clipboard.writeText(lastAssistant.content).catch(() => {});
        }
        return;
      }
      // Ctrl+R: restart session (only if not focused in input)
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        sendCommand('clear');
        return;
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [messages, sendCommand, setMessagesBySession, setLogs]);
  const handleQuickAction = useCallback((cmd: string) => {
    setInputValue(cmd);
  }, []);

  // ── Context menu handler ───────────────
  const handleCtx = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const items: ContextMenuItem[] = viewId === 'terminal' ? [
      { label: 'New Terminal', shortcut: '⌘T', action: () => createInstance(projectInfo?.cwd || '.', undefined, 'shell') },
      { label: 'Kill Instance', shortcut: '⌘W', action: () => activeInstanceId && killInstance(activeInstanceId), danger: true },
      { label: '', divider: true, action: () => {} },
      { label: 'Clear Terminal', action: () => { /* noop in this view */ } },
    ] : [
      { label: 'New Claude Instance', shortcut: '⌘T', action: () => createInstance(projectInfo?.cwd || '.', undefined, 'claude-code') },
      { label: 'Kill Instance', shortcut: '⌘W', action: () => activeInstanceId && killInstance(activeInstanceId), danger: true },
      { label: '', divider: true, action: () => {} },
      { label: 'Clear History', action: () => { /* handled in InputForm */ } },
      { label: 'Toggle Terminal', shortcut: '⌘`', action: () => setShowTerminal(v => !v) },
      { label: '', divider: true, action: () => {} },
      { label: 'Copy All', shortcut: '⌘⇧C', action: () => {
        const text = messages.map(m => `[${m.role}] ${m.content}`).join('\n');
        navigator.clipboard.writeText(text);
      }},
    ];
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [viewId, activeInstanceId, projectInfo, messages, createInstance, killInstance, setShowTerminal]);

  const handleCommandClick = useCallback((cmd: string) => {
    setInputValue(cmd + ' ');
    setShowCommands(false);
    // Focus the input after selecting a command
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.msg-input');
      input?.focus();
    }, 50);
  }, []);

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
    : 'bg-red-500';
  const statusText = connStatus.status === 'connected' ? 'CONNECTED'
    : connStatus.status === 'connecting' ? 'CONNECTING'
    : 'DISCONNECTED';

  // Phase indicator
  const phaseColor = phase === 'idle' ? 'text-gray-500'
    : phase === 'running' ? 'text-purple-400'
    : phase === 'done' ? 'text-emerald-400'
    : 'text-red-400';
  const phaseLabel = phase === 'idle' ? 'Idle'
    : phase === 'running' ? 'Running'
    : phase === 'done' ? 'Completed'
    : 'Error';

  // ==========================================
  // Render
  // ==========================================
  if (!token) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0a0a] text-gray-300 font-mono">
        <div className="w-full max-w-sm p-8 bg-[#111] border border-gray-800 rounded-lg">
          <h1 className="text-lg font-bold mb-2">SessionBridge</h1>
          <p className="text-xs text-gray-500 mb-6">Enter your access token to connect.</p>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (loginInput.trim()) {
              window.location.href = `?token=${encodeURIComponent(loginInput.trim())}`;
            }
          }}>
            <input
              type="password"
              value={loginInput}
              onChange={(e) => setLoginInput(e.target.value)}
              placeholder="SB_TOKEN"
              className="w-full bg-[#1a1a1a] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-purple-500 mb-4"
              autoFocus
            />
            <button
              type="submit"
              className="w-full bg-purple-700 hover:bg-purple-600 text-white rounded px-3 py-2 text-sm font-semibold transition-colors"
            >
              Connect
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] text-gray-300 font-mono text-sm overflow-hidden selection:bg-purple-900 selection:text-white relative" onContextMenu={handleCtx}>
      <ConsoleHeader
        onMobileOpen={() => setMobileOpen(true)}
        statusColor={statusColor}
        statusText={statusText}
        connStatus={connStatus}
        phaseColor={phaseColor}
        phaseLabel={phaseLabel}
        phase={phase}
        currentActivity={currentActivity}
        parsed={parsed}
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
      />

      {/* ═══ SEARCH SESSIONS PANEL (overlay) ════ */}
      {showSearch && (
        <div className="absolute inset-0 z-40 flex justify-center pt-12 pointer-events-none" style={{ top: '44px' }}>
          <div ref={searchPanelRef} className="w-full max-w-lg bg-[#151515] border border-gray-700 rounded-lg shadow-2xl shadow-black/60 overflow-hidden pointer-events-auto max-h-[70vh] flex flex-col">
            {/* Search input */}
            <div className="flex items-center gap-2 p-3 border-b border-gray-800">
              <Search className="w-4 h-4 text-gray-500 shrink-0" />
              <input ref={searchInputRef} type="text" value={searchQuery} onChange={handleSearchInput}
                placeholder="Search Claude Code sessions..."
                className="flex-1 bg-transparent outline-none text-gray-200 text-sm placeholder-gray-600"
              />
              {searchLoading && (
                <div className="w-4 h-4 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
              )}
              <button onClick={() => setShowSearch(false)} className="text-gray-600 hover:text-gray-400 text-lg leading-none">&times;</button>
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto">
              {searchLoading && (
                <div className="p-6 text-center text-gray-600 text-xs">Loading sessions...</div>
              )}
              {!searchLoading && searchResults.length === 0 && !searchQuery.trim() && (
                <div className="p-6 text-center text-gray-600 text-xs">
                  No recent sessions found
                </div>
              )}
              {!searchLoading && searchResults.length === 0 && searchQuery.trim() && (
                <div className="p-6 text-center text-gray-600 text-xs">No matching sessions found</div>
              )}

              {/* Group by project */}
              {searchResults.length > 0 && <SearchResultsPanel results={searchResults} onClose={setShowSearch} onLog={addLog} onLoadSession={handleLoadSession} />}
            </div>

            <div className="p-2 border-t border-gray-800 text-[8px] text-gray-700 text-center">
              Searches {searchResults.length > 0 ? `${searchResults.length} sessions` : 'Claude Code history'}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
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
          instances={instances}
          activeInstanceId={activeInstanceId}
          onActivateInstance={activateInstance}
          onCreateInstance={createInstance}
          onKillInstance={killInstance}
          activeViewId={viewId}
          onQuickAction={handleQuickAction}
          onRewind={() => { sendCommand('rewind'); addLog('[System] Rewinding last change...'); }}
          projectCwd={projectInfo?.cwd || '.'}
        />

        {/* ═══ CENTER: Message Stream ════════ */}
        <main className="flex-1 flex flex-col relative bg-black min-w-0">
          <div className="px-2 py-1.5 border-b border-gray-800 text-[10px] font-bold text-gray-500 flex justify-between items-center bg-[#0a0a0a] shrink-0 tracking-wider">
            <InstanceTabBar
              instances={instances}
              activeInstanceId={activeInstanceId}
              onActivate={activateInstance}
              onCreate={(dir, adapterId) => createInstance(dir, undefined, adapterId)}
              showTerminal={showTerminal}
              onToggleTerminal={() => setShowTerminal(v => !v)}
              projectCwd={projectInfo?.cwd || '.'}
            />
            <span className="flex items-center gap-2">
              MESSAGE STREAM
              {activeExternalSession && (
                <span className="text-amber-500 text-[8px] bg-amber-900/20 px-1.5 py-0.5 rounded border border-amber-700/30">
                  VIEWING: {activeExternalSession}
                  <button onClick={() => {
                    setActiveExternalSession(null);
                    try { localStorage.removeItem('sessionbridge-active-session'); } catch {}
                    // Reload the current session from API
                    historyLoadedRef.current = false;
                    window.location.reload();
                  }} className="ml-1.5 px-1 bg-amber-800/40 hover:bg-amber-700/60 rounded text-[7px] text-amber-300">✕</button>
                </span>
              )}
              <span className="text-gray-700 text-[8px] font-mono">
                msg:{messages.length} u:{messages.filter(m => m.role === 'user').length} a:{messages.filter(m => m.role === 'assistant').length}
                <button onClick={() => { console.log('=== MSG DUMP ===', JSON.parse(JSON.stringify(messagesBySession))); console.log('sessionKey:', sessionKey); console.log('roles:', messages.map(m => m.role).join(',')); alert(`msg:${messages.length} u:${messages.filter(m => m.role === 'user').length} a:${messages.filter(m => m.role === 'assistant').length} roles:${messages.slice(0,10).map(m=>m.role).join(',')}...`) }}
                  className="ml-2 px-1 bg-gray-800 hover:bg-gray-700 rounded text-[7px]" title="Dump messages to console">🐛</button>
              </span>
              {phase === 'running' && (
                <span className="text-purple-500 animate-pulse">● PROCESSING</span>
              )}
            </span>
            <span className="flex items-center gap-3">
              {phase === 'running' && (
                <button onClick={handleInterrupt}
                  className="text-red-400 hover:text-red-300 flex items-center gap-1 text-[9px] bg-red-900/20 px-1.5 py-0.5 rounded border border-red-800/30 transition-colors"
                  title="Stop (Esc)"
                >
                  <Square className="w-2.5 h-2.5 fill-current" /> STOP
                </button>
              )}
              {queueInfo.queueDepth > 0 && (
                <span className="text-yellow-600 text-[9px]">+{queueInfo.queueDepth} queued</span>
              )}
            </span>
          </div>

          {/* Shell instances — all kept mounted, inactive hidden */}
          {instances.filter((i: any) => (i.adapterId || 'shell') === 'shell').map((inst: any) => (
            <div key={inst.id} className={inst.id === activeInstanceId ? "flex-1" : "hidden"}>
              <TerminalView wsUrl={wsUrl} instanceId={inst.id} token={token ?? undefined} />
            </div>
          ))}
          {instances.filter((i: any) => (i.adapterId || 'shell') === 'shell').length === 0 && (
            <div className={viewId === 'terminal' ? "flex-1" : "hidden"}>
              <TerminalView wsUrl={wsUrl} token={token ?? undefined} />
            </div>
          )}

          {/* Claude instance: chat view */}
          <div className={viewId === 'claude-chat' ? "flex-1 flex flex-col" : "hidden"}>
            <ClaudeChatView
              messages={messages}
              turns={turns}
              phase={phase}
              setPhase={setPhase}
              currentActivity={currentActivity}
              setCurrentActivity={setCurrentActivity}
              connStatus={connStatus}
              isRestoring={isRestoring}
              historyLoading={historyLoading}
              inputValue={inputValue}
              setInputValue={setInputValue}
              handleSubmit={handleSubmit}
              handleInputChange={handleInputChange}
              handleKeyDown={handleKeyDown}
              toolActivities={toolActivities}
              setToolActivities={setToolActivities}
              expandedToolOutputs={expandedToolOutputs}
              setExpandedToolOutputs={setExpandedToolOutputs}
              showFileSuggest={showFileSuggest}
              fileSuggestions={fileSuggestions}
              handleFileSuggestionClick={handleFileSuggestionClick}
              showCommands={showCommands}
              setShowCommands={setShowCommands}
              handleCommandClick={handleCommandClick}
              cmdPanelRef={cmdPanelRef}
              handleInterrupt={handleInterrupt}
              setForkTarget={setForkTarget}
              setForkPrompt={setForkPrompt}
              activeExternalSession={activeExternalSession}
              clearExternalSession={() => {
                setActiveExternalSession(null);
                try { localStorage.removeItem('sessionbridge-active-session'); } catch {}
                historyLoadedRef.current = false;
                window.location.reload();
              }}
              scrollContainerRef={scrollContainerRef}
              actionEndRef={actionEndRef}
            />
          </div>
          {/* ── Terminal drawer ── */}
          {showTerminal && (
            <div className="border-t border-gray-700 shrink-0" style={{ height: '180px' }}>
              <TerminalView wsUrl={wsUrl} token={token ?? undefined} />
            </div>
          )}
        </main>

        <RightSidebar
          isClaude={viewId === 'claude-chat'}
          activeTasks={activeTasks}
          queueInfo={queueInfo}
          onNewSession={handleNewSession}
          onQuickCompact={handleQuickCompact}
          onSaveSnapshot={() => saveSnapshot()}
          snapshots={snapshots}
          onLoadSnapshot={loadSnapshot}
          onForkSnapshot={forkFromSnapshot}
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
      </div>
      {/* File viewer modal */}
      {viewingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setViewingFile(null)}>
          <div className="bg-[#111] border border-gray-700 rounded-lg w-3/4 max-w-3xl max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-gray-800">
              <div className="flex items-center gap-2 text-xs text-gray-300">
                <FileCode className="w-4 h-4 text-blue-400" />
                <code className="font-mono">{viewingFile.path}</code>
              </div>
              <button onClick={() => setViewingFile(null)} className="text-gray-500 hover:text-gray-300 text-lg leading-none">&times;</button>
            </div>
            <pre className="flex-1 overflow-y-auto p-4 text-xs text-gray-300 font-mono leading-relaxed whitespace-pre-wrap bg-[#0a0a0a]">
              {viewingFile.content}
            </pre>
          </div>
        </div>
      )}

      {/* ═══ FORK / REWIND DIALOG ════════════ */}
      {forkTarget !== null && turns[forkTarget] && (
        <ForkDialog
          forkTarget={forkTarget}
          turn={turns[forkTarget]}
          forkPrompt={forkPrompt}
          setForkPrompt={setForkPrompt}
          onClose={() => setForkTarget(null)}
          onRewind={(targetIdx) => {
            const allMsgs = messagesBySession[sessionKey] || [];
            const turnMsgs: Message[] = [turns[targetIdx].userMsg, ...turns[targetIdx].assistantMsgs];
            const cutoffIdx = allMsgs.indexOf(turnMsgs[turnMsgs.length - 1]) + 1;
            updateSession(sessionKey, () => allMsgs.slice(0, cutoffIdx));
            processedRef.current = 0;
            setPhase('idle');
            setCurrentActivity(null);
            addLog(`[System] Rewound to turn ${targetIdx + 1}`);
            setForkTarget(null);
          }}
          onForkSnapshot={(targetIdx) => {
            saveSnapshot(`Fork from turn ${targetIdx + 1}`);
            const targetText = turns[targetIdx].userMsg.content;
            addLog(`[System] Forked from turn ${targetIdx + 1}: "${targetText.slice(0, 60)}..."`);
            setForkTarget(null);
          }}
          onForkWithPrompt={(targetIdx, prompt) => {
            saveSnapshot(`Fork from turn ${targetIdx + 1}`);
            const targetText = turns[targetIdx].userMsg.content;
            addLog(`[System] Forked from turn ${targetIdx + 1}: "${targetText.slice(0, 60)}..." → "${prompt.slice(0, 60)}"`);
            setInputValue(prompt);
            setForkTarget(null);
            setTimeout(() => {
              const input = document.querySelector<HTMLInputElement>('.msg-input');
              input?.focus();
            }, 100);
          }}
        />
      )}

      <StatusBar
        permissionMode={permissionMode}
        effortLevel={effortLevel}
        showModePicker={showModePicker}
        onToggleModePicker={() => setShowModePicker(v => !v)}
        onSetMode={handleSetMode}
        onSetEffort={handleSetEffort}
        queueStatus={queueStatus}
        modePickerRef={modePickerRef}
      />

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

      {/* Context menu (right-click) */}
      {ctxMenu && (
        <ContextMenu items={ctxMenu.items} x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} />
      )}

      {/* Mobile sidebar overlay */}
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
        instances={instances}
        activeInstanceId={activeInstanceId}
        onActivate={activateInstance}
        onCreate={() => createInstance(projectInfo?.cwd || '.')}
        onKill={killInstance}
        onQuickAction={handleQuickAction}
      />
    </div>
  );
}

