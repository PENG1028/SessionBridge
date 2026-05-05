import { useEffect } from 'react';
import { getSemantic } from '../shared/tool-constants';

// ── Local types (minimal, used only within this hook) ──
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
  cost?: string;
  tokens?: any;
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

type Phase = 'idle' | 'running' | 'done' | 'error';

interface ToolActivity {
  id: string;
  toolName: string;
  detail: string;
  semantic: string;
  status: 'running' | 'done' | 'error';
}

interface TaskInfo {
  id: string;
  description: string;
  taskType: string;
  startTime: number;
  lastToolName?: string;
  summary?: string;
  usage?: { totalTokens?: number; toolUses?: number; durationMs?: number };
}

// ── Pure helpers ──
const getTime = () => {
  const now = new Date();
  return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
};

const genId = () => Math.random().toString(36).substring(2, 11);

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

// ── Hook config ──
export interface UseBlockProcessorConfig {
  serverBlocks: any[];
  sessionKey: string;
  updateSession: (key: string, updater: (prev: Message[]) => Message[]) => void;
  processedRef: React.MutableRefObject<number>;
  historyCutoffRef: React.MutableRefObject<number>;
  setToolActivities: React.Dispatch<React.SetStateAction<Map<string, ToolActivity>>>;
  setPhase: (p: Phase) => void;
  setCurrentActivity: (a: string | null) => void;
  addLog: (msg: string) => void;
  setActiveTasks: React.Dispatch<React.SetStateAction<Map<string, TaskInfo>>>;
  /** Optional: fire app notification for task lifecycle events */
  onNotify?: (n: { type: 'info' | 'success' | 'warning' | 'error'; title: string; message?: string }) => void;
}

export function useBlockProcessor({
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
  onNotify,
}: UseBlockProcessorConfig) {
  useEffect(() => {
    try {
      if (serverBlocks.length <= processedRef.current) return;
      const newBlocks = serverBlocks.slice(processedRef.current);
      processedRef.current = serverBlocks.length;

      for (const raw of newBlocks) {
        const block = raw as any;
        const bType = block.blockType || '';
        const sk = block.sessionId || sessionKey;

        if (historyCutoffRef.current > 0 && block.ts && block.ts < historyCutoffRef.current) {
          continue;
        }

        // ── User input ─────────────────────
        if (bType === 'user') {
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
            setToolActivities(prev => {
              const next = new Map(prev);
              for (const [id, act] of next) {
                if (act.status === 'running') next.set(id, { ...act, status: 'done' });
              }
              return next;
            });
          }
          addLog(`[System] ✓ ${block.text || 'Task completed'}`);
          onNotify?.({ type: 'success', title: 'Task completed', message: block.text });
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
          onNotify?.({ type: 'info', title: 'Background task started', message: block.description });
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
          onNotify?.({ type: 'success', title: 'Background task done', message: block.taskId });
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
}
