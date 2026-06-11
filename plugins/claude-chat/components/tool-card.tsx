'use client';

import { useState } from 'react';
import { ChevronRight, Terminal, Eye, Search, FileCode, Globe, AlertCircle } from 'lucide-react';
import type { Block } from '../types';
import { getIcon } from '../markdown';

// ─── Tool registration ──────────────────────────────

interface ToolTheme {
  label: string;
  badgeClass: string;
}

const TOOL_THEMES: Record<string, ToolTheme> = {
  Read:        { label: 'Read',    badgeClass: 'bg-blue-500/10 text-blue-400' },
  Glob:        { label: 'Glob',    badgeClass: 'bg-cyan-500/10 text-cyan-400' },
  Grep:        { label: 'Grep',    badgeClass: 'bg-cyan-500/10 text-cyan-400' },
  Bash:        { label: 'Bash',    badgeClass: 'bg-neutral-700 text-neutral-200' },
  PowerShell:  { label: 'PS',      badgeClass: 'bg-neutral-700 text-neutral-200' },
  Edit:        { label: 'Edit',    badgeClass: 'bg-emerald-500/10 text-emerald-400' },
  Write:       { label: 'Write',   badgeClass: 'bg-emerald-500/10 text-emerald-400' },
  WebSearch:   { label: 'Search',  badgeClass: 'bg-purple-500/10 text-purple-400' },
  WebFetch:    { label: 'Fetch',   badgeClass: 'bg-purple-500/10 text-purple-400' },
};

function getToolTheme(toolName: string): ToolTheme {
  return TOOL_THEMES[toolName] || { label: toolName, badgeClass: 'bg-gray-800 text-gray-400' };
}

// ─── Props ──────────────────────────────────────────

interface ToolCardProps {
  block: Block;
  /** Called when output area is toggled */
  onToggleOutput?: (blockId: string) => void;
  expandedOutputs?: Set<string>;
}

// ─── Component ──────────────────────────────────────

export function ToolCard({ block, onToggleOutput, expandedOutputs }: ToolCardProps) {
  const [expanded, setExpanded] = useState(false);
  const theme = getToolTheme(block.toolName);
  const isRunning = block.status === 'running';
  const isError = block.status === 'error';
  const isDone = !isRunning && !isError;
  const outputExpanded = expandedOutputs?.has(block.id) || false;

  // Parse command from toolArgs for display
  const commandText = block.toolName === 'Bash' || block.toolName === 'PowerShell'
    ? (() => {
        try {
          const p = JSON.parse(block.toolArgs);
          return p.command || block.toolArgs;
        } catch { return block.toolArgs; }
      })()
    : block.toolArgs;

  const hasOutput = !!block.output;
  const hasArgs = !!block.toolArgs;

  return (
    <div className="rounded-lg border border-gray-800 overflow-hidden bg-neutral-900/50">
      {/* ── Header (always visible, clickable) ── */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none hover:bg-neutral-800/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight className={`w-3 h-3 text-gray-500 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />

        {/* Icon */}
        <span className="w-4 h-4 flex items-center justify-center shrink-0 text-gray-500">
          {getIcon(block.toolName)}
        </span>

        {/* Tool name badge */}
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${theme.badgeClass}`}>
          {theme.label}
        </span>

        {/* Semantic label */}
        <span className="text-[11px] text-gray-400 min-w-0 truncate hidden sm:inline">
          {block.semantic}
        </span>

        {/* Detail (file path / command / query) */}
        {block.detail && (
          <code className="text-[10px] text-gray-600 truncate max-w-[200px] min-w-0 hidden sm:block" title={block.detail}>
            {block.detail}
          </code>
        )}

        {/* Exit code for Bash */}
        {block.toolName === 'Bash' && block.exitCode >= 0 && (
          <span className={`text-[8px] px-1 rounded font-bold shrink-0 ${
            block.exitCode === 0 ? 'text-emerald-600 bg-emerald-900/20' : 'text-red-400 bg-red-900/20'
          }`}>
            {block.exitCode === 0 ? '✓' : `exit: ${block.exitCode}`}
          </span>
        )}

        {/* Status dot */}
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            isRunning ? 'bg-purple-500 animate-pulse' : isError ? 'bg-red-500' : 'bg-emerald-500'
          }`} />
          <span className={`text-[10px] font-medium ${
            isRunning ? 'text-purple-400' : isError ? 'text-red-400' : 'text-emerald-400'
          }`}>
            {isRunning ? 'Running' : isError ? 'Error' : 'Done'}
          </span>
        </span>
      </div>

      {/* ── Expanded body ── */}
      {expanded && (
        <div className="border-t border-gray-800">
          {/* Input args */}
          {hasArgs && (
            <div className="px-3 py-2 bg-neutral-950/50 border-b border-gray-800">
              <div className="text-[9px] text-gray-600 font-semibold tracking-wider uppercase mb-1">Input</div>
              <pre className="text-[11px] text-gray-400 font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                {block.toolName === 'Bash' || block.toolName === 'PowerShell'
                  ? `$ ${commandText}`
                  : (() => {
                      try { return JSON.stringify(JSON.parse(block.toolArgs), null, 2); }
                      catch { return block.toolArgs; }
                    })()
                }
              </pre>
            </div>
          )}

          {/* Result / Output */}
          {hasOutput && (
            <div className="px-3 py-2 bg-neutral-950">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] text-gray-600 font-semibold tracking-wider uppercase">
                  {isError ? 'Error' : 'Result'}
                </span>
                {/* Toggle expand/collapse for long output */}
                {block.output.length > 200 && onToggleOutput && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleOutput(block.id); }}
                    className="text-[9px] text-gray-600 hover:text-gray-400 transition-colors"
                  >
                    {outputExpanded ? 'Collapse' : 'Show all'}
                  </button>
                )}
              </div>
              <pre className={`text-[11px] font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto ${
                isError ? 'text-red-400' : 'text-gray-400'
              }`}>
                {outputExpanded ? block.output : block.output.slice(0, 2000)}
                {block.output.length > 2000 && !outputExpanded && (
                  <span className="text-gray-700">... ({block.output.length - 2000} more chars)</span>
                )}
              </pre>
            </div>
          )}

          {/* No output placeholder */}
          {!hasOutput && !isRunning && (
            <div className="px-3 py-2 bg-neutral-950 text-gray-700 text-[10px] italic">
              No output
            </div>
          )}
        </div>
      )}
    </div>
  );
}
