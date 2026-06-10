'use client';

import React, { useState } from 'react';
import {
  Terminal, Folder, FileCode, Play,
  Square, GitBranch, ChevronRight,
  Sparkles, AlertCircle,
} from 'lucide-react';
import { SystemContextBar } from '../../sdk/components';
import { useWorkbench, useSessionContext, useInputContext, useToolActivityContext } from '../../sdk';
import { getIcon, MarkdownRenderer, SLASH_COMMANDS } from './markdown';

// ─── Internal types (duplicated from context for local references) ──

interface Block {
  id: string;
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text' | 'unknown';
  semantic: string;
  toolName: string;
  detail: string;
  output: string;
  toolArgs: string;
  status: 'running' | 'done' | 'error';
  exitCode: number;
  content: string;
  expanded: boolean;
  rawData: string;
  isComplete?: boolean;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  blocks: Block[];
  isPending: boolean;
  isCompactSummary?: boolean;
}

type Turn = {
  userMsg: Message;
  assistantMsgs: Message[];
};

interface ToolActivity {
  id: string;
  toolName: string;
  detail: string;
  semantic: string;
  status: 'running' | 'done' | 'error';
}

// ─── ClaudeChatView ─────────────────────────────────────

export function ClaudeChatView({ instanceId }: { instanceId?: string }) {
  // Phase 4F: When no instanceId is bound, show attach state instead of
  // implicitly reusing the global activeInstanceId from workbench context.
  // Phase 4I: instanceId comes from PaneTab.instanceId — this tab's binding.
  // The global activeInstanceId (sidebar selection) is NEVER used as fallback.
  if (!instanceId) {
    return <ClaudeChatEmptyState />;
  }

  return <ClaudeChatInner instanceId={instanceId} />;
}

function ClaudeChatEmptyState() {
  const { createInstance, bindCurrentTabInstance, projectCwd } = useWorkbench();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0a0a] min-h-0 gap-4">
      <Sparkles className="w-10 h-10 text-gray-700" />
      <div className="text-center space-y-1">
        <p className="text-xs text-gray-500">No Claude runtime instance attached</p>
        <p className="text-[10px] text-gray-700">Attach an existing instance or create a new one</p>
      </div>
      <div className="flex flex-col items-center gap-2">
        <p className="text-[9px] text-gray-700 italic">(Instance selector coming soon)</p>
        <button
          onClick={async () => {
            setCreating(true);
            try {
              const result = await createInstance({ dir: projectCwd || '.', label: 'Claude Chat', adapterId: 'claude-code' });
              if (result?.instance?.id) {
                bindCurrentTabInstance(result.instance.id);
              }
            } finally {
              setCreating(false);
            }
          }}
          disabled={creating}
          className="flex items-center gap-2 px-4 py-2 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded border border-purple-600 transition-colors"
        >
          <Sparkles className="w-4 h-4" />
          {creating ? 'Creating...' : 'Create New Runtime'}
        </button>
      </div>
    </div>
  );
}

