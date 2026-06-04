'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { sessionStore } from '../../../lib/session-store';

// ─── Types shared across hooks ──────────────────────────────────

export interface Block {
  id: string;
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'unknown';
  semantic: string;
  toolName: string;
  detail: string;
  output: string;
  toolArgs: string;
  status: 'running' | 'done' | 'error';
  exitCode: number;
  content: string;
  expanded: boolean;
  rawData: string;
  isComplete?: boolean;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  blocks: Block[];
  isPending: boolean;
  isCompactSummary?: boolean;
}

export type Phase = 'idle' | 'running' | 'done' | 'error';

// ─── Helpers ────────────────────────────────────────────────────

function toAppMessages(sessionId: string, msgs: import('../../../lib/session-store').Message[]): Message[] {
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

function toStorageMessages(msgs: Message[]): import('../../../lib/session-store').Message[] {
  return msgs.map(m => ({
    role: m.role,
    content: m.content,
    timestamp: Date.parse(m.timestamp) || Date.now(),
    blocks: m.blocks as import('../../../lib/session-store').Block[],
  }));
}

const getTime = () => {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
};

// ─── Hook ───────────────────────────────────────────────────────

export function useMessageSessions(
  projectInfo: { cwd: string; projectName: string } | null,
  isWorkspace: boolean,
  activeSessionId: string | null | undefined,
  activeInstanceId: string | null | undefined,
  addLog: (msg: string) => void,
  sendCommand: (cmd: string, args?: Record<string, unknown>) => void,
) {
  const [messagesBySession, setMessagesBySession] = useState<Record<string, Message[]>>({});
  const [isRestoring, setIsRestoring] = useState(true);
  const [snapshots, setSnapshots] = useState<{id: string; name: string; msgs: Message[]; ts: string}[]>([]);
  const messagesCacheRef = useRef<Record<string, Message[]>>({});

  // Session key derivation
  const sessionKey = isWorkspace
    ? (activeSessionId || 'default')
    : activeInstanceId
      ? activeInstanceId
      : (projectInfo?.cwd ? projectInfo.cwd.replace(/[/\\:]/g, '_') : 'default');

  const messages = messagesBySession[sessionKey] || [];

  // Restore messages from IndexedDB on mount
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

  // Persist messages to IndexedDB (debounced)
  const idbDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isRestoring) return;
    if (idbDebounceRef.current) clearTimeout(idbDebounceRef.current);
    idbDebounceRef.current = setTimeout(() => {
      try {
        localStorage.setItem('bridge-messages', JSON.stringify(messagesBySession));
      } catch (_e) { /* localStorage quota — safe to ignore */ }
      for (const [sid, msgs] of Object.entries(messagesBySession)) {
        if (msgs.length > 0) {
          sessionStore.replaceMessages(sid, toStorageMessages(msgs)).catch(() => {});
        }
      }
    }, 500);
    return () => { if (idbDebounceRef.current) clearTimeout(idbDebounceRef.current); };
  }, [messagesBySession, isRestoring]);

  // Persist messages to localStorage (fast path, longer debounce)
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
      } catch (_e) { /* localStorage quota — safe to ignore */ }
    }, 2000);
    return () => { if (persistTimerRef.current) clearTimeout(persistTimerRef.current); };
  }, [messagesBySession]);

  const updateSession = useCallback((session: string, updater: (prev: Message[]) => Message[]) => {
    setMessagesBySession(prev => {
      const current = prev[session] || [];
      const updated = updater(current);
      if (!messagesCacheRef.current[session]) messagesCacheRef.current[session] = [];
      messagesCacheRef.current[session] = updated;
      return { ...prev, [session]: updated };
    });
  }, []);

  const handleNewSession = useCallback(() => {
    const sk = sessionKey;
    updateSession(sk, () => []);
    sessionStore.clearMessages(sk).catch(() => {});
    try {
      const cached = JSON.parse(localStorage.getItem('bridge-messages') || '{}');
      delete cached[sk];
      localStorage.setItem('bridge-messages', JSON.stringify(cached));
    } catch (_e) { /* localStorage quota — safe to ignore */ }
    try { localStorage.removeItem('sessionbridge-active-session'); } catch (_e) { /* localStorage quota — safe to ignore */ }
    addLog('[System] Session cleared — started fresh');
  }, [updateSession, addLog, sessionKey]);

  // ── Snapshots ──────────────────────────────────────────────

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
    addLog(`[System] Snapshot loaded: ${snap.name}`);
  }, [snapshots, sessionKey, updateSession, addLog]);

  const forkFromSnapshot = useCallback((snapshotId: string, processedRef?: React.MutableRefObject<number>) => {
    const snap = snapshots.find(s => s.id === snapshotId);
    if (!snap) return;
    saveSnapshot('Auto-save before fork');
    loadSnapshot(snapshotId);
    addLog(`[System] Forked from snapshot: ${snap.name}`);
    if (processedRef) processedRef.current = 0;
    sendCommand('clear');
  }, [snapshots, saveSnapshot, loadSnapshot, addLog, sendCommand]);

  // ── Known files derived from messages ──────────────────────

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

  return {
    messagesBySession,
    setMessagesBySession,
    messages,
    sessionKey,
    updateSession,
    handleNewSession,
    isRestoring,
    snapshots,
    saveSnapshot,
    loadSnapshot,
    forkFromSnapshot,
    knownFiles,
    messagesCacheRef,
  };
}
