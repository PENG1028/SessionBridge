'use client';

import { Sparkles, AlertCircle, GitBranch } from 'lucide-react';
import type { Message, Turn, Block } from './types';

export interface MessageStreamProps {
  turns: Turn[];
  messages: Message[];
  isRestoring: boolean;
  historyLoading: boolean;
  phase: string;
  isConnected: boolean;
  activeExternalSession: string | null;
  expandedBlockIds: Set<string>;
  onToggleBlockExpand: (blockId: string) => void;
  scrollToTurn: (idx: number) => void;
  setForkTarget: (idx: number | null) => void;
  setForkPrompt: (s: string) => void;
  onOpenFile?: (file: { path: string; content: string }) => void;
  renderMarkdown: React.ComponentType<{ content: string }>;
  getIcon: (toolName: string) => React.ReactNode;
  getSemantic: (name: string) => { label: string };
  renderCompactSummary: React.ComponentType<{ userMsg: any }>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  endRef: React.RefObject<HTMLDivElement | null>;
}

export function MessageStream(props: MessageStreamProps) {
  const {
    turns, messages, isRestoring, historyLoading, phase, isConnected,
    activeExternalSession, expandedBlockIds, onToggleBlockExpand,
    scrollToTurn, setForkTarget, setForkPrompt,
    renderMarkdown: Md, getIcon, getSemantic, renderCompactSummary: CompactBar,
    scrollRef, endRef,
  } = props;

  return (
    <div className="flex-1 overflow-y-auto" ref={scrollRef}>
      <div className="px-4 py-4">
        {isRestoring ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-gray-600 text-xs space-y-2">
              <div className="w-8 h-8 mx-auto relative">
                <div className="absolute inset-0 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
              </div>
              <p className="text-purple-400 animate-pulse">Restoring session...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
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
                  <p className="text-purple-400 animate-pulse">Connecting to Claude...</p>
                  <p className="text-gray-700 text-[10px]">Waiting for response</p>
                </>
              ) : !isConnected ? (
                <>
                  <div className="w-2 h-2 mx-auto bg-red-500 rounded-full" />
                  <p className="text-red-400">Disconnected</p>
                  <p className="text-gray-700 text-[10px]">Check that relay and agent are running</p>
                </>
              ) : (
                <>
                  <Sparkles className="w-8 h-8 mx-auto opacity-40" />
                  <p>Awaiting instructions</p>
                  <p className="text-gray-700 text-[10px]">Type a message or use Quick Actions</p>
                </>
              )}
            </div>
          </div>
        ) : (
          turns.map((turn, turnIdx) => {
            const isLatestTurn = turnIdx === turns.length - 1;
            return (
              <div key={`turn-${turnIdx}`} className={`turn ${!isLatestTurn ? 'mb-6 border-b border-gray-800/50 pb-6' : ''}`}>
                {/* User message */}
                {turn.userMsg.isCompactSummary ? (
                  <CompactBar userMsg={turn.userMsg} />
                ) : (
                  <div className={`flex gap-3 text-sm ${!isLatestTurn ? 'sticky top-0 z-10 bg-[#0a0a0a] py-2 -mx-4 px-4 border-b border-gray-800' : ''}`}>
                    <span className="w-14 shrink-0 text-gray-600 text-[10px] pt-1">{turn.userMsg.timestamp}</span>
                    <div className={turn.userMsg.isSystem ? "border-l-2 border-gray-700/50 pl-3 py-0.5 max-w-xl prose-container flex-1 text-[10px] text-gray-500 italic" : "border border-gray-700/50 bg-[#1e1e1e] text-gray-200 px-3 py-2 rounded max-w-xl prose-container flex-1"}>
                      <Md content={turn.userMsg.content} />
                    </div>
                    {!isLatestTurn && (
                      <button onClick={() => { setForkTarget(turnIdx); setForkPrompt(''); }} className="self-center text-gray-600 hover:text-purple-400 transition-colors p-1 rounded hover:bg-purple-900/20" title="Fork">
                        <GitBranch className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}

                {/* Assistant messages */}
                {turn.assistantMsgs.length > 0 && (
                  <div className="flex flex-col gap-2 mt-3">
                    {turn.assistantMsgs.map((asstMsg) => {
                      const toolBlocks = asstMsg.blocks.filter((b: Block) => b.type === 'tool_use' || b.type === 'tool_result' || b.type === 'thinking');
                      const textBlocks = asstMsg.blocks.filter((b: Block) => b.type === 'text');
                      const unknownBlocks = asstMsg.blocks.filter((b: Block) => b.type === 'unknown');
                      return (
                        <div key={asstMsg.id} className="tl-msg">
                          {toolBlocks.length > 0 && (
                            <div className="flex gap-2 mb-2">
                              <div className="flex flex-col items-center w-4 shrink-0 pt-[3px] gap-[14px]">
                                {toolBlocks.map((block, bi) => (
                                  <div key={block.id || bi} className="flex flex-col items-center">
                                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-gray-700/50 tl-dot ${block.status === 'running' ? 'bg-purple-500 animate-pulse ring-purple-500/40' : block.status === 'error' ? 'bg-red-500' : 'bg-emerald-500/80'}`} />
                                  </div>
                                ))}
                              </div>
                              <div className="flex-1 min-w-0 space-y-0.5">
                                {toolBlocks.map((block, bi) => (
                                  <div key={block.id || bi} onClick={() => block.output && onToggleBlockExpand(block.id)}
                                    className={`flex flex-col ${block.output ? 'cursor-pointer hover:bg-gray-900/10 rounded px-1 -mx-1' : ''}`}>
                                    <div className="flex items-center gap-1.5 text-[10px] leading-5">
                                      <span className="[&>svg]:w-3 [&>svg]:h-3 shrink-0 text-gray-500">
                                        {block.type === 'thinking' ? <Sparkles className="w-3 h-3" /> : getIcon(block.toolName)}
                                      </span>
                                      {block.type === 'thinking' ? (
                                        <div className="flex flex-col flex-1 min-w-0">
                                          <button onClick={(e) => { e.stopPropagation(); if (block.content) onToggleBlockExpand(block.id); }}
                                            className={`flex items-center gap-1 text-left hover:bg-gray-800/30 rounded px-0.5 -mx-0.5 transition-colors ${!block.content ? 'cursor-default' : ''}`}>
                                            <Sparkles className={`w-3 h-3 shrink-0 ${block.status === 'running' ? 'text-purple-400 animate-pulse' : 'text-purple-500/60'}`} />
                                            <span className={block.status === 'running' ? 'text-gray-400' : 'text-gray-500'}>{block.status === 'running' ? 'Thinking...' : 'Thought'}</span>
                                            {block.content && block.status !== 'running' && <span className="text-gray-600">{expandedBlockIds.has(block.id) ? '▲' : '▼'}</span>}
                                          </button>
                                          {block.content && expandedBlockIds.has(block.id) && (
                                            <pre className="text-[10px] text-gray-400 bg-[#0a0a0a] border border-gray-800 rounded p-2 mt-0.5 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto ml-1">{block.content}</pre>
                                          )}
                                        </div>
                                      ) : (
                                        <>
                                          <span className={block.status === 'running' ? 'text-gray-300' : 'text-gray-500'}>{block.semantic}</span>
                                          {block.output && <span className="text-gray-600 hover:text-gray-400 transition-colors text-[9px]">{expandedBlockIds.has(block.id) ? '▾' : '▸'}</span>}
                                          {block.detail && <code className="text-gray-600 truncate max-w-[300px] min-w-0" title={block.detail}>{block.detail}</code>}
                                          {block.toolName === 'Bash' && block.exitCode >= 0 && (
                                            <span className={`text-[8px] px-1 rounded font-bold shrink-0 ${block.exitCode === 0 ? 'text-emerald-600 bg-emerald-900/20' : 'text-red-400 bg-red-900/20'}`}>{block.exitCode === 0 ? '✓' : `exit: ${block.exitCode}`}</span>
                                          )}
                                        </>
                                      )}
                                    </div>
                                    {block.output && expandedBlockIds.has(block.id) && (
                                      <div className="ml-1 mt-0.5 mb-1">
                                        {block.toolName === 'Bash' && block.toolArgs && (
                                          <div className="text-[9px] text-orange-400/80 bg-[#0a0a0a] border border-gray-800 rounded-t px-2 py-1 font-mono whitespace-pre-wrap break-all">$ {(() => { try { return JSON.parse(block.toolArgs).command || block.toolArgs; } catch { return block.toolArgs; } })()}</div>
                                        )}
                                        <div className={`text-[9px] text-gray-500 bg-[#0a0a0a] border border-gray-800 ${block.toolName === 'Bash' ? 'border-t-0 rounded-b' : 'rounded'} px-2 py-1 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto`}>
                                          {block.output.slice(0, 5000)}{block.output.length > 5000 && <span className="text-gray-700">... ({block.output.length - 5000} more chars)</span>}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {textBlocks.length > 0 && (
                            <div className="space-y-2">
                              {textBlocks.map((tb: Block) => (
                                <div key={tb.id} className="text-sm"><div className="max-w-2xl text-gray-300 leading-relaxed text-xs prose-container"><Md content={tb.content} /></div></div>
                              ))}
                            </div>
                          )}
                          {unknownBlocks.map((ub: Block) => (
                            <div key={ub.id} className="text-xs p-2 rounded border border-yellow-800/40 bg-yellow-950/[0.05] mt-2"><div className="flex items-center gap-2"><AlertCircle className="w-3 h-3 text-yellow-500" /><span className="font-bold text-[10px] text-yellow-500">Unknown</span></div></div>
                          ))}
                          {asstMsg.isPending && (
                            <div className="flex items-center gap-2 text-[10px] text-purple-500 animate-pulse pl-2 mt-2"><div className="w-1.5 h-1.5 bg-purple-500 rounded-full" />Claude is working...</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
