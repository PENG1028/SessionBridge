// ─── Session Persistence React Hooks ─────────────────────────

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { sessionStore, LS_MESSAGES_CACHE, type Message } from './session-store';

/**
 * Hook that restores messages from IndexedDB on mount and
 * debounce-writes to both localStorage (fast path) and
 * IndexedDB (complete path) on change.
 */
export function useSessionPersistence(
  messagesBySession: Record<string, Message[]>,
  setMessagesBySession: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>
) {
  const [isRestoring, setIsRestoring] = useState(true);

  // Restore on mount
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

  // Debounced persist
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isRestoring) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Fast path: full-map localStorage cache
      try {
        localStorage.setItem(LS_MESSAGES_CACHE, JSON.stringify(messagesBySession));
      } catch (_e) { /* quota exceeded */ }
      // Complete path: per-session IndexedDB writes
      for (const [sid, msgs] of Object.entries(messagesBySession)) {
        if (msgs.length > 0) {
          sessionStore.replaceMessages(sid, msgs).catch(() => {});
        }
      }
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [messagesBySession, isRestoring]);

  return { isRestoring };
}

/**
 * Hook for active session ID stored in localStorage.
 */
export function useActiveSession() {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setActiveId(sessionStore.getActiveSessionId());
  }, []);

  const setActive = useCallback((id: string | null) => {
    sessionStore.setActiveSessionId(id);
    setActiveId(id);
  }, []);

  return [activeId, setActive] as const;
}
