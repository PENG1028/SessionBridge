'use client';

import { useState, useMemo } from 'react';
import { FileCode, ChevronRight } from 'lucide-react';
import type { Turn, Block } from '../../types';

// ─── Props ──────────────────────────────────────────

interface FileListProps {
  turns: Turn[];
}

// ─── Helpers ─────────────────────────────────────────

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit']);

interface FileOp {
  block: Block;
  turnIndex: number;
}

function extractFileOps(turns: Turn[]): FileOp[] {
  const ops: FileOp[] = [];
  for (const [ti, turn] of turns.entries()) {
    for (const asst of turn.assistantMsgs) {
      for (const block of asst.blocks) {
        if ((block.type === 'tool_use' || block.type === 'tool_result') && FILE_TOOLS.has(block.toolName)) {
          ops.push({ block, turnIndex: ti });
        }
      }
    }
  }
  return ops;
}

// ─── Component ──────────────────────────────────────

export function FileList({ turns }: FileListProps) {
  const fileOps = useMemo(() => extractFileOps(turns), [turns]);

  if (fileOps.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 px-4">
        <div className="text-center space-y-1">
          <FileCode className="w-6 h-6 text-gray-700 mx-auto" />
          <p className="text-[10px] text-gray-600">No file operations yet</p>
        </div>
      </div>
    );
  }

  // Group by filename
  const grouped = useMemo(() => {
    const map = new Map<string, FileOp[]>();
    for (const op of fileOps) {
      const filename = op.block.detail || 'unknown';
      const existing = map.get(filename) || [];
      existing.push(op);
      map.set(filename, existing);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [fileOps]);

  return (
    <div className="space-y-px px-1 py-1">
      {grouped.map(([filename, ops]) => (
        <FileGroup key={filename} filename={filename} ops={ops} />
      ))}
    </div>
  );
}

// ─── FileGroup ───────────────────────────────────────

function FileGroup({ filename, ops }: { filename: string; ops: FileOp[] }) {
  const [expanded, setExpanded] = useState(false);

  const actionBadge = (toolName: string) => {
    switch (toolName) {
      case 'Read':  return <span className="text-[9px] text-blue-400 font-medium">R</span>;
      case 'Write': return <span className="text-[9px] text-emerald-400 font-medium">W</span>;
      case 'Edit':  return <span className="text-[9px] text-amber-400 font-medium">E</span>;
      default:      return <span className="text-[9px] text-gray-500">?</span>;
    }
  };

  // Latest operation for the header
  const latest = ops[ops.length - 1];
  const latestContent = latest.block.output || '';

  return (
    <div
      className={`rounded transition-colors cursor-pointer ${expanded ? 'bg-gray-800/80' : 'hover:bg-gray-800/40'}`}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 py-1.5">
        <ChevronRight className={`w-2.5 h-2.5 text-gray-600 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        <FileCode className="w-3 h-3 text-blue-500/70 shrink-0" />
        <code className="text-[10px] text-gray-300 min-w-0 truncate" title={filename}>
          {filename.split('/').pop() || filename}
        </code>
        {/* Action badges */}
        <div className="flex items-center gap-0.5 ml-auto shrink-0">
          {Array.from(new Set(ops.map(o => o.block.toolName))).map(tn => (
            <span key={tn} className="ml-0.5">{actionBadge(tn)}</span>
          ))}
          <span className="text-[9px] text-gray-600 ml-1">{ops.length}</span>
        </div>
      </div>

      {/* Expanded — show content previews */}
      {expanded && latestContent && (
        <div className="px-2.5 pb-2">
          <pre className="text-[10px] font-mono text-gray-400 whitespace-pre-wrap break-all max-h-24 overflow-y-auto bg-neutral-950 rounded p-1.5">
            {latestContent.slice(0, 300)}
            {latestContent.length > 300 && <span className="text-gray-700">...</span>}
          </pre>
        </div>
      )}
    </div>
  );
}
