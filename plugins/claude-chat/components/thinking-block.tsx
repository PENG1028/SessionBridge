'use client';

import { useState } from 'react';
import { Sparkles, ChevronRight } from 'lucide-react';
import type { Block } from '../types';

interface ThinkingBlockProps {
  block: Block;
}

export function ThinkingBlock({ block }: ThinkingBlockProps) {
  const [collapsed, setCollapsed] = useState(true);
  const isRunning = block.status === 'running';

  return (
    <div className="rounded-lg border border-purple-900/30 bg-purple-950/[0.04] overflow-hidden">
      {/* ── Toggle header ── */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-1.5 transition-colors hover:bg-purple-950/[0.08] select-none"
      >
        <ChevronRight className={`w-3 h-3 text-purple-500/60 shrink-0 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
        <Sparkles className="w-3 h-3 text-purple-500/60 shrink-0" />
        <span className="text-[10px] font-medium text-purple-400/80">
          {collapsed ? 'Show' : 'Hide'} thinking
        </span>
        {isRunning && (
          <span className="flex items-center gap-1 text-[10px] text-purple-400">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
            Analyzing...
          </span>
        )}
        {!isRunning && (
          <span className="text-[10px] text-gray-600">Analysis done</span>
        )}
      </button>

      {/* ── Content ── */}
      {!collapsed && (
        <div className="px-3 pb-2 pl-9 border-t border-purple-900/20 pt-1.5">
          <pre className="text-[11px] text-gray-400 font-mono whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
            {block.content || <span className="text-gray-700 italic">(empty)</span>}
          </pre>
        </div>
      )}
    </div>
  );
}