function ClaudeChatInner({ instanceId }: { instanceId: string }) {
  const {
    messages, turns, phase, setPhase,
    currentActivity, setCurrentActivity,
    connStatus, isRestoring, historyLoading,
    handleInterrupt, setForkTarget, setForkPrompt,
  } = useSessionContext();
  const {
    inputValue, setInputValue, handleSubmit, handleInputChange, handleKeyDown,
    showFileSuggest, fileSuggestions, handleFileSuggestionClick,
    showCommands, setShowCommands, handleCommandClick, cmdPanelRef,
  } = useInputContext();
  const {
    toolActivities, setToolActivities, expandedToolOutputs, setExpandedToolOutputs,
  } = useToolActivityContext();
  const {
    activeExternalSession, clearExternalSession,
    scrollContainerRef, actionEndRef,
    activeInstanceId, activateInstance,
  } = useWorkbench();

  // Phase 4F: When this tab's instanceId doesn't match the global active instance,
  // the chat state shown is global (not scoped to this tab's instance). Block
  // input/commands/interrupt to prevent accidental cross-instance interference.
  const isActiveInstance = instanceId === activeInstanceId;

  return (
    <>
      {/* ── Floating Tool Activity Panel ── */}
      {toolActivities.size > 0 && (
        <div className="absolute top-12 right-4 z-20 w-80 max-h-96 pointer-events-none">
          <div className="bg-[#151515] border border-gray-700 rounded-lg shadow-2xl shadow-black/60 overflow-hidden pointer-events-auto">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
              <span className="text-[10px] font-bold text-gray-400 flex items-center gap-2">
                <Terminal className="w-3 h-3 text-purple-400" />
                TOOLS
                <span className="text-gray-600 font-normal">({toolActivities.size})</span>
              </span>
              <button onClick={() => setToolActivities(new Map())} className="text-gray-600 hover:text-gray-400 text-xs leading-none">&times;</button>
            </div>
            <div className="max-h-72 overflow-y-auto p-2 space-y-1">
              {Array.from(toolActivities.values()).map(act => (
                <div key={act.id} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs border ${
                  act.status === 'running'
                    ? 'bg-purple-950/[0.06] border-purple-700/30'
                    : act.status === 'done'
                    ? 'bg-[#0d0d0d] border-gray-800'
                    : 'bg-red-950/[0.06] border-red-800/30'
                }`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    act.status === 'running' ? 'bg-purple-500 animate-pulse'
                    : act.status === 'done' ? 'bg-emerald-500'
                    : 'bg-red-500'
                  }`} />
                  <span className="[&>svg]:w-3 [&>svg]:h-3 shrink-0">
                    {getIcon(act.toolName)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className={`text-[10px] font-medium ${act.status === 'running' ? 'text-purple-300' : 'text-gray-300'}`}>
                      {act.semantic}
                    </span>
                    {act.detail && (
                      <div className="text-[8px] text-gray-500 truncate">{act.detail}</div>
                    )}
                  </div>
                  <span className={`text-[8px] font-bold px-1 py-0.5 rounded shrink-0 ${
                    act.status === 'running' ? 'text-purple-400 bg-purple-900/30'
                    : act.status === 'done' ? 'text-emerald-400 bg-emerald-900/30'
                    : 'text-red-400 bg-red-900/30'
                  }`}>
                    {act.status === 'running' ? '●' : act.status === 'done' ? '✓' : '✗'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Phase 4F: instance mismatch banner ── */}
      {!isActiveInstance && (
        <div className="shrink-0 px-4 py-2 bg-amber-900/20 border-b border-amber-700/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="text-[10px] text-amber-300">
              This tab is bound to a non-active instance. Messages shown are from the global session.
            </span>
          </div>
          <button
            onClick={() => activateInstance(instanceId)}
            className="text-[9px] px-2 py-1 bg-amber-700 hover:bg-amber-600 text-white rounded border border-amber-600 transition-colors shrink-0"
          >
            Switch to this instance
          </button>
        </div>
      )}
      {/* TODO(Phase 4F): Instance-scoped message store. Currently all chat state
       * (messages, turns, phase, input) is global — not scoped per instanceId.
       * When this tab's instanceId differs from activeInstanceId, the messages
       * shown belong to the global active instance. A future phase should scope
       * message storage by instanceId so each tab shows its own conversation. */}

      {/* ── Message stream ── */}
      <div className="flex-1 overflow-y-auto min-h-0" ref={scrollContainerRef}>
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
                  <p className="text-purple-500 animate-pulse">Connecting to Claude...</p>
                  <p className="text-gray-700 text-[10px]">Waiting for response</p>
                </>
              ) : connStatus.status !== 'connected' ? (
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
              {turn.userMsg.isCompactSummary ? (
                <SystemContextBar userMsg={turn.userMsg} />
              ) : (
              /* ── Sticky user message header ── */
              <div className={`flex gap-3 text-sm ${!isLatestTurn ? 'sticky top-0 z-10 bg-[#0a0a0a] py-2 -mx-4 px-4 border-b border-gray-800' : ''}`}>
                <span className="w-14 shrink-0 text-gray-600 text-[10px] pt-1">{turn.userMsg.timestamp}</span>
                <div className="bg-purple-900/15 border border-purple-900/40 text-purple-100 px-3 py-2 rounded-lg max-w-xl prose-container flex-1">
                  <MarkdownRenderer content={turn.userMsg.content} />
                </div>
                {!isLatestTurn && (
                  <button
                    onClick={() => { setForkTarget(turnIdx); setForkPrompt(''); }}
                    className="self-center text-gray-600 hover:text-purple-400 transition-colors p-1 rounded hover:bg-purple-900/20"
                    title="Fork conversation from here"
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              )}

              {/* ── Assistant response ── */}
              {turn.assistantMsgs.length > 0 && (
                <div className="flex flex-col gap-2 mt-3">
                  {turn.assistantMsgs.map((asstMsg) => {
                    const toolBlocks = asstMsg.blocks.filter(b =>
                      b.type === 'tool_use' || b.type === 'tool_result' || b.type === 'thinking'
                    );
                    const textBlocks = asstMsg.blocks.filter(b => b.type === 'text');
                    const unknownBlocks = asstMsg.blocks.filter(b => b.type === 'unknown');
                    return (
                    <div key={asstMsg.id}>
                      {/* ── Timeline ── */}
                      {toolBlocks.length > 0 && (
                        <div className="flex gap-2 mb-2">
                          <div className="flex flex-col items-center w-4 shrink-0 pt-[3px]">
                            {toolBlocks.map((block, bi) => (
                              <div key={block.id || bi} className="flex flex-col items-center">
                                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ring-1 ring-gray-700/50 ${
                                  block.status === 'running' ? 'bg-purple-500 animate-pulse ring-purple-500/40'
                                  : block.status === 'error' ? 'bg-red-500'
                                  : 'bg-emerald-500/80'
                                }`} />
                                {bi < toolBlocks.length - 1 && (
                                  <div className="w-px h-5 bg-gray-700/40" />
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="flex-1 min-w-0 space-y-0.5">
                            {toolBlocks.map((block, bi) => (
                              <div key={block.id || bi}
                                onClick={() => block.output && setExpandedToolOutputs(prev => {
                                  const next = new Set(prev);
                                  if (next.has(block.id)) next.delete(block.id);
                                  else next.add(block.id);
                                  return next;
                                })}
                                className={`flex flex-col ${block.output ? 'cursor-pointer hover:bg-gray-900/10 rounded px-1 -mx-1' : ''}`}
                              >
                                <div className="flex items-center gap-1.5 text-[10px] leading-5">
                                  <span className="[&>svg]:w-3 [&>svg]:h-3 shrink-0 text-gray-500">
                                    {block.type === 'thinking'
                                      ? <Sparkles className="w-3 h-3" />
                                      : getIcon(block.toolName)
                                    }
                                  </span>
                                  {block.type === 'thinking' ? (
                                    <span className={block.status === 'running' ? 'text-gray-400' : 'text-gray-600'}>
                                      {block.status === 'running' ? 'Analyzing...' : 'Analysis done'}
                                    </span>
                                  ) : (
                                    <>
                                      <span className={`${block.status === 'running' ? 'text-gray-300' : 'text-gray-500'}`}>
                                        {block.semantic}
                                      </span>
                                      {block.detail && (
                                        <code className="text-gray-600 truncate max-w-[300px] min-w-0" title={block.detail}>
                                          {block.detail}
                                        </code>
                                      )}
                                      {block.toolName === 'Bash' && block.exitCode >= 0 && (
                                        <span className={`text-[8px] px-1 rounded font-bold shrink-0 ${
                                          block.exitCode === 0 ? 'text-emerald-600 bg-emerald-900/20' : 'text-red-400 bg-red-900/20'
                                        }`}>
                                          {block.exitCode === 0 ? '✓' : `exit: ${block.exitCode}`}
                                        </span>
                                      )}
                                    </>
                                  )}
                                  {block.output && (
                                    <span className="text-gray-700 text-[8px] ml-auto shrink-0">
                                      {expandedToolOutputs.has(block.id) ? '▲' : '▼'}
                                    </span>
                                  )}
                                </div>
                                {block.output && expandedToolOutputs.has(block.id) && (
                                  <div className="ml-1 mt-0.5 mb-1">
                                    {block.toolName === 'Bash' && block.toolArgs && (
                                      <div className="text-[9px] text-orange-400/80 bg-[#0a0a0a] border border-gray-800 rounded-t px-2 py-1 font-mono whitespace-pre-wrap break-all">
                                        $ {(() => {
                                          try { const p = JSON.parse(block.toolArgs); return p.command || block.toolArgs; }
                                          catch { return block.toolArgs; }
                                        })()}
                                      </div>
                                    )}
                                    <div className={`text-[9px] text-gray-500 bg-[#0a0a0a] border border-gray-800 ${block.toolName === 'Bash' ? 'border-t-0 rounded-b' : 'rounded'} px-2 py-1 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto`}>
                                      {block.output.slice(0, 5000)}
                                      {block.output.length > 5000 && <span className="text-gray-700">... ({block.output.length - 5000} more chars)</span>}
                                    </div>
                                  </div>
                                )}
                                {bi < toolBlocks.length - 1 && <div className="h-[14px]" />}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ── Text content ── */}
                      {textBlocks.length > 0 && (
                        <div className="space-y-2">
                          {textBlocks.map((textBlock) => (
                            <div key={textBlock.id} className="text-sm">
                              <div className="max-w-2xl text-gray-300 leading-relaxed text-xs prose-container">
                                <MarkdownRenderer content={textBlock.content} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ── Unknown blocks ── */}
                      {unknownBlocks.map((unkBlock) => (
                        <div key={unkBlock.id} className="text-xs p-2 rounded border border-yellow-800/40 bg-yellow-950/[0.05] mt-2">
                          <div className="flex items-center gap-2">
                            <AlertCircle className="w-3 h-3 text-yellow-500" />
                            <span className="font-bold text-[10px] text-yellow-500">Unknown</span>
                          </div>
                        </div>
                      ))}

                      {asstMsg.isPending && (
                        <div className="flex items-center gap-2 text-[10px] text-purple-500 animate-pulse pl-2 mt-2">
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
        })
        )}
        <div ref={actionEndRef} />
      </div>
      </div>

      {/* ── Input bar ── */}
      <div className="shrink-0 px-4 py-3 bg-gradient-to-t from-black via-[#0a0a0a] to-transparent relative">
        {!isActiveInstance ? (
          /* Disabled input when this tab's instance is not the global active one */
          <div className="flex items-center gap-1.5 bg-[#151515] border border-gray-700 p-2 rounded-lg opacity-50">
            <button type="button" disabled
              className="text-xs font-bold px-1.5 py-0.5 rounded shrink-0 text-gray-600 cursor-not-allowed">
              {'/>'}
            </button>
            <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
            <input type="text" disabled
              placeholder="Switch to this instance to send commands"
              className="flex-1 bg-transparent outline-none text-gray-200 placeholder-gray-700 text-sm min-w-0 cursor-not-allowed"
            />
            <button disabled
              className="px-4 py-1.5 bg-gray-800 text-gray-600 text-xs font-bold rounded flex items-center gap-1.5 shrink-0 cursor-not-allowed">
              <Play className="w-3 h-3 fill-current" /> EXEC
            </button>
          </div>
        ) : (
        <>
        {/* Slash command panel */}
        {showCommands && (
          <div ref={cmdPanelRef}
            className="absolute bottom-full left-4 right-4 mb-2 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-2xl shadow-black/50 overflow-hidden"
          >
            <div className="p-2 border-b border-gray-800 text-[10px] text-gray-500 font-bold tracking-wider px-3 py-1.5">
              QUICK COMMANDS
            </div>
            <div className="max-h-48 overflow-y-auto py-1">
              {SLASH_COMMANDS.map((sc) => (
                <button key={sc.cmd} onClick={() => sc.ok && handleCommandClick(sc.cmd)}
                  className={`w-full flex items-center gap-3 px-3 py-2 transition-colors text-left ${
                    sc.ok ? 'hover:bg-gray-800 cursor-pointer' : 'opacity-40 cursor-not-allowed'
                  }`}
                  title={sc.ok ? sc.cmd + ' ' + sc.desc : '当前模式不支持'}
                >
                  <code className={`text-[11px] font-bold shrink-0 w-16 ${sc.ok ? 'text-purple-400' : 'text-gray-600'}`}>{sc.cmd}</code>
                  <span className="text-[10px] truncate">{sc.desc}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* @ file suggestions */}
        {showFileSuggest && (
          <div className="absolute bottom-full left-4 right-4 mb-2 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-2xl shadow-black/50 overflow-hidden z-50">
            <div className="p-1.5 border-b border-gray-800 text-[10px] text-gray-500 px-3 py-1">FILES</div>
            <div className="max-h-40 overflow-y-auto py-1">
              {fileSuggestions.map((item: any) => (
                <button key={item.path || item.name}
                  onClick={() => handleFileSuggestionClick(item)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-800 transition-colors text-left"
                >
                  {item.type === 'dir'
                    ? <Folder className="w-3 h-3 text-yellow-600 shrink-0" />
                    : <FileCode className="w-3 h-3 text-blue-500 shrink-0" />
                  }
                  <span className="text-[10px] text-gray-300 truncate">{item.path || item.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
          className={`flex items-center gap-1.5 bg-[#151515] border ${
            phase === 'running' ? 'border-purple-800 shadow-[0_0_12px_rgba(168,85,247,0.15)]' : 'border-gray-700 focus-within:border-purple-500'
          } p-2 rounded-lg transition-all`}
        >
          <button type="button" onClick={() => setShowCommands(v => !v)}
            className={`text-xs font-bold px-1.5 py-0.5 rounded shrink-0 transition-colors ${
              showCommands ? 'text-purple-400 bg-purple-900/20' : 'text-gray-500 hover:text-gray-300'
            }`}
            title="Slash commands"
          >
            {'/>'}
          </button>
          <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
          <input type="text" value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={phase === 'running'}
            placeholder={phase === 'running' ? 'Claude is working...' : 'Type instructions or press Quick Actions...'}
            className="flex-1 bg-transparent outline-none text-gray-200 placeholder-gray-600 text-sm disabled:opacity-50 min-w-0 msg-input"
          />
          {phase !== 'running' ? (
            <button type="submit"
              className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded flex items-center gap-1.5 transition-colors shrink-0"
              title="Submit (Enter)">
              <Play className="w-3 h-3 fill-current" /> EXEC
            </button>
          ) : (
            <button type="button" onClick={handleInterrupt}
              className="px-4 py-1.5 bg-red-700 hover:bg-red-600 text-white text-xs font-bold rounded flex items-center gap-1.5 transition-colors shrink-0 animate-pulse"
              title="Stop current task (Esc)">
              <Square className="w-3 h-3 fill-current" /> STOP
            </button>
          )}
        </form>
        </>
        )}
      </div>

    </>
  );
}

export default ClaudeChatView;
