'use client';

import { useState, useMemo } from 'react';
import { Terminal, Eye, Search, FileCode, Globe, AlertCircle, ChevronRight } from 'lucide-react';
import type { Turn, Block } from '../../types';
import { getIcon } from '../../markdown';

// ─── Props ──────────────────────────────────────────

interface ToolListProps {
  turns: Turn[];
}

// ─── Helpers ─────────────────────────────────────────

function extractToolBlocks(turns: Turn[]): Array<Block & { turnIndex: number }> {
  const blocks: Array<Block & { turnIndex: number }> = [];
  for (const [ti, turn] of turns.entries()) {
    for (const asst of turn.assistantMsgs) {
      for (const block of asst.blocks) {
        if (block.type === 'tool_use' || block.type === 'tool_result') {
          if (!blocks.some(b => b.id === block.id)) {
            blocks.push({ ...block, turnIndex: ti });
          }
        }
      }
    }
  }
  return blocks.sort((a, b) => a.id.localeCompare(b.id));
}

// ─── Component ──────────────────────────────────────

export function ToolList({ turns }: ToolListProps) {
  const blocks = useMemo(() => extractToolBlocks(turns), [turns]);

  if (blocks.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 px-4">
        <div className="text-center space-y-1">
          <Terminal className="w-6 h-6 text-gray-700 mx-auto" />
          <p className="text-[10px] text-gray-600">No tool calls yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-px px-1 py-1">
      {blocks.map(block => (
        <ToolRow key={block.id} block={block} />
      ))}
    </div>
  );
}

// ─── ToolRow ─────────────────────────────────────────

function ToolRow({ block }: { block: Block & { turnIndex: number } }) {
  const [expanded, setExpanded] = useState(false);
  const isRunning = block.status === 'running';
  const isError = block.status === 'error';

  return (
    <div
      className={`rounded transition-colors cursor-pointer ${expanded ? 'bg-gray-800/80' : 'hover:bg-gray-800/40'}`}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <ChevronRight className={`w-2.5 h-2.5 text-gray-600 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <span className="w-3 h-3 flex items-center justify-center shrink-0 text-gray-500">
          {getIcon(block.toolName)}
        </span>
        <span className="text-[10px] font-mono text-gray-300 min-w-0 truncate">{block.toolName}</span>
        {block.detail && (
          <code className="text-[9px] text-gray-600 truncate max-w-[120px] min-w-0">{block.detail}</code>
        )}
        <span className={`ml-auto text-[9px] font-medium shrink-0 ${
          isRunning ? 'text-purple-400' : isError ? 'text-red-400' : 'text-emerald-400'
        }`}>
          {isRunning ? '●' : isError ? '✗' : '✓'}
        </span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-2.5 pb-2 space-y-1">
          {block.toolArgs && (
            <div>
              <span className="text-[9px] text-gray-600 block mb-0.5">Input</span>
              <pre className="text-[10px] font-mono text-gray-400 whitespace-pre-wrap break-all max-h-24 overflow-y-auto bg-neutral-950 rounded p-1.5">
                {(() => {
                  try { return JSON.stringify(JSON.parse(block.toolArgs), null, 2); }
                  catch { return block.toolArgs; }
                })()}
              </pre>
            </div>
          )}
          {block.output && (
            <div>
              <span className="text-[9px] text-gray-600 block mb-0.5">Output</span>
              <pre className="text-[10px] font-mono text-gray-400 whitespace-pre-wrap break-all max-h-24 overflow-y-auto bg-neutral-950 rounded p-1.5">
                {block.output.slice(0, 500)}
                {block.output.length > 500 && <span className="text-gray-700">... ({block.output.length - 500} more)</span>}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
