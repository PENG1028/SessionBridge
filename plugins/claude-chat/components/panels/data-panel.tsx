'use client';

import { useState, useMemo } from 'react';
import { FileCode, Folder, Database } from 'lucide-react';
import type { Turn, Block } from '../../types';

// ─── Props ──────────────────────────────────────────

interface DataPanelProps {
  turns: Turn[];
  projectCwd?: string;
}

// ─── Helpers ─────────────────────────────────────────

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit']);

function extractKnownFiles(turns: Turn[]): Map<string, 'file' | 'dir'> {
  const files = new Map<string, 'file' | 'dir'>();
  for (const turn of turns) {
    for (const asst of turn.assistantMsgs) {
      for (const block of asst.blocks) {
        if ((block.type === 'tool_use' || block.type === 'tool_result') && FILE_TOOLS.has(block.toolName)) {
          const parts = block.detail.replace(/\\/g, '/').split('/');
          parts.forEach((_, i) => {
            const p = parts.slice(0, i + 1).join('/');
            if (i === parts.length - 1) files.set(p, 'file');
            else files.set(p, 'dir');
          });
        }
      }
    }
  }
  return files;
}

// ─── Component ──────────────────────────────────────

export function DataPanel({ turns, projectCwd }: DataPanelProps) {
  const knownFiles = useMemo(() => extractKnownFiles(turns), [turns]);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  if (knownFiles.size === 0) {
    return (
      <div className="flex items-center justify-center py-12 px-4">
        <div className="text-center space-y-1">
          <Database className="w-6 h-6 text-gray-700 mx-auto" />
          <p className="text-[10px] text-gray-600">No reference data yet</p>
          <p className="text-[9px] text-gray-700">Files will appear as Claude interacts with them</p>
        </div>
      </div>
    );
  }

  const entries = Array.from(knownFiles.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, 100); // cap display

  const dirCount = entries.filter(e => e[1] === 'dir').length;
  const fileCount = entries.filter(e => e[1] === 'file').length;

  return (
    <div className="px-1 py-1 space-y-1">
      {/* Summary */}
      <div className="flex items-center gap-3 px-2.5 py-1.5 text-[10px] text-gray-500">
        <span className="flex items-center gap-1"><Folder className="w-3 h-3" />{dirCount} dirs</span>
        <span className="flex items-center gap-1"><FileCode className="w-3 h-3" />{fileCount} files</span>
      </div>

      {/* File/dir list */}
      <div className="space-y-px">
        {entries.map(([path, type]) => (
          <div
            key={path}
            className={`flex items-center gap-2 px-2.5 py-1 rounded transition-colors cursor-pointer ${
              expandedFile === path ? 'bg-gray-800/80' : 'hover:bg-gray-800/40'
            }`}
            onClick={() => setExpandedFile(expandedFile === path ? null : path)}
          >
            {type === 'dir'
              ? <Folder className="w-3 h-3 text-yellow-600/70 shrink-0" />
              : <FileCode className="w-3 h-3 text-blue-500/70 shrink-0" />
            }
            <code className="text-[10px] text-gray-400 min-w-0 truncate">{path}</code>
            {type === 'file' && (
              <span className="text-[8px] text-gray-700 shrink-0 ml-auto">file</span>
            )}
          </div>
        ))}
      </div>

      {knownFiles.size > 100 && (
        <p className="text-[9px] text-gray-700 text-center pt-1">
          + {knownFiles.size - 100} more entries
        </p>
      )}
    </div>
  );
}
