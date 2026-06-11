'use client';

import { useState } from 'react';
import { ChevronRight, FileCode } from 'lucide-react';
import type { Block } from '../types';

interface FileEntryProps {
  block: Block;
}

const FILE_ACTION_STYLES: Record<string, { label: string; cls: string }> = {
  Read:  { label: 'Read',  cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  Write: { label: 'Write', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  Edit:  { label: 'Edit',  cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
};

export function FileEntry({ block }: FileEntryProps) {
  const [expanded, setExpanded] = useState(false);
  const style = FILE_ACTION_STYLES[block.toolName] || { label: block.toolName, cls: 'bg-gray-800 text-gray-400 border-gray-800' };
  const filename = block.detail || 'unknown';
  const content = block.output || '';
  const isError = block.status === 'error';

  return (
    <div className={`rounded-lg border ${isError ? 'border-red-500/20' : 'border-gray-800'} overflow-hidden bg-neutral-900/50`}>
      {/* ── Header ── */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-neutral-800/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight className={`w-3 h-3 text-gray-500 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <FileCode className="w-3.5 h-3.5 text-blue-500/70 shrink-0" />
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${style.cls}`}>
          {style.label}
        </span>
        <code className="text-[11px] text-gray-300 min-w-0 truncate" title={filename}>
          {filename}
        </code>
        {isError && (
          <span className="text-[9px] text-red-400 font-medium shrink-0">Error</span>
        )}
      </div>

      {/* ── Expanded content ── */}
      {expanded && content && (
        <div className="border-t border-gray-800 bg-neutral-950">
          <pre className="px-3 py-2 text-[11px] text-gray-400 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}
