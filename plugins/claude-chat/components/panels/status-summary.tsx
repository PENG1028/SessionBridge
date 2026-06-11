'use client';

import { useMemo } from 'react';
import { Activity } from 'lucide-react';
import type { TokenStats, Turn } from '../../types';

// ─── Props ──────────────────────────────────────────

interface StatusSummaryProps {
  turns: Turn[];
  logs: string[];
}

// ─── Helpers ─────────────────────────────────────────

function parseTokenStats(logs: string[]): TokenStats | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const line = logs[i];
    if (line.startsWith('[Tokens]')) {
      try {
        const jsonStr = line.slice('[Tokens] '.length);
        const data = JSON.parse(jsonStr);
        return {
          inputTokens: data.tokens?.input || data.input || data.inputTokens,
          outputTokens: data.tokens?.output || data.output || data.outputTokens,
          cacheReadTokens: data.tokens?.cacheRead || data.cacheRead || data.cacheReadTokens,
          cacheWriteTokens: data.tokens?.cacheWrite || data.cacheWrite || data.cacheWriteTokens,
          cost: data.cost ?? data.totalCost,
        };
      } catch { /* parse fail — skip */ }
    }
  }
  return null;
}

function fmt(n: number | undefined): string {
  if (n == null) return '-';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ─── Component ──────────────────────────────────────

export function StatusSummary({ turns, logs }: StatusSummaryProps) {
  const stats = useMemo(() => parseTokenStats(logs), [logs]);
  const messageCount = useMemo(() => {
    let count = 0;
    for (const turn of turns) {
      count += turn.assistantMsgs.length;
    }
    return count;
  }, [turns]);

  if (!stats && turns.length === 0) return null;

  return (
    <div className="px-3 py-2 border-b border-gray-800 bg-neutral-950/30 space-y-1.5">
      {/* Title */}
      <div className="flex items-center gap-1.5 text-[9px] text-gray-600 uppercase tracking-wider font-semibold">
        <Activity className="w-3 h-3" />
        Session Stats
      </div>

      {/* Stats rows */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {stats?.inputTokens != null && (
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-gray-600">Input</span>
            <span className="text-[10px] font-mono font-semibold text-blue-400 tabular-nums">{fmt(stats.inputTokens)}</span>
          </div>
        )}
        {stats?.outputTokens != null && (
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-gray-600">Output</span>
            <span className="text-[10px] font-mono font-semibold text-emerald-400 tabular-nums">{fmt(stats.outputTokens)}</span>
          </div>
        )}
        {stats?.cacheReadTokens != null && (
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-gray-600">Cache R</span>
            <span className="text-[10px] font-mono font-semibold text-purple-400 tabular-nums">{fmt(stats.cacheReadTokens)}</span>
          </div>
        )}
        {stats?.cacheWriteTokens != null && (
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-gray-600">Cache W</span>
            <span className="text-[10px] font-mono font-semibold text-purple-400 tabular-nums">{fmt(stats.cacheWriteTokens)}</span>
          </div>
        )}
        {stats?.cost != null && (
          <div className="flex items-center justify-between col-span-2">
            <span className="text-[9px] text-gray-600">Cost</span>
            <span className="text-[10px] font-mono font-semibold text-amber-400 tabular-nums">${stats.cost.toFixed(4)}</span>
          </div>
        )}
        <div className="flex items-center justify-between col-span-2 pt-1 border-t border-gray-800/50">
          <span className="text-[9px] text-gray-600">Messages</span>
          <span className="text-[10px] font-mono text-gray-400 tabular-nums">{turns.length} turns</span>
        </div>
      </div>
    </div>
  );
}
