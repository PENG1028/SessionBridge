'use client';

import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import { useSession } from '../lib/use-ws';
import {
  Terminal, Folder, FileCode, Eye, Search, Play,
  Square, GitBranch, Cpu, CheckCircle2, XCircle, ChevronRight,
  Globe, User, Sparkles, Ban, AlertCircle, ChevronDown, ChevronUp, Clock, History,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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

// Grouped blocks for display (consecutive same-tool folding)
interface BlockGroup {
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'unknown' | 'group';
  semantic: string;
  toolName: string;
  items: Block[];
  count: number;
  status: 'running' | 'done' | 'error';
}

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

// ==========================================
// Constants — Semantic Layer
// ==========================================
const TOOL_SEMANTICS: Record<string, { label: string; icon: string; phase: string }> = {
  Read:        { label: 'Reading file',       icon: 'Eye',     phase: 'scan' },
  Glob:        { label: 'Scanning files',      icon: 'Search',  phase: 'scan' },
  Grep:        { label: 'Searching code',      icon: 'Search',  phase: 'search' },
  Bash:        { label: 'Running command',     icon: 'Terminal',phase: 'exec' },
  PowerShell:  { label: 'Running command',     icon: 'Terminal',phase: 'exec' },
  Edit:        { label: 'Editing code',        icon: 'FileCode',phase: 'edit' },
  Write:       { label: 'Writing file',        icon: 'FileCode',phase: 'edit' },
  WebSearch:   { label: 'Searching web',       icon: 'Globe',   phase: 'search' },
  WebFetch:    { label: 'Fetching URL',        icon: 'Globe',   phase: 'search' },
};

const UNKNOWN_TOOL = { label: 'Unknown Activity', icon: 'AlertCircle', phase: 'unknown' };

// ==========================================
// Helpers
// ==========================================
const getTime = () => {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
};

const genId = () => Math.random().toString(36).substring(2, 11);

/** Extract detail string from tool args */
function inferDetail(toolName: string, args: string): string {
  if (!args) return '';
  try {
    const p = JSON.parse(args);
    if (toolName === 'Read' || toolName === 'Glob' || toolName === 'Grep')
      return p.file_path || p.pattern || p.path || args;
    if (toolName === 'Bash' || toolName === 'PowerShell')
      return p.command || args;
    if (toolName === 'Edit' || toolName === 'Write')
      return p.file_path || args;
    if (toolName === 'WebSearch')
      return p.query || args;
    return args;
  } catch {
    return args.length > 120 ? args.slice(0, 120) + '...' : args;
  }
}

/** Show last 2 path segments for compact display */
function shortenPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 2) return p;
  return '...' + parts.slice(-2).join('/');
}
function getSemantic(name: string): { label: string; icon: string; phase: string } {
  return TOOL_SEMANTICS[name] || UNKNOWN_TOOL;
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
  const [terminalTab, setTerminalTab] = useState<'log' | 'raw'>('log');
  const [showCommands, setShowCommands] = useState(false);
  const [totalTokens, setTotalTokens] = useState<{input?: number; output?: number; [k:string]: any}>({});
  const [totalCost, setTotalCost] = useState<string>('');
  const [viewingFile, setViewingFile] = useState<{path: string; content: string} | null>(null);
  // ── Background task tracking ──────────────
  const [activeTasks, setActiveTasks] = useState<Map<string, TaskInfo>>(new Map());
  const [toolActivities, setToolActivities] = useState<Map<string, ToolActivity>>(new Map());
  const [expandedToolOutputs, setExpandedToolOutputs] = useState<Set<string>>(new Set());
  const [taskTimer, setTaskTimer] = useState(0);
  const [queueInfo, setQueueInfo] = useState<{isProcessing: boolean; queueDepth: number; queue: any[]}>({isProcessing: false, queueDepth: 0, queue: []});
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
          setMessagesBySession(prev => ({ ...prev, [activeId]: msgs }));
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
          sessionStore.replaceMessages(sid, msgs).catch(() => {});
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

  const { connStatus, parsed, msgLog, sendInput, sendCommand, serverBlocks, sessions, activeSessionId, activateSession, spawnSession, isWorkspace, queueStatus } = useSession(wsUrl, token ?? undefined);

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
  // Use project directory as message bucket key so each project has its own history
  const sessionKey = isWorkspace
    ? (activeSessionId || 'default')
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

  const [selectedModel, setSelectedModel] = useState<string>('default');
  const handleModelChange = useCallback((model: string) => {
    setSelectedModel(model);
    const modelArg = model === 'default' ? undefined : model;
    sendCommand('restart', { model: modelArg || '' });
    addLog(`[System] Switching model to ${model === 'default' ? 'default' : model}...`);
  }, [sendCommand, addLog]);

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
    setTotalTokens({});
    setTotalCost('');
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

  const handleQuickInit = useCallback(() => {
    sendInput('/init', activeSessionId || undefined);
    addLog('[System] Sending /init command');
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
      sessionStore.replaceMessages(prevKey, prevMsgs).catch(() => {});
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
      setTotalTokens({}); setTotalCost('');
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

  // ── Search Sessions state ─────────────────
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchPanelRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) { setSearchResults([]); return; }
    setSearchLoading(true);
    try {
      const res = await fetch(`/api/sessions/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch (err) {
      console.error('[Search] Fetch error:', err);
      setSearchResults([]);
    }
    setSearchLoading(false);
  }, []);

  const handleSearchInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (val.trim()) {
      searchTimerRef.current = setTimeout(() => doSearch(val), 300);
    } else {
      setSearchResults([]);
    }
  }, [doSearch]);

  const openSearchPanel = useCallback(() => {
    setShowSearch(true);
    setSearchQuery('');
    setSearchResults([]);
    // Load recent sessions immediately
    setSearchLoading(true);
    fetch('/api/sessions/search?q=')
      .then(r => r.json())
      .then(data => setSearchResults(data.results || []))
      .catch(() => setSearchResults([]))
      .finally(() => setSearchLoading(false));
    setTimeout(() => searchInputRef.current?.focus(), 100);
  }, []);

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
  useEffect(() => {
    try {
      if (serverBlocks.length <= processedRef.current) return;
      const newBlocks = serverBlocks.slice(processedRef.current);
      processedRef.current = serverBlocks.length;

    for (const raw of newBlocks) {
      const block = raw as any;
      const bType = block.blockType || '';
      const sk = block.sessionId || sessionKey; // route to current project's bucket

      // ── Skip stale blocks replayed from flushBuffer ──
      if (historyCutoffRef.current > 0 && block.ts && block.ts < historyCutoffRef.current) {
        continue;
      }

      // ── User input ─────────────────────
      if (bType === 'user') {
        console.log('[USER_BLOCK] arrived', { text: block.text?.slice(0, 80), sk, sessionKey, blockSessionId: block.sessionId });
        // Clear tool panel for new turn
        if (sk === sessionKey) setToolActivities(new Map());
        updateSession(sk, prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant' && last.isPending) {
            updated[updated.length - 1] = { ...last, isPending: false };
          }
          return updated;
        });
        const userMsg: Message = {
          id: genId(), role: 'user', content: block.text || '',
          timestamp: getTime(), blocks: [], isPending: false,
        };
        updateSession(sk, prev => [...prev, userMsg]);
        if (sk === sessionKey) {
          setPhase('running');
          setCurrentActivity('Processing...');
        }
        addLog(`> ${block.text || ''}`);
        continue;
      }

      // ── Thinking ───────────────────────
      if (bType === 'thinking') {
        const tid = block.id || genId();
        updateSession(sk, prev => {
          const updated = [...prev];
          let asst = ensureAssistant(updated);
          const idx = asst.blocks.findIndex(b => b.id === tid && b.type === 'thinking');
          const isRunning = block.status !== 'done';
          const tb: Block = {
            id: tid, type: 'thinking', semantic: 'Analyzing...',
            toolName: '', detail: '', output: '', toolArgs: '', status: block.status || 'running',
            exitCode: -1, content: block.text || '', expanded: isRunning, rawData: '',
          };
          if (idx >= 0) { tb.expanded = asst.blocks[idx].expanded; asst.blocks[idx] = tb; }
          else asst.blocks.push(tb);
          asst = { ...asst, blocks: [...asst.blocks] };
          updated[updated.length - 1] = asst;
          return updated;
        });
        if (sk === sessionKey && block.status !== 'done') setCurrentActivity('Analyzing...');
        continue;
      }

      // ── Tool Use ───────────────────────
      if (bType === 'tool_use') {
        const toolName = block.name || '';
        const sem = getSemantic(toolName);
        const detail = inferDetail(toolName, block.args || '');
        const blkId = block.id || genId();
        const isRunning = block.status === 'running' || !block.status;

        updateSession(sk, prev => {
          const updated = [...prev];
          let asst = ensureAssistant(updated);
          const idx = blkId ? asst.blocks.findIndex(b => b.id === blkId) : -1;

          const newBlock: Block = {
            id: blkId,
            type: isRunning ? 'tool_use' : 'tool_result',
            semantic: sem.label,
            toolName,
            detail,
            output: block.result || '',
            toolArgs: block.args || '',
            status: block.status || 'running',
            exitCode: block.exitCode ?? (block.result ? 0 : -1),
            content: '',
            expanded: false,
            rawData: '',
          };

          if (idx >= 0) {
            const existing = asst.blocks[idx];
            newBlock.expanded = existing.expanded;
            asst.blocks[idx] = newBlock;
          } else {
            asst.blocks.push(newBlock);
          }
          asst = { ...asst, blocks: [...asst.blocks] };
          updated[updated.length - 1] = asst;
          return updated;
        });

        if (isRunning && sk === sessionKey) {
          setCurrentActivity(sem.label + (detail ? `: ${detail.slice(0, 60)}` : '...'));
          addLog(`[Claude] ${sem.label}: ${detail || toolName}`);
        }
        // Update live tool panel
        if (sk === sessionKey) {
          setToolActivities(prev => {
            const next = new Map(prev);
            next.set(blkId, { id: blkId, toolName, detail, semantic: sem.label, status: block.status || 'running' });
            return next;
          });
        }
        continue;
      }

      // ── Text (assistant response) ──────
      if (bType === 'text') {
        const text = block.text || '';
        // Route system/interrupt notifications to log instead of message blocks
        if (/^(Request interrupted|Tool ran without output|interrupted)/i.test(text)) {
          addLog(`[System] ${text}`);
          continue;
        }
        updateSession(sk, prev => {
          const updated = [...prev];
          let asst = ensureAssistant(updated);
          const lastBlock = asst.blocks[asst.blocks.length - 1];
          if (lastBlock?.type === 'text') {
            lastBlock.content += block.text || '';
            asst = { ...asst, blocks: [...asst.blocks] };
          } else {
            const tb: Block = {
              id: genId(), type: 'text', semantic: '', toolName: '', detail: '',
              output: '', toolArgs: '', status: 'done', exitCode: -1, content: block.text || '',
              expanded: false, rawData: '',
            };
            asst.blocks.push(tb);
            asst = { ...asst, blocks: [...asst.blocks] };
          }
          updated[updated.length - 1] = asst;
          return updated;
        });
        continue;
      }

      // ── Token / Cost ───────────────────
      if (bType === 'token_usage') {
        if (block.tokens) setTotalTokens(block.tokens);
        if (block.cost) setTotalCost(String(block.cost));
        if (block.cost || block.tokens) addLog(`[Tokens] ${JSON.stringify(block.tokens || block.cost)}`);
        continue;
      }

      // ── Done ───────────────────────────
      if (bType === 'done') {
        updateSession(sk, prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, isPending: false };
          }
          return updated;
        });
        if (sk === sessionKey) {
          setPhase('done');
          setCurrentActivity('Completed');
          // Mark all running tools as done
          setToolActivities(prev => {
            const next = new Map(prev);
            for (const [id, act] of next) {
              if (act.status === 'running') next.set(id, { ...act, status: 'done' });
            }
            return next;
          });
        }
        addLog(`[System] ✓ ${block.text || 'Task completed'}`);
        continue;
      }

      // ── Error ──────────────────────────
      if (bType === 'error') {
        updateSession(sk, prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, isPending: false };
          }
          return updated;
        });
        if (sk === sessionKey) {
          setPhase('error');
          setCurrentActivity('Error');
        }
        addLog(`[Error] ${block.text}`);
        continue;
      }

      // ── Status ─────────────────────────
      if (bType === 'status') {
        addLog(`[System] ${block.text || ''}`);
        continue;
      }

      // ── Task Started ─────────────────────
      if (bType === 'task_started') {
        setActiveTasks(prev => new Map(prev).set(block.taskId, {
          id: block.taskId,
          description: block.description || '',
          taskType: block.taskType || '',
          startTime: Date.now(),
        }));
        addLog(`[Task] Started: ${block.description || block.taskId}`);
        continue;
      }

      // ── Task Progress ────────────────────
      if (bType === 'task_progress') {
        setActiveTasks(prev => {
          const task = prev.get(block.taskId);
          if (!task) return prev;
          return new Map(prev).set(block.taskId, {
            ...task,
            lastToolName: block.lastToolName || task.lastToolName,
            summary: block.summary || task.summary,
            usage: block.usage || task.usage,
          });
        });
        continue;
      }

      // ── Task Notification (done) ────────
      if (bType === 'task_notification') {
        setActiveTasks(prev => {
          const next = new Map(prev);
          next.delete(block.taskId);
          return next;
        });
        addLog(`[Task] Completed: ${block.taskId}`);
        continue;
      }

      // ── UNKNOWN ────────────────────────
      addLog(`[Unknown] ${JSON.stringify(block).slice(0, 200)}`);
      updateSession(sk, prev => {
        const updated = [...prev];
        let asst = ensureAssistant(updated);
        const ub: Block = {
          id: genId(), type: 'unknown', semantic: 'Unknown Activity',
          toolName: '', detail: '', output: '', toolArgs: '', status: 'running',
          exitCode: -1, content: 'Unrecognized event', expanded: false,
          rawData: JSON.stringify(block, null, 2),
        };
        asst.blocks.push(ub);
        asst = { ...asst, blocks: [...asst.blocks] };
        updated[updated.length - 1] = asst;
        return updated;
      });
      if (sk === sessionKey) setCurrentActivity('Unknown Activity');
      }
    } catch (err) {
      console.error('[FATAL] Block processing error:', err);
      addLog(`[Error] ${err instanceof Error ? err.message : String(err)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBlocks, sessionKey, updateSession]);

  /** Ensure the last message is an assistant message; create one if needed */
  function ensureAssistant(msgs: Message[]): Message {
    const last = msgs[msgs.length - 1];
    if (!last || last.role !== 'assistant') {
      const asst: Message = {
        id: genId(), role: 'assistant', content: '',
        timestamp: getTime(), blocks: [], isPending: true,
      };
      msgs.push(asst);
      return asst;
    }
    return last;
  }

  // ── Derived: group consecutive same-tool blocks for display ──
  const groupedBlocks = useCallback((blocks: Block[]): BlockGroup[] => {
    const groups: BlockGroup[] = [];
    for (const b of blocks) {
      if (b.type === 'tool_use' || b.type === 'tool_result') {
        const last = groups[groups.length - 1];
        if (last && last.type === 'group' && last.toolName === b.toolName) {
          last.items.push(b);
          last.count++;
        } else {
          const base: BlockGroup = {
            type: 'group', semantic: b.semantic, toolName: b.toolName,
            items: [b], count: 1, status: b.status,
          };
          groups.push(base);
        }
      } else {
        groups.push({ type: b.type, semantic: b.semantic, toolName: b.toolName, items: [b], count: 1, status: b.status });
      }
    }
    return groups;
  }, []);

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

  // ── Context breakdown ────────────────────
  const contextBreakdown = useMemo(() => {
    const convChars = messages.reduce((sum, m) => {
      let chars = m.content.length;
      for (const b of m.blocks) chars += b.content.length + b.output.length + b.detail.length;
      return sum + chars;
    }, 0);
    const fileChars = [...knownFiles.entries()]
      .filter(([,t]) => t === 'file')
      .reduce((sum, [p]) => sum + p.length, 0);
    const convTokens = Math.round(convChars / 4);
    const fileTokens = Math.round(fileChars / 4);
    const sysTokens = 5000;
    const total = convTokens + fileTokens + sysTokens;
    const utilization = totalTokens.input ? Math.round((totalTokens.input / 100000) * 100) : 0;
    return { convTokens, fileTokens, sysTokens, total, utilization };
  }, [messages, knownFiles, totalTokens]);

  // ── Toggle thinking block expand ───────
  const toggleExpand = useCallback((msgId: string, blockId: string) => {
    updateSession(sessionKey, prev => {
      return prev.map(m => {
        if (m.id !== msgId) return m;
        return {
          ...m,
          blocks: m.blocks.map(b => b.id === blockId ? { ...b, expanded: !b.expanded } : b),
        };
      });
    });
  }, [sessionKey, updateSession]);

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

  // ── Slash commands ─────────────────────
  const SLASH_COMMANDS = [
    { cmd: '/cost',    desc: '查看 token 消耗和预估费用', ok: true },
    { cmd: '/compact', desc: '压缩上下文释放 token', ok: true },
    { cmd: '/diff',    desc: '显示当前 Git 更改及 AI 总结', ok: true },
    { cmd: '/status',  desc: '查看会话状态（仅交互模式）', ok: false },
    { cmd: '/clear',   desc: '清空对话历史（仅交互模式）', ok: false },
    { cmd: '/model',   desc: '切换 AI 模型（仅交互模式）', ok: false },
    { cmd: '/rewind',  desc: '撤销最后一次文件修改', ok: true },
    { cmd: '/memory',  desc: '编辑 CLAUDE.md（仅交互模式）', ok: false },
  ];

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
  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] text-gray-300 font-mono text-sm overflow-hidden selection:bg-purple-900 selection:text-white relative">
      {/* ═══ HEADER ══════════════════════════ */}
      <header className="h-11 flex items-center justify-between px-4 border-b border-gray-800 bg-[#111] shrink-0">
        <div className="flex items-center space-x-4">
          <Cpu className="w-4 h-4 text-purple-500" />
          <span className="text-purple-400 font-bold tracking-widest text-sm">SESSIONBRIDGE</span>
          <span className="text-gray-700">|</span>
          <span className="text-xs text-gray-400 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${statusColor} ${connStatus.status === 'connected' ? 'animate-pulse' : ''}`} />
            {statusText}
          </span>
          {/* Phase badge */}
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${phaseColor} ${
            phase === 'idle' ? 'border-gray-700 bg-gray-900/50'
            : phase === 'running' ? 'border-purple-700 bg-purple-900/20 animate-pulse'
            : phase === 'done' ? 'border-emerald-700 bg-emerald-900/20'
            : 'border-red-700 bg-red-900/20'
          }`}>
            {phaseLabel}
          </span>
          {/* Current activity */}
          {currentActivity && phase === 'running' && (
            <span className="text-[10px] text-purple-400 bg-purple-900/10 px-2 py-0.5 rounded-full border border-purple-800/30 truncate max-w-[200px] hidden sm:inline">
              {currentActivity}
            </span>
          )}
          {parsed.model && (
            <span className="text-[10px] text-gray-500 bg-gray-900 px-2 py-0.5 rounded border border-gray-800 hidden md:inline">
              {parsed.model}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-4 text-xs">
          {parsed.cost && <span className="text-gray-400 hidden sm:inline">TOKENS: <span className="text-gray-200">{parsed.cost}</span></span>}
          {/* Project info */}
          <div className="flex items-center gap-2 relative">
            {/* Search sessions button */}
            <button
              onClick={openSearchPanel}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#1a1a1a] border border-gray-700 hover:border-purple-500 text-gray-400 hover:text-gray-200 text-[10px] transition-colors"
              title="Search past sessions"
            >
              <Search className="w-3 h-3" />
            </button>

            <button
              onClick={() => setShowDirSwitcher(v => !v)}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#1a1a1a] border border-gray-700 hover:border-purple-500 text-gray-400 hover:text-gray-200 text-[10px] transition-colors max-w-[200px]"
              title={projectInfo ? `${projectInfo.projectName} — ${projectInfo.cwd}` : 'Select project directory'}
            >
              <Folder className="w-3 h-3 shrink-0 text-yellow-600" />
              <span className="truncate">{projectInfo?.projectName || 'No project'}</span>
              <ChevronDown className="w-2.5 h-2.5 shrink-0" />
            </button>

            {/* Directory switcher dropdown */}
            {showDirSwitcher && (
                <div className="absolute top-full right-0 mt-1 z-50 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-2xl shadow-black/50 overflow-hidden" style={{ minWidth: '280px' }}>
                  <div className="p-2 border-b border-gray-800 text-[10px] text-gray-500 px-3 py-1.5 font-bold tracking-wider">
                    SWITCH PROJECT
                  </div>
                  <div className="p-2">
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      if (switchDirLocal.trim()) handleSwitchDir(switchDirLocal.trim());
                    }} className="flex gap-1">
                      <input type="text" value={switchDirLocal}
                        onChange={e => setSwitchDirLocal(e.target.value)}
                        placeholder="Directory path..."
                        className="flex-1 bg-[#0d0d0d] border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-200 outline-none focus:border-purple-500"
                        autoFocus
                      />
                      <button type="submit" disabled={switching}
                        className="px-2 py-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-50 text-white text-[10px] rounded border border-purple-600">
                        {switching ? '...' : 'Go'}
                      </button>
                    </form>
                  </div>
                  {/* Saved sessions */}
                  {savedSessions.length > 0 && (
                    <div className="border-t border-gray-800">
                      <div className="px-3 py-1 text-[9px] text-gray-600 font-bold">HISTORY</div>
                      {savedSessions.slice(-10).reverse().map(s => (
                        <button key={s.id}
                          onClick={() => {
                            addLog(`[System] Previous session: ${s.label} (${s.dir})`);
                            setShowDirSwitcher(false);
                          }}
                          className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800 text-left transition-colors"
                        >
                          <FileCode className="w-2.5 h-2.5 text-gray-600 shrink-0" />
                          <span className="text-[10px] text-gray-400 truncate">{s.label}</span>
                          <span className="text-[8px] text-gray-700 ml-auto shrink-0">{s.ts.slice(5, 16)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
      </header>

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
              {searchResults.length > 0 && renderSearchResults(searchResults, setShowSearch, addLog, handleLoadSession)}
            </div>

            <div className="p-2 border-t border-gray-800 text-[8px] text-gray-700 text-center">
              Searches {searchResults.length > 0 ? `${searchResults.length} sessions` : 'Claude Code history'}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* ═══ LEFT: File Tree Panel ════════ */}
        <aside className="w-56 border-r border-gray-800 bg-[#0d0d0d] flex flex-col hidden md:flex shrink-0">
          <div className="p-3 border-b border-gray-800 text-[10px] font-bold text-gray-500 flex items-center gap-2 tracking-wider">
            <Folder className="w-3.5 h-3.5" />
            FILES
          </div>

          {/* File tree */}
          <div className="flex-1 overflow-y-auto p-1.5 text-xs min-h-0">
            {!fileTree['.']?.loaded ? (
              <div className="text-gray-600 text-[10px] p-3 italic">Loading files...</div>
            ) : (
              <FileTree
                entries={fileTree['.']?.items || []}
                path="."
                depth={0}
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
              />
            )}
          </div>

          {/* Quick actions */}
          <div className="p-2 border-t border-gray-800 bg-[#151515]">
            <div className="text-[10px] text-gray-500 mb-1.5 font-bold tracking-wider">QUICK ACTIONS</div>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => handleQuickAction('npm test')}
                className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors">
                npm test
              </button>
              <button onClick={() => handleQuickAction('git status')}
                className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors">
                git status
              </button>
              <button onClick={() => handleQuickAction('分析项目结构并优化代码')}
                className="px-1.5 py-1 bg-gray-800 hover:bg-gray-700 hover:text-white text-[9px] rounded border border-gray-700 transition-colors">
                Analyze
              </button>
              <button onClick={() => { sendCommand('rewind'); addLog('[System] Rewinding last change...'); }}
                className="px-1.5 py-1 bg-gray-800 hover:bg-amber-800 hover:text-amber-200 text-[9px] rounded border border-gray-700 transition-colors"
                title="撤销最后一次文件修改">
                ↩ Rewind
              </button>
              <button onClick={() => { sendCommand('rewind-all'); addLog('[System] Rewinding all changes this turn...'); }}
                className="px-1.5 py-1 bg-gray-800 hover:bg-red-800 hover:text-red-200 text-[9px] rounded border border-gray-700 transition-colors"
                title="撤销本轮所有修改">
                ↩↩ Rewind All
              </button>
            </div>
          </div>
        </aside>

        {/* ═══ CENTER: Message Stream ════════ */}
        <main className="flex-1 flex flex-col relative bg-black min-w-0">
          <div className="px-4 py-2.5 border-b border-gray-800 text-[10px] font-bold text-gray-500 flex justify-between items-center bg-[#0a0a0a] shrink-0 tracking-wider">
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

          {/* ── Floating Tool Activity Panel ── */}
          {toolActivities.size > 0 && (
            <div className="absolute top-12 right-4 z-20 w-80 max-h-96 pointer-events-none">
              <div className="bg-[#151515] border border-gray-700 rounded-lg shadow-2xl shadow-black/60 overflow-hidden pointer-events-auto">
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
                  <span className="text-[10px] font-bold text-gray-400 flex items-center gap-2">
                    <Terminal className="w-3 h-3 text-purple-400" />
                    TOOLS
                    <span className="text-gray-600 font-normal">({toolActivities.size})</span>
                  </span>
                  <button onClick={() => setToolActivities(new Map())} className="text-gray-600 hover:text-gray-400 text-xs leading-none">&times;</button>
                </div>
                <div className="max-h-72 overflow-y-auto p-2 space-y-1">
                  {Array.from(toolActivities.values()).map(act => (
                    <div key={act.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs border ${
                      act.status === 'running'
                        ? 'bg-purple-950/[0.06] border-purple-700/30'
                        : act.status === 'done'
                        ? 'bg-[#0d0d0d] border-gray-800'
                        : 'bg-red-950/[0.06] border-red-800/30'
                    }`}>
                      <span className={`w-2 h-2 rounded-full shrink-0 ${
                        act.status === 'running' ? 'bg-purple-500 animate-pulse'
                        : act.status === 'done' ? 'bg-emerald-500'
                        : 'bg-red-500'
                      }`} />
                      <span className="[&>svg]:w-3 [&>svg]:h-3 shrink-0">
                        {getIcon(act.toolName)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className={`text-[10px] font-medium ${act.status === 'running' ? 'text-purple-300' : 'text-gray-300'}`}>
                          {act.semantic}
                        </span>
                        {act.detail && (
                          <div className="text-[8px] text-gray-500 truncate">{act.detail}</div>
                        )}
                      </div>
                      <span className={`text-[8px] font-bold px-1 py-0.5 rounded shrink-0 ${
                        act.status === 'running' ? 'text-purple-400 bg-purple-900/30'
                        : act.status === 'done' ? 'text-emerald-400 bg-emerald-900/30'
                        : 'text-red-400 bg-red-900/30'
                      }`}>
                        {act.status === 'running' ? '●' : act.status === 'done' ? '✓' : '✗'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto" ref={scrollContainerRef}>
            <div className="px-4 py-4">
            {isRestoring ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-gray-600 text-xs space-y-2">
                  <div className="w-8 h-8 mx-auto relative">
                    <div className="absolute inset-0 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                  </div>
                  <p className="text-purple-400 animate-pulse">Restoring session...</p>
                </div>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center text-gray-600 text-xs space-y-2">
                  {historyLoading ? (
                    <>
                      <div className="w-8 h-8 mx-auto relative">
                        <div className="absolute inset-0 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                      </div>
                      <p className="text-blue-400 animate-pulse">Loading history...</p>
                      <p className="text-gray-700 text-[10px]">Restoring previous conversation</p>
                    </>
                  ) : phase === 'running' ? (
                    <>
                      <div className="w-8 h-8 mx-auto relative">
                        <div className="absolute inset-0 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                      </div>
                      <p className="text-purple-500 animate-pulse">Connecting to Claude...</p>
                      <p className="text-gray-700 text-[10px]">Waiting for response</p>
                    </>
                  ) : connStatus.status !== 'connected' ? (
                    <>
                      <div className="w-2 h-2 mx-auto bg-red-500 rounded-full" />
                      <p className="text-red-400">Disconnected</p>
                      <p className="text-gray-700 text-[10px]">Check that relay and agent are running</p>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-8 h-8 mx-auto opacity-40" />
                      <p>Awaiting instructions</p>
                      <p className="text-gray-700 text-[10px]">Type a message or use Quick Actions</p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              turns.map((turn, turnIdx) => {
                const isLatestTurn = turnIdx === turns.length - 1;
                return (
                <div key={`turn-${turnIdx}`} className={`turn ${!isLatestTurn ? 'mb-6 border-b border-gray-800/50 pb-6' : ''}`}>
                  {turn.userMsg.isCompactSummary ? (
                    <SystemContextBar userMsg={turn.userMsg} />
                  ) : (
                  /* ── Sticky user message header (like VS Code extension) ── */
                  <div className={`flex gap-3 text-sm ${!isLatestTurn ? 'sticky top-0 z-10 bg-[#0a0a0a] py-2 -mx-4 px-4 border-b border-gray-800' : ''}`}>
                    <span className="w-14 shrink-0 text-gray-600 text-[10px] pt-1">{turn.userMsg.timestamp}</span>
                    <div className="bg-purple-900/15 border border-purple-900/40 text-purple-100 px-3 py-2 rounded-lg max-w-xl prose-container flex-1">
                      <MarkdownRenderer content={turn.userMsg.content} />
                    </div>
                    {/* Fork button — on every turn except the latest */}
                    {!isLatestTurn && (
                      <button
                        onClick={() => { setForkTarget(turnIdx); setForkPrompt(''); }}
                        className="self-center text-gray-600 hover:text-purple-400 transition-colors p-1 rounded hover:bg-purple-900/20"
                        title="Fork conversation from here"
                      >
                        <GitBranch className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  )}

                  {/* ── Assistant response: compact activity bar + text ── */}
                  {turn.assistantMsgs.length > 0 && (
                    <div className="flex flex-col gap-2 mt-3">
                      {turn.assistantMsgs.map((asstMsg) => {
                        const toolBlocks = asstMsg.blocks.filter(b =>
                          b.type === 'tool_use' || b.type === 'tool_result' || b.type === 'thinking'
                        );
                        const textBlocks = asstMsg.blocks.filter(b => b.type === 'text');
                        const unknownBlocks = asstMsg.blocks.filter(b => b.type === 'unknown');
                        return (
                        <div key={asstMsg.id}>
                          {/* ── Timeline: dots + connector lines on the left ── */}
                          {toolBlocks.length > 0 && (
                            <div className="flex gap-2 mb-2">
                              {/* Left: timeline dots + connector lines */}
                              <div className="flex flex-col items-center w-4 shrink-0 pt-[3px]">
                                {toolBlocks.map((block, bi) => (
                                  <div key={block.id || bi} className="flex flex-col items-center">
                                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-gray-700/50 ${
                                      block.status === 'running' ? 'bg-purple-500 animate-pulse ring-purple-500/40'
                                      : block.status === 'error' ? 'bg-red-500'
                                      : 'bg-emerald-500/80'
                                    }`} />
                                    {bi < toolBlocks.length - 1 && (
                                      <div className="w-px h-5 bg-gray-700/40" />
                                    )}
                                  </div>
                                ))}
                              </div>
                              {/* Right: content aligned with dots */}
                              <div className="flex-1 min-w-0 space-y-0.5">
                                {toolBlocks.map((block, bi) => (
                                  <div key={block.id || bi}
                                    onClick={() => block.output && setExpandedToolOutputs(prev => {
                                      const next = new Set(prev);
                                      if (next.has(block.id)) next.delete(block.id);
                                      else next.add(block.id);
                                      return next;
                                    })}
                                    className={`flex flex-col ${block.output ? 'cursor-pointer hover:bg-gray-900/10 rounded px-1 -mx-1' : ''}`}
                                  >
                                    <div className="flex items-center gap-1.5 text-[10px] leading-5">
                                      {/* Icon */}
                                      <span className="[&>svg]:w-3 [&>svg]:h-3 shrink-0 text-gray-500">
                                        {block.type === 'thinking'
                                          ? <Sparkles className="w-3 h-3" />
                                          : getIcon(block.toolName)
                                        }
                                      </span>
                                      {/* Label + detail */}
                                      {block.type === 'thinking' ? (
                                        <span className={block.status === 'running' ? 'text-gray-400' : 'text-gray-600'}>
                                          {block.status === 'running' ? 'Analyzing...' : 'Analysis done'}
                                        </span>
                                      ) : (
                                        <>
                                          <span className={`${block.status === 'running' ? 'text-gray-300' : 'text-gray-500'}`}>
                                            {block.semantic}
                                          </span>
                                          {block.detail && (
                                            <code className="text-gray-600 truncate max-w-[300px] min-w-0" title={block.detail}>
                                              {block.detail}
                                            </code>
                                          )}
                                          {block.toolName === 'Bash' && block.exitCode >= 0 && (
                                            <span className={`text-[8px] px-1 rounded font-bold shrink-0 ${
                                              block.exitCode === 0 ? 'text-emerald-600 bg-emerald-900/20' : 'text-red-400 bg-red-900/20'
                                            }`}>
                                              {block.exitCode === 0 ? '✓' : `exit: ${block.exitCode}`}
                                            </span>
                                          )}
                                        </>
                                      )}
                                      {block.output && (
                                        <span className="text-gray-700 text-[8px] ml-auto shrink-0">
                                          {expandedToolOutputs.has(block.id) ? '▲' : '▼'}
                                        </span>
                                      )}
                                    </div>
                                    {/* Expanded output: for bash shows command + result; for others shows result only */}
                                    {block.output && expandedToolOutputs.has(block.id) && (
                                      <div className="ml-1 mt-0.5 mb-1">
                                        {block.toolName === 'Bash' && block.toolArgs && (
                                          <div className="text-[9px] text-orange-400/80 bg-[#0a0a0a] border border-gray-800 rounded-t px-2 py-1 font-mono whitespace-pre-wrap break-all">
                                            $ {(() => {
                                              try { const p = JSON.parse(block.toolArgs); return p.command || block.toolArgs; }
                                              catch { return block.toolArgs; }
                                            })()}
                                          </div>
                                        )}
                                        <div className={`text-[9px] text-gray-500 bg-[#0a0a0a] border border-gray-800 ${block.toolName === 'Bash' ? 'border-t-0 rounded-b' : 'rounded'} px-2 py-1 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto`}>
                                          {block.output.slice(0, 5000)}
                                          {block.output.length > 5000 && <span className="text-gray-700">... ({block.output.length - 5000} more chars)</span>}
                                        </div>
                                      </div>
                                    )}
                                    {bi < toolBlocks.length - 1 && <div className="h-[14px]" />}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* ── Text content ── */}
                          {textBlocks.length > 0 && (
                            <div className="space-y-2">
                              {textBlocks.map((textBlock) => (
                                <div key={textBlock.id} className="text-sm">
                                  <div className="max-w-2xl text-gray-300 leading-relaxed text-xs prose-container">
                                    <MarkdownRenderer content={textBlock.content} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* ── Unknown blocks ── */}
                          {unknownBlocks.map((unkBlock) => (
                            <div key={unkBlock.id} className="text-xs p-2 rounded border border-yellow-800/40 bg-yellow-950/[0.05] mt-2">
                              <div className="flex items-center gap-2">
                                <AlertCircle className="w-3 h-3 text-yellow-500" />
                                <span className="font-bold text-[10px] text-yellow-500">Unknown</span>
                              </div>
                            </div>
                          ))}

                          {asstMsg.isPending && (
                            <div className="flex items-center gap-2 text-[10px] text-purple-500 animate-pulse pl-2 mt-2">
                              <div className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
                              Claude is working...
                            </div>
                          )}
                        </div>
                      );
                      })}
                    </div>
                  )}
                </div>
              );
            })
            )}
            <div ref={actionEndRef} />
          </div>
          </div>
          <div className="shrink-0 px-4 py-3 bg-gradient-to-t from-black via-[#0a0a0a] to-transparent relative">
            {/* Slash command panel (floats above) */}
            {showCommands && (
              <div ref={cmdPanelRef}
                className="absolute bottom-full left-4 right-4 mb-2 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-2xl shadow-black/50 overflow-hidden"
              >
                <div className="p-2 border-b border-gray-800 text-[10px] text-gray-500 font-bold tracking-wider px-3 py-1.5">
                  QUICK COMMANDS
                </div>
                <div className="max-h-48 overflow-y-auto py-1">
                  {SLASH_COMMANDS.map((sc) => (
                    <button key={sc.cmd} onClick={() => sc.ok && handleCommandClick(sc.cmd)}
                      className={`w-full flex items-center gap-3 px-3 py-2 transition-colors text-left ${
                        sc.ok ? 'hover:bg-gray-800 cursor-pointer' : 'opacity-40 cursor-not-allowed'
                      }`}
                      title={sc.ok ? sc.cmd + ' ' + sc.desc : '当前模式不支持'}
                    >
                      <code className={`text-[11px] font-bold shrink-0 w-16 ${sc.ok ? 'text-purple-400' : 'text-gray-600'}`}>{sc.cmd}</code>
                      <span className="text-[10px] truncate">{sc.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* @ file suggestions dropdown */}
            {showFileSuggest && (
              <div className="absolute bottom-full left-4 right-4 mb-2 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-2xl shadow-black/50 overflow-hidden z-50">
                <div className="p-1.5 border-b border-gray-800 text-[10px] text-gray-500 px-3 py-1">FILES</div>
                <div className="max-h-40 overflow-y-auto py-1">
                  {fileSuggestions.map((item) => (
                    <button key={item.path || item.name}
                      onClick={() => handleFileSuggestionClick(item)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800 transition-colors text-left"
                    >
                      {item.type === 'dir'
                        ? <Folder className="w-3 h-3 text-yellow-600 shrink-0" />
                        : <FileCode className="w-3 h-3 text-blue-500 shrink-0" />
                      }
                      <span className="text-[10px] text-gray-300 truncate">{item.path || item.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
              className={`flex items-center gap-1.5 bg-[#151515] border ${
                phase === 'running' ? 'border-purple-800 shadow-[0_0_12px_rgba(168,85,247,0.15)]' : 'border-gray-700 focus-within:border-purple-500'
              } p-2 rounded-lg transition-all`}
            >
              <button type="button" onClick={() => setShowCommands(v => !v)}
                className={`text-xs font-bold px-1.5 py-0.5 rounded shrink-0 transition-colors ${
                  showCommands ? 'text-purple-400 bg-purple-900/20' : 'text-gray-500 hover:text-gray-300'
                }`}
                title="Slash commands"
              >
                {'/>'}
              </button>
              <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
              <input type="text" value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={phase === 'running'}
                placeholder={phase === 'running' ? 'Claude is working...' : 'Type instructions or press Quick Actions...'}
                className="flex-1 bg-transparent outline-none text-gray-200 placeholder-gray-600 text-sm disabled:opacity-50 min-w-0 msg-input"
              />
              {phase !== 'running' ? (
                <button type="submit"
                  className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded flex items-center gap-1.5 transition-colors shrink-0"
                  title="Submit (Enter)">
                  <Play className="w-3 h-3 fill-current" /> EXEC
                </button>
              ) : (
                <button type="button" onClick={handleInterrupt}
                  className="px-4 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs font-bold rounded flex items-center gap-1.5 transition-colors shrink-0 animate-pulse"
                  title="Stop current task (Esc)">
                  <Square className="w-3 h-3 fill-current" /> STOP
                </button>
              )}
            </form>
          </div>
        </main>

        {/* ═══ RIGHT: System Monitor + Terminal ═ */}
        <aside className="w-72 border-l border-gray-800 bg-[#0d0d0d] flex flex-col hidden lg:flex shrink-0">
          <TaskPanel tasks={activeTasks} queueInfo={queueInfo} />

          {/* Actions */}
          <div className="p-3 border-b border-gray-800 bg-[#111] space-y-2">
            <div className="text-[10px] text-gray-500 font-bold tracking-wider">ACTIONS</div>
            <div className="flex flex-wrap gap-1.5">
              <button onClick={handleNewSession}
                className="flex-1 px-2 py-1.5 bg-[#1a1a1a] hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] rounded border border-gray-700 transition-colors">
                + New Session
              </button>
              <button onClick={handleQuickCompact}
                className="px-2 py-1.5 bg-[#1a1a1a] hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] rounded border border-gray-700 transition-colors"
                title="Compress context to free tokens">
                /compact
              </button>
              <button onClick={() => saveSnapshot()}
                className="px-2 py-1.5 bg-[#1a1a1a] hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] rounded border border-gray-700 transition-colors"
                title="Save current conversation as snapshot">
                + Snapshot
              </button>
            </div>
          </div>

          {/* Snapshots (forks) */}
          {snapshots.length > 0 && (
            <div className="border-b border-gray-800 bg-[#111]">
              <div className="p-2 text-[10px] font-bold text-gray-500 flex items-center gap-2 tracking-wider">
                <GitBranch className="w-3 h-3" />
                SNAPSHOTS
                <span className="text-gray-700 font-normal">{snapshots.length}</span>
              </div>
              <div className="max-h-28 overflow-y-auto px-2 pb-2 space-y-0.5">
                {snapshots.slice().reverse().map(s => (
                  <div key={s.id} className="flex items-center gap-1 group">
                    <button
                      onClick={() => loadSnapshot(s.id)}
                      className="flex-1 flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] transition-colors text-left min-w-0"
                      title={s.name}
                    >
                      <ChevronRight className="w-2 h-2 shrink-0 text-gray-600" />
                      <span className="truncate text-[9px]">{s.name}</span>
                      <span className="text-[7px] text-gray-700 ml-auto shrink-0">{s.ts.slice(5, 16)}</span>
                    </button>
                    <button
                      onClick={() => forkFromSnapshot(s.id)}
                      className="opacity-0 group-hover:opacity-100 px-1 text-[8px] text-purple-600 hover:text-purple-400 transition-opacity"
                      title="Fork from this snapshot"
                    >fork</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Files in Context */}
          {knownFiles.size > 0 && (
            <div className="border-b border-gray-800 bg-[#111]">
              <div className="p-2 text-[10px] font-bold text-gray-500 flex items-center gap-2 tracking-wider">
                <FileCode className="w-3 h-3" />
                FILES IN CONTEXT
                <span className="text-gray-700 font-normal">{knownFiles.size}</span>
              </div>
              <div className="max-h-24 overflow-y-auto px-2 pb-2 space-y-0.5">
                {[...knownFiles.entries()].filter(([,t]) => t === 'file').slice(-30).map(([path]) => (
                  <button key={path}
                    onClick={() => {
                      fetch(`/api/read-file?path=${encodeURIComponent(path)}`)
                        .then(r => r.json())
                        .then(data => {
                          if (data.content !== undefined) setViewingFile({ path, content: data.content });
                        })
                        .catch(() => {});
                    }}
                    className="w-full flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] transition-colors text-left"
                    title={path}
                  >
                    <FileCode className="w-2.5 h-2.5 shrink-0 text-blue-500" />
                    <span className="truncate text-[9px]">{shortenPath(path)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Raw Terminal — truth layer */}
          <div className="flex-1 flex flex-col bg-black min-h-0">
            {/* Tab bar */}
            <div className="flex border-b border-gray-800 bg-[#111] shrink-0">
              <button onClick={() => setTerminalTab('log')}
                className={`px-3 py-1.5 text-[10px] tracking-wider flex items-center gap-1.5 transition-colors ${
                  terminalTab === 'log' ? 'text-purple-400 border-b border-purple-500 bg-[#0a0a0a]' : 'text-gray-600 hover:text-gray-400'
                }`}>
                <Terminal className="w-3 h-3" /> LOG
              </button>
              <button onClick={() => setTerminalTab('raw')}
                className={`px-3 py-1.5 text-[10px] tracking-wider flex items-center gap-1.5 transition-colors ${
                  terminalTab === 'raw' ? 'text-purple-400 border-b border-purple-500 bg-[#0a0a0a]' : 'text-gray-600 hover:text-gray-400'
                }`}>
                <AlertCircle className="w-3 h-3" /> RAW
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-3 text-gray-400 text-xs font-mono leading-relaxed">
              {terminalTab === 'log' ? (
                logs.length === 0 ? (
                  <div className="text-gray-700 text-[10px] italic">No log entries yet</div>
                ) : (
                  logs.map((log, i) => (
                    <div key={i} className={`whitespace-pre-wrap ${
                      log.includes('Error') || log.includes('[Error]') ? 'text-red-400'
                      : log.includes('✓') || log.includes('✅') ? 'text-green-400'
                      : log.includes('> ') ? 'text-purple-300'
                      : log.includes('[Unknown]') ? 'text-yellow-500'
                      : 'text-gray-500'
                    }`}>
                      {log}
                    </div>
                  ))
                )
              ) : (
                /* RAW view: unfiltered msgLog from WebSocket */
                msgLog.length === 0 ? (
                  <div className="text-gray-700 text-[10px] italic">Raw output will appear here</div>
                ) : (
                  msgLog.slice(-200).map((entry) => (
                    <div key={entry.id} className="text-[10px] leading-relaxed font-mono">
                      <span className="text-gray-700">{entry.time}</span>{' '}
                      <span className={`${
                        entry.type === 'output' ? 'text-gray-500'
                        : entry.type === 'block' ? 'text-purple-500'
                        : entry.type === 'input' ? 'text-green-500'
                        : entry.type === 'error' ? 'text-red-500'
                        : 'text-gray-600'
                      }`}>
                        [{entry.type}]
                      </span>{' '}
                      <span className="text-gray-400">{entry.data}</span>
                    </div>
                  ))
                )
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        </aside>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setForkTarget(null)}>
          <div className="bg-[#151515] border border-gray-700 rounded-lg w-full max-w-lg shadow-2xl shadow-black/60" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-3 border-b border-gray-800">
              <div className="flex items-center gap-2 text-xs text-gray-300">
                <GitBranch className="w-4 h-4 text-purple-400" />
                Fork Conversation
              </div>
              <button onClick={() => setForkTarget(null)} className="text-gray-500 hover:text-gray-300 text-lg leading-none">&times;</button>
            </div>
            <div className="p-4 space-y-4">
              {/* Turn preview */}
              <div className="bg-[#0a0a0a] border border-gray-800 rounded p-3 text-xs text-gray-400 max-h-24 overflow-y-auto">
                <span className="text-purple-400 font-bold">@{turns[forkTarget].userMsg.timestamp}</span>
                <span className="text-gray-200 ml-2">{turns[forkTarget].userMsg.content.slice(0, 200)}</span>
                {turns[forkTarget].userMsg.content.length > 200 && <span className="text-gray-600">...</span>}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    // Rewind: truncate messages to this turn
                    const allMsgs = messagesBySession[sessionKey] || [];
                    const turnMsgs: Message[] = [turns[forkTarget].userMsg, ...turns[forkTarget].assistantMsgs];
                    const cutoffIdx = allMsgs.indexOf(turnMsgs[turnMsgs.length - 1]) + 1;
                    updateSession(sessionKey, () => allMsgs.slice(0, cutoffIdx));
                    processedRef.current = 0;
                    setPhase('idle');
                    setCurrentActivity(null);
                    addLog(`[System] Rewound to turn ${forkTarget + 1}`);
                    setForkTarget(null);
                  }}
                  className="flex-1 px-3 py-2 bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold rounded transition-colors"
                >
                  ↩ Rewind to here
                </button>
                <button
                  onClick={() => {
                    // Fork: save snapshot + optionally send new prompt
                    saveSnapshot(`Fork from turn ${forkTarget + 1}`);
                    const targetText = turns[forkTarget].userMsg.content;
                    addLog(`[System] Forked from turn ${forkTarget + 1}: "${targetText.slice(0, 60)}..."`);
                    setForkTarget(null);
                  }}
                  className="flex-1 px-3 py-2 bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold rounded transition-colors"
                >
                  <GitBranch className="w-3 h-3 inline-block mr-1" />
                  Fork as Snapshot
                </button>
              </div>

              {/* Prompt input for continuing from fork */}
              <div>
                <label className="text-[10px] text-gray-500 block mb-1">Optional: send a new prompt after fork</label>
                <div className="flex gap-2">
                  <input
                    type="text" value={forkPrompt}
                    onChange={e => setForkPrompt(e.target.value)}
                    placeholder="Continue with..."
                    className="flex-1 bg-[#0d0d0d] border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 outline-none focus:border-purple-500"
                    autoFocus
                  />
                  <button
                    onClick={() => {
                      if (!forkPrompt.trim()) return;
                      saveSnapshot(`Fork from turn ${forkTarget + 1}`);
                      const targetText = turns[forkTarget].userMsg.content;
                      addLog(`[System] Forked from turn ${forkTarget + 1}: "${targetText.slice(0, 60)}..." → "${forkPrompt.slice(0, 60)}"`);
                      setInputValue(forkPrompt);
                      setForkTarget(null);
                      // Focus the input and auto-submit after a short delay
                      setTimeout(() => {
                        const input = document.querySelector<HTMLInputElement>('.msg-input');
                        input?.focus();
                      }, 100);
                    }}
                    disabled={!forkPrompt.trim()}
                    className="px-3 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded transition-colors"
                  >
                    Send
                  </button>
                </div>
              </div>

              <div className="text-[9px] text-gray-600 leading-relaxed">
                <p><strong className="text-gray-500">Rewind:</strong> discard messages after this turn and continue from here.</p>
                <p><strong className="text-gray-500">Fork:</strong> save current state as snapshot, then optionally send a new prompt from this point.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODE / EFFORT STATUS BAR ══════════ */}
      <div className="h-7 shrink-0 bg-[#0d0d0d] border-t border-gray-800 flex items-center px-3 gap-2 text-[10px] z-30">
        <div ref={modePickerRef} className="relative">
          <button onClick={() => setShowModePicker(v => !v)}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#1a1a1a] border border-gray-700 hover:border-purple-600 text-gray-400 hover:text-gray-200 transition-colors"
          >
            {permissionMode === 'default' && <Ban className="w-3 h-3 text-yellow-500" />}
            {permissionMode === 'acceptEdits' && <CheckCircle2 className="w-3 h-3 text-green-500" />}
            {permissionMode === 'plan' && <Cpu className="w-3 h-3 text-purple-500" />}
            <span className="font-medium">
              {permissionMode === 'default' ? 'Ask before edits'
               : permissionMode === 'acceptEdits' ? 'Edit automatically'
               : 'Plan mode'}
            </span>
            <ChevronDown className="w-2.5 h-2.5 text-gray-600" />
          </button>

          {showModePicker && (
            <div className="absolute bottom-full left-0 mb-1 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-2xl shadow-black/50 overflow-hidden z-50" style={{ minWidth: '200px' }}>
              <div className="px-3 py-1.5 text-[9px] text-gray-600 font-bold tracking-wider border-b border-gray-800">PERMISSION MODE</div>
              <div className="py-1">
                {(['default', 'acceptEdits', 'plan'] as const).map(mode => (
                  <button key={mode}
                    onClick={() => handleSetMode(mode)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-800 ${
                      permissionMode === mode ? 'bg-purple-900/10' : ''
                    }`}
                  >
                    {mode === 'default' && <Ban className="w-3.5 h-3.5 text-yellow-500" />}
                    {mode === 'acceptEdits' && <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />}
                    {mode === 'plan' && <Cpu className="w-3.5 h-3.5 text-purple-500" />}
                    <div className="flex flex-col">
                      <span className={`text-[10px] ${permissionMode === mode ? 'text-purple-300 font-bold' : 'text-gray-200'}`}>
                        {mode === 'default' ? 'Ask before edits'
                         : mode === 'acceptEdits' ? 'Edit automatically'
                         : 'Plan mode'}
                      </span>
                      <span className="text-[8px] text-gray-600">
                        {mode === 'default' ? 'Claude asks before each edit'
                         : mode === 'acceptEdits' ? 'Claude edits files directly'
                         : 'Claude plans before acting'}
                      </span>
                    </div>
                    {permissionMode === mode && <ChevronRight className="w-3 h-3 text-purple-500 ml-auto shrink-0" />}
                  </button>
                ))}
              </div>
              <div className="border-t border-gray-800">
                <div className="px-3 py-1.5 text-[9px] text-gray-600 font-bold tracking-wider">EFFORT (thinking)</div>
                <div className="py-1">
                  {(['low', 'medium', 'high'] as const).map(level => (
                    <button key={level}
                      onClick={() => handleSetEffort(level)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-800 ${
                        effortLevel === level ? 'bg-purple-900/10' : ''
                      }`}
                    >
                      <Sparkles className={`w-3.5 h-3.5 ${effortLevel === level ? 'text-purple-400' : 'text-gray-600'}`} />
                      <div className="flex flex-col">
                        <span className={`text-[10px] ${effortLevel === level ? 'text-purple-300 font-bold' : 'text-gray-200'}`}>
                          {level === 'low' ? 'Off'
                           : level === 'medium' ? 'On'
                           : 'Max'}
                        </span>
                        <span className="text-[8px] text-gray-600">
                          {level === 'low' ? 'No extended thinking'
                           : level === 'medium' ? 'Enable extended thinking'
                           : 'Maximum thinking depth'}
                        </span>
                      </div>
                      {effortLevel === level && <ChevronRight className="w-3 h-3 text-purple-500 ml-auto shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <span className="text-gray-700">|</span>

        {/* Effort quick display */}
        <span className={`text-[9px] ${effortLevel === 'low' ? 'text-gray-600' : 'text-purple-400'}`}>
          Effort: {effortLevel === 'low' ? 'Off' : effortLevel === 'medium' ? 'On' : 'Max'}
        </span>

        {/* Queue status indicator */}
        {queueStatus.processing && (
          <>
            <span className="text-gray-700">|</span>
            <span className={`text-[9px] flex items-center gap-1 ${
              queueStatus.source === 'web' ? 'text-purple-400' : 'text-yellow-500'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                queueStatus.source === 'web' ? 'bg-purple-400' : 'bg-yellow-500'
              } animate-pulse-dot`} />
              {queueStatus.source === 'web' ? 'Web processing' : 'Terminal busy'}
              {queueStatus.queueDepth > 0 && ` (+${queueStatus.queueDepth})`}
            </span>
          </>
        )}

        <span className="flex-1" />

        {/* Keyboard shortcut hints */}
        <span className="text-[9px] text-gray-600 hidden md:flex items-center gap-3">
          <kbd className="px-1 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-500">Esc</kbd>
          <span className="text-gray-700">Stop</span>
          <kbd className="px-1 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-500">⌘K</kbd>
          <span className="text-gray-700">Commands</span>
          <kbd className="px-1 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-500">⌘L</kbd>
          <span className="text-gray-700">Clear</span>
          <kbd className="px-1 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-500">⌘⇧C</kbd>
          <span className="text-gray-700">Copy</span>
        </span>
      </div>

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
  );
}

// ==========================================
// Activity Group Component
// ==========================================
function ActivityGroup({
  group, msgId, onToggleExpand, onOpenFile,
}: {
  group: BlockGroup;
  msgId: string;
  onToggleExpand: (msgId: string, blockId: string) => void;
  onOpenFile?: (file: {path: string; content: string}) => void;
}) {
  // Single item — render directly
  if (group.type !== 'group' || group.count <= 1) {
    const block = group.items[0];
    return renderBlock(block, msgId, onToggleExpand, onOpenFile);
  }

  // Grouped items (consecutive same tool)
  const firstItem = group.items[0];
  const lastItem = group.items[group.items.length - 1];
  const isRunning = firstItem.status === 'running';
  const allDone = group.items.every(b => b.status === 'done' || b.status === 'error');

  const icon = getIcon(firstItem.toolName);
  const borderColor = isRunning ? 'border-purple-700/50'
    : allDone ? 'border-gray-700'
    : 'border-orange-700/50';
  const bgColor = isRunning ? 'bg-purple-950/[0.04]'
    : 'bg-[#0d0d0d]';

  return (
    <div className={`text-xs ${bgColor} p-2.5 rounded-lg border ${borderColor}`}>
      <div className="flex flex-col gap-1.5 w-full min-w-0">
        {/* Group header */}
        <div className="flex items-center gap-2 text-[10px]">
          <span className="[&>svg]:w-3.5 [&>svg]:h-3.5">{icon}</span>
          <span className={`font-bold ${isRunning ? 'text-purple-400' : 'text-gray-300'}`}>
            {firstItem.semantic}
          </span>
          <span className="text-gray-600">({group.count}×)</span>
          {isRunning && <span className="text-purple-500 animate-pulse text-[10px]">● running</span>}
        </div>
        {/* Collapsed summary — show last command/path */}
        <div className="flex flex-col gap-0.5 pl-5 border-l-2 border-gray-800">
          {group.items.map((b, i) => (
            <div key={i} className="flex items-center gap-1.5 text-gray-400 text-[10px]">
              {b.detail ? (
                <code
                  onClick={() => {
                    if (b.toolName === 'Read' && onOpenFile) {
                      onOpenFile({ path: b.detail, content: b.output || '// (file content not captured)' });
                    }
                  }}
                  className={`truncate max-w-[180px] ${b.toolName === 'Read' ? 'cursor-pointer hover:text-purple-300' : ''}`}
                  title={b.detail}
                >{shortenPath(b.detail)}</code>
              ) : (
                <span className="italic text-gray-600">{b.toolName}</span>
              )}
              {b.status === 'done' && b.output && (
                <span className="text-green-500 ml-auto shrink-0">✓</span>
              )}
              {b.status === 'error' && (
                <span className="text-red-500 ml-auto shrink-0">✗</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// Single Block Renderer
// ==========================================
function renderBlock(
  block: Block, msgId: string,
  onToggleExpand: (msgId: string, blockId: string) => void,
  onOpenFile?: (file: {path: string; content: string}) => void,
) {
  switch (block.type) {
    case 'thinking':
      return (
        <div className={`text-xs pl-2 border-l-2 transition-colors ${
          block.status === 'running' ? 'border-purple-500/50' : 'border-gray-700/30'
        }`}>
          <div className="flex flex-col gap-1 w-full min-w-0">
            <button
              onClick={() => onToggleExpand(msgId, block.id)}
              className="flex items-center gap-1.5 text-gray-400 hover:text-gray-200 transition-colors text-left"
            >
              <Sparkles className={`w-3 h-3 ${block.status === 'running' ? 'text-purple-400 animate-pulse' : 'text-purple-500'}`} />
              <span className="font-bold text-[10px]">
                {block.status === 'running' ? 'Analyzing...' : 'Analysis complete'}
              </span>
              {block.content && (
                <span className="ml-auto">
                  {block.expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </span>
              )}
            </button>
            {block.expanded && block.content && (
              <div className="text-gray-500 text-[10px] bg-[#0a0a0a] border border-gray-800 p-2.5 rounded leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                {block.content}
              </div>
            )}
          </div>
        </div>
      );

    case 'tool_use':
    case 'tool_result': {
      const sem = getSemantic(block.toolName);
      const isRunning = block.status === 'running';
      const icon = getIcon(block.toolName);

      return (
        <div className={`text-xs p-2.5 rounded-lg border ${
          isRunning ? 'border-purple-700/40 bg-purple-950/[0.04]' : 'border-gray-800 bg-[#0d0d0d]'
        }`}>
          <div className="flex flex-col gap-1.5 w-full min-w-0">
            {/* Header */}
            <div className="flex items-center gap-2">
              <span className="[&>svg]:w-3.5 [&>svg]:h-3.5">{icon}</span>
              <span className={`font-bold text-[10px] ${isRunning ? 'text-purple-400' : 'text-gray-300'}`}>
                {sem.label}
              </span>
              {block.detail && (
                <code
                  onClick={() => {
                    if (block.toolName === 'Read' && onOpenFile) {
                      onOpenFile({ path: block.detail, content: block.output || '// (file content not captured)' });
                    }
                  }}
                  className={`bg-black px-1.5 py-0.5 rounded border border-gray-800 text-gray-300 text-[10px] font-mono flex items-center gap-1 max-w-[300px] ${
                    block.toolName === 'Read' ? 'cursor-pointer hover:border-purple-500 hover:text-purple-300 group' : ''
                  }`}
                  title={block.detail}
                >
                  <span className="truncate text-left" style={{direction: 'rtl', textAlign: 'left'}}>
                    {shortenPath(block.detail)}
                  </span>
                  {block.toolName === 'Read' && (
                    <Eye className="w-3 h-3 shrink-0 text-gray-600 group-hover:text-purple-400 transition-colors" />
                  )}
                </code>
              )}
              {block.exitCode >= 0 && block.status === 'done' && (
                <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded ${
                  block.exitCode === 0 ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'
                }`}>
                  Exit: {block.exitCode}
                </span>
              )}
              {isRunning && (
                <span className="ml-auto text-purple-500 animate-pulse text-[10px]">● running</span>
              )}
            </div>
            {/* Output — always full */}
            {block.output && (
              <div className="mt-0.5">
                <div className="text-gray-500 bg-[#050505] p-2 rounded border border-gray-900 whitespace-pre-wrap font-mono text-[10px] overflow-y-auto max-h-96">
                  <ClickableOutput text={block.output} onOpenFile={onOpenFile} toolName={block.toolName} />
                </div>
              </div>
            )}

            {/* Diff for Edit/Write */}
            {(block.toolName === 'Edit' || block.toolName === 'Write') && block.toolArgs && block.status === 'done' && (
              <DiffViewer toolName={block.toolName} toolArgs={block.toolArgs} detail={block.detail} />
            )}
          </div>
        </div>
      );
    }

    case 'text': {
      return (
        <div className="text-sm">
          <div className="max-w-xl text-gray-300 leading-relaxed text-xs prose-container">
            <MarkdownRenderer content={block.content} />
          </div>
        </div>
      );
    }

    case 'unknown':
      return (
        <div className="text-xs p-2.5 rounded-lg border border-yellow-800/40 bg-yellow-950/[0.05]">
          <div className="flex flex-col gap-1.5 w-full min-w-0">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-yellow-500" />
              <span className="font-bold text-[10px] text-yellow-500">Unknown Activity</span>
            </div>
            <div className="text-gray-500 text-[10px] bg-[#0a0a0a] border border-gray-800 p-2 rounded">
              {block.content || 'Unrecognized event from Claude'}
            </div>
            {block.rawData && (
              <details className="text-[10px]">
                <summary className="text-gray-600 cursor-pointer hover:text-gray-400">Raw JSON</summary>
                <pre className="mt-1 text-gray-600 bg-[#050505] p-2 rounded border border-gray-900 whitespace-pre-wrap font-mono text-[10px] max-h-32 overflow-y-auto">
                  {block.rawData}
                </pre>
              </details>
            )}
          </div>
        </div>
      );

    default:
      return null;
  }
}

// ==========================================
// Icon helper
// ==========================================
function getIcon(toolName: string) {
  const sem = TOOL_SEMANTICS[toolName];
  if (!sem) return <AlertCircle className="w-3.5 h-3.5 text-gray-500" />;
  switch (sem.icon) {
    case 'Eye':     return <Eye className="w-3.5 h-3.5 text-blue-400" />;
    case 'Search':  return <Search className="w-3.5 h-3.5 text-cyan-400" />;
    case 'Terminal': return <Terminal className="w-3.5 h-3.5 text-orange-400" />;
    case 'FileCode': return <FileCode className="w-3.5 h-3.5 text-green-400" />;
    case 'Globe':   return <Globe className="w-3.5 h-3.5 text-purple-400" />;
    default:        return <AlertCircle className="w-3.5 h-3.5 text-gray-500" />;
  }
}

// ==========================================
// File Tree Component
// ==========================================
function FileTree({ entries, path: dirPath, depth, fileTree, expandedDirs, onToggleDir, onOpenFile, onSendFile }: {
  entries: any[];
  path: string;
  depth: number;
  fileTree: Record<string, {items: any[]; loaded: boolean}>;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onSendFile: (path: string) => void;
}) {
  return (
    <div className="space-y-px">
      {entries.map((entry) => {
        const fullPath = entry.path || entry.name;
        const isDir = entry.type === 'dir';
        const isExpanded = expandedDirs.has(fullPath);
        const children = isDir ? fileTree[fullPath] : null;

        if (isDir) {
          return (
            <div key={fullPath}>
              <button
                onClick={() => onToggleDir(fullPath)}
                className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-900 text-gray-400 hover:text-gray-200 transition-colors text-left"
                title={fullPath}
              >
                <ChevronRight className={`w-2.5 h-2.5 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                <Folder className="w-3 h-3 shrink-0 text-yellow-600" />
                <span className="truncate text-[10px]">{entry.name}</span>
              </button>
              {isExpanded && children?.loaded && (
                <div style={{ paddingLeft: '12px' }}>
                  <FileTree
                    entries={children.items}
                    path={fullPath}
                    depth={depth + 1}
                    fileTree={fileTree}
                    expandedDirs={expandedDirs}
                    onToggleDir={onToggleDir}
                    onOpenFile={onOpenFile}
                    onSendFile={onSendFile}
                  />
                </div>
              )}
              {isExpanded && !children?.loaded && (
                <div className="text-gray-700 text-[8px] pl-6 italic">loading...</div>
              )}
            </div>
          );
        }

        return (
          <div key={fullPath} className="flex items-center gap-1.5 group">
            <button
              onClick={() => onOpenFile(fullPath)}
              className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-900 text-gray-400 hover:text-gray-200 transition-colors text-left min-w-0"
              title={fullPath}
            >
              <FileCode className="w-3 h-3 shrink-0 text-blue-500" />
              <span className="truncate text-[10px]">{entry.name}</span>
            </button>
            <button
              onClick={() => onSendFile(fullPath)}
              className="opacity-0 group-hover:opacity-100 px-1 text-gray-600 hover:text-purple-400 text-[9px] transition-opacity shrink-0"
              title="Add to message"
            >@</button>
          </div>
        );
      })}
    </div>
  );
}

// ==========================================
// Clickable Output — make file paths clickable in Bash output
// ==========================================
const PATH_RE = /((?:[A-Za-z]:)?[\\/][^\s:;"'`(){}\[\]]*\.[a-zA-Z0-9]{1,4}(?::\d+)?(?::\d+)?)/g;

function ClickableOutput({ text, onOpenFile, toolName }: {
  text: string;
  onOpenFile?: (f: {path: string; content: string}) => void;
  toolName?: string;
}) {
  if (toolName !== 'Bash' && toolName !== 'PowerShell') {
    return <>{text}</>;
  }

  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  PATH_RE.lastIndex = 0;

  while ((match = PATH_RE.exec(text)) !== null) {
    const matchedPath = match[1].replace(/:\d+$/, '').replace(/:\d+:/, ':');
    const start = match.index;

    if (start > lastIdx) parts.push(text.slice(lastIdx, start));

    parts.push(
      <button key={start}
        onClick={() => {
          const cleanPath = matchedPath.replace(/\\/g, '/');
          fetch(`/api/read-file?path=${encodeURIComponent(cleanPath)}`)
            .then(r => r.json())
            .then(data => {
              if (data.content !== undefined) onOpenFile?.({ path: data.path || cleanPath, content: data.content });
              else onOpenFile?.({ path: cleanPath, content: `// (file not found: ${cleanPath})` });
            })
            .catch(() => onOpenFile?.({ path: cleanPath, content: `// (error reading: ${cleanPath})` }));
        }}
        className="text-blue-400 hover:text-blue-300 underline underline-offset-1 decoration-blue-800/50 hover:decoration-blue-400 transition-colors"
        title={matchedPath}
      >
        {matchedPath}
      </button>
    );

    lastIdx = PATH_RE.lastIndex;
  }

  if (lastIdx < text.length) parts.push(text.slice(lastIdx));

  return <>{parts.length > 0 ? parts : text}</>;
}

// ==========================================
// Diff Viewer — show changes for Edit/Write blocks
// ==========================================
function DiffViewer({ toolName, toolArgs, detail }: { toolName: string; toolArgs: string; detail: string }) {
  const [expanded, setExpanded] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [reverted, setReverted] = useState(false);
  let oldLines: string[] = [];
  let newLines: string[] = [];
  let oldStr = '', newStr = '';

  try {
    if (toolName === 'Edit') {
      const args = JSON.parse(toolArgs);
      oldStr = args.old_string || '';
      newStr = args.new_string || '';
      if (oldStr) oldLines = oldStr.split('\n');
      if (newStr) newLines = newStr.split('\n');
    } else if (toolName === 'Write') {
      const args = JSON.parse(toolArgs);
      if (args.content) newLines = args.content.split('\n');
    }
  } catch {}

  if (oldLines.length === 0 && newLines.length === 0) return null;

  const hasDiff = oldLines.length > 0;

  const handleRevert = async () => {
    if (reverted || reverting || !detail) return;
    setReverting(true);
    try {
      if (toolName === 'Edit' && oldStr) {
        // Read current file, reverse the edit
        const res = await fetch(`/api/read-file?path=${encodeURIComponent(detail)}`);
        const data = await res.json();
        if (data.content !== undefined) {
          const reversed = data.content.replace(newStr, oldStr);
          if (reversed !== data.content) {
            await fetch('/api/write', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath: detail, content: reversed }),
            });
            setReverted(true);
          }
        }
      }
    } catch {}
    setReverting(false);
  };

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1.5 text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {hasDiff ? `Diff (${oldLines.length}→${newLines.length} lines)` : `New file (${newLines.length} lines)`}
        </button>
        {/* Accept/Reject buttons */}
        {hasDiff && !reverted && (
          <div className="flex items-center gap-1 ml-auto">
            <button onClick={() => setReverted(true)}
              className="px-1.5 py-0.5 bg-emerald-900/30 hover:bg-emerald-800/40 text-emerald-400 text-[8px] rounded border border-emerald-800/50 transition-colors"
            >✓ Accept</button>
            <button onClick={handleRevert} disabled={reverting}
              className="px-1.5 py-0.5 bg-red-900/30 hover:bg-red-800/40 text-red-400 text-[8px] rounded border border-red-800/50 transition-colors disabled:opacity-50"
            >{reverting ? '...' : '✗ Reject'}</button>
          </div>
        )}
        {reverted && (
          <span className="text-emerald-500 text-[8px] ml-auto">
            {toolName === 'Edit' ? 'Change accepted' : 'Accepted'}
          </span>
        )}
      </div>

      {expanded && (
        <div className="mt-1 bg-[#050505] border border-gray-800 rounded p-1.5 max-h-64 overflow-y-auto font-mono text-[10px] leading-relaxed">
          {oldLines.length === 0 ? (
            newLines.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-6 shrink-0 text-gray-700 text-right mr-1 select-none">{i + 1}</span>
                <span className="text-green-400 flex-1 whitespace-pre">{line}</span>
              </div>
            ))
          ) : newLines.length === 0 ? (
            oldLines.map((line, i) => (
              <div key={i} className="flex">
                <span className="w-6 shrink-0 text-gray-700 text-right mr-1 select-none">{i + 1}</span>
                <span className="text-red-400 flex-1 whitespace-pre">{line}</span>
              </div>
            ))
          ) : (
            <div className="grid grid-cols-2 gap-0">
              <div>
                <div className="text-red-400 text-[8px] px-1 pb-0.5 border-b border-gray-800 mb-0.5">OLD</div>
                {oldLines.map((line, i) => (
                  <div key={i} className="flex">
                    <span className="w-5 shrink-0 text-gray-700 text-right mr-1 select-none text-[8px]">{i + 1}</span>
                    <span className="text-red-300 flex-1 whitespace-pre">{line}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-green-400 text-[8px] px-1 pb-0.5 border-b border-gray-800 mb-0.5">NEW</div>
                {newLines.map((line, i) => (
                  <div key={i} className="flex">
                    <span className="w-5 shrink-0 text-gray-700 text-right mr-1 select-none text-[8px]">{i + 1}</span>
                    <span className="text-green-300 flex-1 whitespace-pre">{line}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {reverted && (
            <div className="text-emerald-500 text-[8px] pt-1 border-t border-gray-800 mt-1">Change reverted</div>
          )}
        </div>
      )}
    </div>
  );
}

// ==========================================
// Search Results Renderer
// ==========================================
function renderSearchResults(
  results: any[],
  onClose: (v: boolean) => void,
  onLog: (msg: string) => void,
  onLoadSession: (sessionId: string, project: string, display?: string) => void,
) {
  const grouped = new Map<string, any[]>();
  for (const r of results) {
    const key = r.project || 'Unknown';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  const els: React.ReactNode[] = [];
  for (const [project, sessions] of Array.from(grouped.entries())) {
    els.push(
      <div key={project}>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0d0d0d] border-b border-gray-800 sticky top-0">
          <Folder className="w-3 h-3 text-yellow-600 shrink-0" />
          <span className="text-[10px] text-gray-400 font-bold truncate">{project.replace(/\\/g, '/')}</span>
          <span className="text-[9px] text-gray-700 ml-auto">{sessions.length}</span>
        </div>
        {sessions.map((s: any) => (
          <button key={s.sessionId} onClick={() => {
            onLoadSession(s.sessionId, s.project, s.display);
            onLog(`[Search] Loading session: ${(s.display || s.sessionId).slice(0, 100)}`);
          }}
            className="w-full flex flex-col gap-0.5 px-3 py-2 hover:bg-gray-800 text-left border-b border-gray-800/50 transition-colors"
          >
            <div className="flex items-start gap-2">
              <History className="w-3 h-3 text-gray-600 mt-0.5 shrink-0" />
              <span className="text-[11px] text-gray-200 line-clamp-2 leading-snug">
                {s.display ? s.display.slice(0, 200) : '(no preview)'}
              </span>
            </div>
            <div className="flex items-center gap-2 pl-5">
              <Clock className="w-2.5 h-2.5 text-gray-700" />
              <span className="text-[9px] text-gray-600">
                {s.timestamp ? new Date(s.timestamp).toLocaleString() : 'Unknown date'}
              </span>
              {s.matchedIn && (
                <span className="text-[8px] text-purple-600 bg-purple-900/20 px-1 rounded">
                  {s.matchedIn === 'content' ? 'matched content' : s.matchedIn}
                </span>
              )}
            </div>
            {s.snippet && (
              <div className="pl-5 text-[9px] text-gray-500 bg-[#0a0a0a] mt-1 p-1.5 rounded border border-gray-800 leading-relaxed line-clamp-2">
                ...{s.snippet}...
              </div>
            )}
          </button>
        ))}
      </div>
    );
  }

  return els;
}

// ==========================================
// Task Panel — active background tasks
// ==========================================
function TaskPanel({ tasks, queueInfo }: { tasks: Map<string, TaskInfo>; queueInfo?: { isProcessing: boolean; queueDepth: number; queue: any[] } }) {
  const taskList = Array.from(tasks.values());
  const hasQueue = queueInfo && (queueInfo.queueDepth > 0 || queueInfo.isProcessing);

  return (
    <div className="border-b border-gray-800 bg-[#111]">
      <div className="p-3 text-[10px] font-bold text-gray-500 flex items-center gap-2 tracking-wider">
        <Terminal className="w-3.5 h-3.5 text-purple-400" />
        TASKS
        {taskList.length > 0 && <span className="ml-auto text-purple-400">{taskList.length} active</span>}
        {hasQueue && <span className="text-yellow-500 text-[9px] ml-1">+{queueInfo!.queueDepth} queued</span>}
      </div>
      {taskList.length === 0 && !hasQueue ? (
        <div className="px-3 pb-3 text-gray-600 text-[10px] italic">No active tasks</div>
      ) : (
        <div className="max-h-48 overflow-y-auto px-2 pb-2 space-y-1">
          {taskList.map(task => (
            <TaskCard key={task.id} task={task} />
          ))}
          {/* Queue items */}
          {queueInfo?.queue.map((item, i) => (
            <div key={`q-${i}`} className="flex items-center gap-2 px-2.5 py-1.5 bg-[#1a1a1a] border border-dashed border-gray-700/40 rounded-lg">
              <span className="text-[8px] text-yellow-600 font-bold w-4 shrink-0">Q{i + 1}</span>
              <span className="text-[9px] text-gray-500 truncate">{item.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task }: { task: TaskInfo }) {
  const [expanded, setExpanded] = useState(false);
  const duration = formatDuration(task.startTime);
  const levelColors: Record<string, string> = {
    foreground: 'bg-purple-500',
    background: 'bg-cyan-500',
    default: 'bg-purple-500',
  };
  const dotColor = levelColors[task.taskType] || levelColors.default;

  return (
    <div className="bg-[#1a1a1a] border border-gray-700/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-2 hover:bg-gray-800 transition-colors text-left"
      >
        <span className={`w-2 h-2 ${dotColor} rounded-full animate-pulse shrink-0`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-gray-200 truncate font-medium">
              {task.description || task.taskType || 'Task'}
            </span>
            {task.taskType && (
              <span className={`text-[7px] px-1 rounded font-bold shrink-0 ${
                task.taskType === 'foreground' ? 'text-purple-400 bg-purple-900/30'
                : task.taskType === 'background' ? 'text-cyan-400 bg-cyan-900/30'
                : 'text-gray-500 bg-gray-800'
              }`}>
                {task.taskType === 'foreground' ? 'MAIN' : task.taskType === 'background' ? 'BG' : task.taskType}
              </span>
            )}
          </div>
          <div className="text-[8px] text-gray-500 mt-0.5">
            {duration}
            {task.lastToolName && ` · ${task.lastToolName}`}
          </div>
        </div>
        <ChevronRight className={`w-3 h-3 text-gray-600 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="px-2.5 pb-2 space-y-1">
          {task.summary && (
            <div className="text-[9px] text-gray-400 bg-[#0d0d0d] p-1.5 rounded border border-gray-800">
              {task.summary}
            </div>
          )}
          {task.usage && (
            <div className="flex gap-2 text-[8px] text-gray-600">
              {task.usage.durationMs && <span>{(task.usage.durationMs / 1000).toFixed(0)}s</span>}
              {task.usage.totalTokens && <span>{task.usage.totalTokens} tokens</span>}
              {task.usage.toolUses && <span>{task.usage.toolUses} tools</span>}
            </div>
          )}
          {task.taskType && (
            <div className="text-[8px] text-gray-700">
              Type: {task.taskType}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDuration(startTime: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return `${m}m ${s}s`;
}

// ==========================================
// Markdown helpers
// ==========================================
/** Collapse single newlines within paragraphs so short lines don't become separate <p>.
 *  Preserves code blocks (```), double-newlines (true paragraph breaks). */
function flattenMarkdown(text: string): string {
  const parts: string[] = [];
  let last = 0;
  const codeRe = /```[\s\S]*?```/g;
  let m: RegExpExecArray | null;
  while ((m = codeRe.exec(text)) !== null) {
    parts.push(text.slice(last, m.index));
    parts.push('\0CODE' + m[0] + '\0ENDCODE');
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  const out = parts.map((p, i) => {
    if (i % 2 === 1) return p; // code block – keep raw
    return p.split(/\n{2,}/).map(block => block.replace(/\n/g, ' ').trim()).join('\n\n');
  }).join('');
  return out.replace(/\0CODE/g, '').replace(/\0ENDCODE/g, '');
}

// ==========================================
// Session Continuation Context Bar
// ==========================================
function SystemContextBar({ userMsg }: { userMsg: Message }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border border-amber-700/30 bg-amber-950/10 rounded-lg my-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-[10px] text-amber-500/80 hover:text-amber-400 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span className="tracking-wider font-medium">SESSION CONTINUATION</span>
        <span className="text-amber-600/50 ml-auto">{userMsg.timestamp}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 text-[11px] text-gray-400 leading-relaxed max-h-64 overflow-y-auto border-t border-amber-800/20 pt-2">
          <MarkdownRenderer content={userMsg.content} />
        </div>
      )}
    </div>
  );
}

// ==========================================
// Markdown Renderer
// ==========================================
function MarkdownRenderer({ content }: { content: string }) {
  if (!content) return null;
  const flattened = flattenMarkdown(content);
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ node, inline, className, children, ...props }: any) {
          const codeText = String(children).replace(/\n$/, '');
          // Heuristic: treat short single-line code without language prefix as inline
          const isInline = inline || (!codeText.includes('\n') && !className?.startsWith('language-') && codeText.length < 100);
          if (isInline) {
            return <code className="bg-gray-800 px-1 py-0.5 rounded text-[11px] text-orange-200 whitespace-nowrap" {...props}>{children}</code>;
          }
          return (
            <pre className="bg-[#0a0a0a] border border-gray-800 p-2 rounded my-1 overflow-x-auto">
              <code className="text-[11px] leading-relaxed" {...props}>{children}</code>
            </pre>
          );
        },
        a({ href, children }: any) {
          return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline decoration-blue-800/50">{children}</a>;
        },
        p({ children }: any) {
          return <p className="mb-0 leading-relaxed">{children}</p>;
        },
        ul({ children }: any) {
          return <ul className="list-disc pl-4 mb-1 space-y-0.5">{children}</ul>;
        },
        ol({ children }: any) {
          return <ol className="list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>;
        },
        li({ children }: any) {
          return <li className="mb-0.5">{children}</li>;
        },
        h1({ children }: any) {
          return <h1 className="text-sm font-bold mb-1 mt-2 text-gray-100">{children}</h1>;
        },
        h2({ children }: any) {
          return <h2 className="text-xs font-bold mb-1 mt-2 text-gray-100">{children}</h2>;
        },
        h3({ children }: any) {
          return <h3 className="text-[11px] font-bold mb-1 mt-1 text-gray-200">{children}</h3>;
        },
        blockquote({ children }: any) {
          return <blockquote className="border-l-2 border-gray-700 pl-2 italic text-gray-400 mb-1">{children}</blockquote>;
        },
        hr() {
          return <hr className="border-gray-800 my-2" />;
        },
        table({ children }: any) {
          return <div className="overflow-x-auto"><table className="border-collapse border border-gray-700 text-[10px] mb-1 w-full">{children}</table></div>;
        },
        th({ children }: any) {
          return <th className="border border-gray-700 px-1.5 py-0.5 font-bold text-gray-200">{children}</th>;
        },
        td({ children }: any) {
          return <td className="border border-gray-700 px-1.5 py-0.5 text-gray-300">{children}</td>;
        },
        strong({ children }: any) {
          return <strong className="font-bold text-gray-100">{children}</strong>;
        },
        em({ children }: any) {
          return <em className="italic text-gray-200">{children}</em>;
        },
      }}
    >
      {flattened}
    </ReactMarkdown>
  );
}

