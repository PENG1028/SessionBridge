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

// ─── Helpers ──────────────────────────────────────────────────

const getTime = () => {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
};

const genId = () => Math.random().toString(36).substring(2, 11);

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
          id: genId(), type: 'tool_use', semantic: name,
          toolName: name, detail, output: b.output || '', toolArgs: b.input || '',
          status: 'done', exitCode: 0, content: '', expanded: false, rawData: '',
        });
        break;
      }
      case 'tool_result':
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

  return {
    historyLoadedRef,
    historyLoading,
    historyCutoffRef,
    processedRef,
    activeExternalSession,
    setActiveExternalSession,
  };
}
