'use client';

import { useState, useRef, useEffect } from 'react';

// ─── Types (mirrors page.tsx — kept local per "split only, no refactor") ──

interface Block {
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

export function useHistoryLoader(
  projectInfo: { cwd: string; projectName: string } | null,
  serverBlocks: any[],
  addLog: (msg: string) => void,
  setMessagesBySession: React.Dispatch<React.SetStateAction<Record<string, Message[]>>>,
) {
  const historyLoadedRef = useRef(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyCutoffRef = useRef(0);
  const processedRef = useRef(0);
  const [activeExternalSession, setActiveExternalSession] = useState<string | null>(null);

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
    // No localStorage fallback — App UI no longer calls /api/sessions/current.
    // Mark history as loaded so subsequent renders don't re-trigger.
    setHistoryLoading(true);
    Promise.resolve().then(() => {
      if (!historyLoadedRef.current) {
        historyLoadedRef.current = true;
        addLog('[System] No local history found');
      }
      setHistoryLoading(false);
    });
  }, [projectInfo?.cwd, addLog]);

  return {
    historyLoadedRef,
    historyLoading,
    historyCutoffRef,
    processedRef,
    activeExternalSession,
    setActiveExternalSession,
  };
}
