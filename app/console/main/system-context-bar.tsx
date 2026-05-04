'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { MarkdownRenderer } from './markdown-renderer';

export function SystemContextBar({ userMsg }: { userMsg: { content: string; timestamp: string } }) {
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
