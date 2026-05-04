'use client';

import { useState } from 'react';
import { Terminal, ChevronRight } from 'lucide-react';

// ─── Types ─────────────────────────────────────────────────

export interface TaskInfo {
  id: string;
  description: string;
  taskType: string;
  startTime: number;
  lastToolName?: string;
  summary?: string;
  usage?: { totalTokens?: number; toolUses?: number; durationMs?: number };
}

// ─── Helpers ───────────────────────────────────────────────

function formatDuration(startTime: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  return `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`;
}

// ─── TaskCard ──────────────────────────────────────────────

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
        </div>
      )}
    </div>
  );
}

// ─── TaskPanel ─────────────────────────────────────────────

export function TaskPanel({ tasks, queueInfo }: {
  tasks: Map<string, TaskInfo>;
  queueInfo?: { isProcessing: boolean; queueDepth: number; queue: { text: string }[] };
}) {
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
