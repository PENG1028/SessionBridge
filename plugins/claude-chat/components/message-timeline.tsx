'use client';

import { AlertCircle, GitBranch } from 'lucide-react';
import { SystemContextBar } from '../../../sdk/components';
import { MarkdownRenderer, getIcon } from '../markdown';
import { ToolCard } from './tool-card';
import { ThinkingBlock } from './thinking-block';
import { FileEntry } from './file-entry';
import type { Turn, Block } from '../types';

// ─── Props ──────────────────────────────────────────

interface MessageTimelineProps {
  turns: Turn[];
  phase: string;
  connStatus: { status: string };
  isRestoring: boolean;
  historyLoading: boolean;
  onFork?: (turnIndex: number) => void;
  onToggleOutput?: (blockId: string) => void;
  expandedOutputs?: Set<string>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  endRef: React.RefObject<HTMLDivElement | null>;
  /** Passed from parent — sticky user header needs this for z-index */
}

// ─── Helpers ─────────────────────────────────────────

function isToolBlock(b: Block): boolean {
  return b.type === 'tool_use' || b.type === 'tool_result';
}

function isThinkingBlock(b: Block): boolean {
  return b.type === 'thinking';
}

function isTextBlock(b: Block): boolean {
  return b.type === 'text';
}

function isFileBlock(b: Block): boolean {
  return b.type === 'tool_use' || b.type === 'tool_result' &&
    (b.toolName === 'Read' || b.toolName === 'Write' || b.toolName === 'Edit');
}

// ─── Component ──────────────────────────────────────

export function MessageTimeline({
  turns, phase, connStatus, isRestoring, historyLoading,
  onFork, onToggleOutput, expandedOutputs,
  scrollRef, endRef,
}: MessageTimelineProps) {

  // ── Empty states ──
  if (isRestoring) {
    return (
      <div className="flex-1 overflow-y-auto min-h-0" ref={scrollRef}>
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-gray-600 text-xs space-y-2">
            <div className="w-8 h-8 mx-auto relative">
              <div className="absolute inset-0 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
            </div>
            <p className="text-purple-400 animate-pulse">Restoring session...</p>
          </div>
        </div>
        <div ref={endRef} />
      </div>
    );
  }

  if (turns.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto min-h-0" ref={scrollRef}>
        <div className="flex items-center justify-center h-full">
          <div className="text-center text-gray-600 text-xs space-y-2">
            {historyLoading ? (
              <>
                <div className="w-8 h-8 mx-auto relative">
                  <div className="absolute inset-0 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                </div>
                <p className="text-blue-400 animate-pulse">Loading history...</p>
                <p className="text-gray-700 text-[10px]">Restoring previous conversation</p>
              </>
            ) : phase === 'running' ? (
              <>
                <div className="w-8 h-8 mx-auto relative">
                  <div className="absolute inset-0 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
                </div>
                <p className="text-purple-500 animate-pulse">Connecting to Claude...</p>
                <p className="text-gray-700 text-[10px]">Waiting for response</p>
              </>
            ) : connStatus.status !== 'connected' ? (
              <>
                <div className="w-2 h-2 mx-auto bg-red-500 rounded-full" />
                <p className="text-red-400">Disconnected</p>
                <p className="text-gray-700 text-[10px]">Check connection</p>
              </>
            ) : (
              <>
                <p className="text-gray-500">Awaiting instructions</p>
                <p className="text-gray-700 text-[10px]">Type a message or use Quick Actions</p>
              </>
            )}
          </div>
        </div>
        <div ref={endRef} />
      </div>
    );
  }

  // ── Turns rendering ──
  return (
    <div className="flex-1 overflow-y-auto min-h-0" ref={scrollRef}>
      <div className="px-4 py-4">
        {turns.map((turn, turnIdx) => {
          const isLatestTurn = turnIdx === turns.length - 1;

          return (
            <div key={`turn-${turnIdx}`} className={`turn ${!isLatestTurn ? 'mb-6 border-b border-gray-800/50 pb-6' : ''}`}>

              {/* ── Compact summary (session continuation marker) ── */}
              {turn.userMsg.isCompactSummary ? (
                <SystemContextBar userMsg={turn.userMsg} />
              ) : (
                /* ── User message header ── */
                <div className={`flex gap-3 mb-2 ${!isLatestTurn ? 'sticky top-0 z-10 bg-[#0a0a0a] py-2 -mx-4 px-4 border-b border-gray-800' : ''}`}>
                  {/* Timestamp */}
                  <span className="w-14 shrink-0 text-gray-600 text-[10px] pt-0.5">{turn.userMsg.timestamp}</span>

                  {/* User icon */}
                  <div className="flex h-5 w-5 items-center justify-center rounded shrink-0 bg-gray-800 text-gray-500 mt-0.5">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>

                  {/* User message content */}
                  <div className="bg-purple-900/15 border border-purple-900/40 text-purple-100 px-3 py-2 rounded-lg max-w-xl flex-1">
                    <MarkdownRenderer content={turn.userMsg.content} />
                  </div>

                  {/* Fork button (only on non-latest turns) */}
                  {!isLatestTurn && onFork && (
                    <button
                      onClick={() => onFork(turnIdx)}
                      className="self-center text-gray-600 hover:text-purple-400 transition-colors p-1 rounded hover:bg-purple-900/20 shrink-0"
                      title="Fork conversation from here"
                    >
                      <GitBranch className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              {/* ── Assistant responses ── */}
              {turn.assistantMsgs.length > 0 && (
                <div className="flex flex-col gap-2 ml-7">
                  {turn.assistantMsgs.map((asstMsg) => {
                    // Categorize blocks
                    const thinkingBlocks = asstMsg.blocks.filter(isThinkingBlock);
                    const toolBlocks = asstMsg.blocks.filter(isToolBlock);
                    const textBlocks = asstMsg.blocks.filter(isTextBlock);
                    const unknownBlocks = asstMsg.blocks.filter(b => b.type === 'unknown');

                    return (
                      <div key={asstMsg.id} className="space-y-2">
                        {/* ── Thinking blocks (collapsible) ── */}
                        {thinkingBlocks.map(block => (
                          <ThinkingBlock key={block.id} block={block} />
                        ))}

                        {/* ── Tool blocks (card style) ── */}
                        {toolBlocks.map(block => (
                          <ToolCard
                            key={block.id}
                            block={block}
                            onToggleOutput={onToggleOutput}
                            expandedOutputs={expandedOutputs}
                          />
                        ))}

                        {/* ── Text blocks (Markdown rendered) ── */}
                        {textBlocks.length > 0 && (
                          <div className="text-sm">
                            {textBlocks.map(textBlock => (
                              <div key={textBlock.id} className="text-gray-300 leading-relaxed text-xs prose-container">
                                <MarkdownRenderer content={textBlock.content} />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* ── Unknown blocks ── */}
                        {unknownBlocks.map(unkBlock => (
                          <div key={unkBlock.id} className="text-xs p-2 rounded border border-yellow-800/40 bg-yellow-950/[0.05]">
                            <div className="flex items-center gap-2">
                              <AlertCircle className="w-3 h-3 text-yellow-500" />
                              <span className="font-bold text-[10px] text-yellow-500">Unknown</span>
                            </div>
                          </div>
                        ))}

                        {/* ── Pending indicator ── */}
                        {asstMsg.isPending && (
                          <div className="flex items-center gap-2 text-[10px] text-purple-500 animate-pulse pl-2">
                            <div className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
                            Claude is working...
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}
