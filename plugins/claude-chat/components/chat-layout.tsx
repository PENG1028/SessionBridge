'use client';

import { useState, useCallback, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { useSessionContext, useInputContext, useToolActivityContext, useWorkbench } from '../../../sdk';
import { useChatParser } from '../hooks/use-chat-parser';
import { useProviderConfig } from '../hooks/use-provider-config';
import { PROVIDER_PRESETS, PRESET_CATEGORIES } from '../config/provider-presets';
import { useAdapterLifecycle } from '../hooks/use-adapter-lifecycle';
import { MessageTimeline } from './message-timeline';
import { ChatInput } from './chat-input';
import { SessionStatusBar } from './session-status-bar';
import { ThreadBar } from './thread-bar';
import { RightPanel } from './panels/right-panel';

// ─── Thread state ──

interface ThreadInfo { id: string; label: string; isOriginal: boolean; }
let threadCounter = 0;

// ─── Props ──────────────────────────────────────────

interface ChatLayoutProps {
  instanceId?: string; // optional: if not provided, adapter will create one
  projectCwd?: string;
}

// ─── Component ──────────────────────────────────────

export function ChatLayout({ instanceId: initialInstanceId, projectCwd: fallbackCwd }: ChatLayoutProps) {
  // ── Provider config (React state only, no localStorage) ──
  const {
    config: providerConfig,
    setById, setApiKey, setModel, setBaseUrl,
    isDirty, lastApplied, markApplied,
  } = useProviderConfig();

  // ── Adapter lifecycle ──
  const {
    instanceId: adapterInstanceId,
    status: adapterStatus,
    error: adapterError,
    createAdapter,
    stopAdapter,
  } = useAdapterLifecycle();

  const {
    projectCwd: wbCwd,
    logs,
    activeInstanceId, activateInstance,
    bindCurrentTabInstance,
    scrollContainerRef, actionEndRef,
  } = useWorkbench();
  const effectiveCwd = wbCwd || fallbackCwd || '.';

  // Handle instance resolution: prefer prop, fall back to adapter-created
  const effectiveInstanceId = initialInstanceId || adapterInstanceId;
  const hasAdapter = !!adapterInstanceId;

  // ── Chat parser ──
  const {
    turns: parserTurns,
    phase: parserPhase,
    sendMessage,
    interrupt: parserInterrupt,
  } = useChatParser(
    effectiveInstanceId || '__none__',
    hasAdapter ? 'adapter' : 'cli',
  );

  // When adapter creates an instance, bind this tab to it
  useEffect(() => {
    if (adapterInstanceId) {
      bindCurrentTabInstance(adapterInstanceId);
    }
  }, [adapterInstanceId, bindCurrentTabInstance]);

  // ── Apply provider config: (re)start adapter ──
  const handleApplyConfig = useCallback(async () => {
    if (adapterInstanceId) {
      await stopAdapter();
    }
    const id = await createAdapter(effectiveCwd, providerConfig);
    if (id) {
      markApplied();
    }
  }, [adapterInstanceId, effectiveCwd, providerConfig, createAdapter, stopAdapter, markApplied]);

  // ── Session context (connection state, restoring) ──
  const {
    connStatus, isRestoring, historyLoading,
    setForkTarget, setForkPrompt,
  } = useSessionContext();

  // ── Input context ──
  const {
    inputValue, setInputValue, handleInputChange, handleKeyDown,
    showFileSuggest, fileSuggestions, handleFileSuggestionClick,
    showCommands, setShowCommands, handleCommandClick, cmdPanelRef,
  } = useInputContext();

  // ── Tool activity ──
  const { expandedToolOutputs, setExpandedToolOutputs } = useToolActivityContext();

  // ── Workbench ──
  // ── Active instance check ──
  const isActiveInstance = !effectiveInstanceId || effectiveInstanceId === activeInstanceId;

  // ── Thread state ──
  const [threads, setThreads] = useState<ThreadInfo[]>([
    { id: 'original', label: 'Original', isOriginal: true },
  ]);
  const [activeThreadId, setActiveThreadId] = useState('original');

  const handleFork = useCallback((turnIndex: number) => {
    setForkTarget(turnIndex);
    setForkPrompt('');
    threadCounter++;
    const id = `fork-${threadCounter}`;
    setThreads(prev => [...prev, { id, label: `Fork ${threadCounter}`, isOriginal: false }]);
    setActiveThreadId(id);
  }, [setForkTarget, setForkPrompt]);

  const handleSwitchThread = useCallback((id: string) => {
    setActiveThreadId(id);
    if (id === 'original') setForkTarget(null);
  }, [setForkTarget]);

  const handleCloseThread = useCallback((id: string) => {
    if (id === 'original') return;
    setThreads(prev => prev.filter(t => t.id !== id));
    if (activeThreadId === id) setActiveThreadId('original');
  }, [activeThreadId]);

  // ── Right panel ──
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  // ── Tool output expansion ──
  const handleToggleOutput = useCallback((blockId: string) => {
    setExpandedToolOutputs(prev => {
      const next = new Set(prev);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  }, [setExpandedToolOutputs]);

  // ── Custom submit: uses parser's sendMessage ──
  const handleChatSubmit = useCallback((overrideCmd?: string) => {
    if (overrideCmd) { handleCommandClick(overrideCmd); return; }
    const text = inputValue.trim();
    if (!text || !effectiveInstanceId) return;
    sendMessage(text);
    setInputValue('');
  }, [inputValue, effectiveInstanceId, sendMessage, setInputValue, handleCommandClick]);

  // ── Phase to display ──
  const displayPhase = parserTurns.length > 0 || parserPhase !== 'idle' ? parserPhase : 'idle';

  // ── Interrupt ──
  const handleInterrupt = useCallback(() => {
    parserInterrupt();
  }, [parserInterrupt]);

  // ── Render: adapter not running yet → show provider setup ──
  if (!effectiveInstanceId) {
    return (
      <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-[#0a0a0a]">
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-md mx-auto pt-12 space-y-6 px-4">
            {/* Header */}
            <div className="text-center space-y-1">
              <p className="text-sm text-gray-400">Claude Chat</p>
              <p className="text-[10px] text-gray-600">Configure a provider to start</p>
            </div>

            {/* Provider selection */}
            <div className="space-y-1">
              <p className="text-[9px] text-gray-600 uppercase tracking-wider font-semibold px-1">Provider</p>
              <div className="max-h-[40vh] overflow-y-auto space-y-2">
                {PRESET_CATEGORIES.map(cat => {
                  const presets = PROVIDER_PRESETS.filter(p => p.category === cat.id);
                  if (!presets.length) return null;
                  return (
                    <div key={cat.id}>
                      <p className="text-[8px] text-gray-700 px-1 py-0.5 uppercase tracking-wider">{cat.label}</p>
                      <div className="space-y-px">
                        {presets.map(preset => (
                          <button
                            key={preset.id}
                            onClick={() => setById(preset.id)}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded text-[11px] transition-colors text-left ${
                              providerConfig.id === preset.id
                                ? 'bg-purple-900/20 text-purple-300 border border-purple-700/30'
                                : 'text-gray-400 hover:bg-gray-800/40 border border-transparent'
                            }`}
                          >
                            {providerConfig.id === preset.id && (
                              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                            )}
                            <span className="min-w-0 truncate">{preset.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* API Key */}
            <div className="space-y-1">
              <p className="text-[9px] text-gray-600 uppercase tracking-wider font-semibold px-1">API Key</p>
              <input
                type="password"
                value={providerConfig.apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full bg-[#151515] border border-gray-700 rounded px-3 py-2 text-[12px] text-gray-200 outline-none placeholder:text-gray-700 focus:border-purple-500"
              />
            </div>

            {/* Model */}
            <div className="space-y-1">
              <p className="text-[9px] text-gray-600 uppercase tracking-wider font-semibold px-1">Model</p>
              <input
                type="text"
                value={providerConfig.model}
                onChange={e => setModel(e.target.value)}
                className="w-full bg-[#151515] border border-gray-700 rounded px-3 py-2 text-[12px] text-gray-200 outline-none placeholder:text-gray-700 focus:border-purple-500"
              />
            </div>

            {/* Adapter status */}
            {adapterError && (
              <div className="p-3 bg-red-950/20 border border-red-800/30 rounded text-[11px] text-red-400">
                {adapterError}
              </div>
            )}

            {/* Create button */}
            <button
              onClick={handleApplyConfig}
              disabled={adapterStatus === 'creating' || !providerConfig.apiKey}
              className="w-full px-4 py-2.5 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-xs font-bold rounded border border-purple-600 disabled:border-gray-700 transition-colors"
            >
              {adapterStatus === 'creating' ? 'Starting...'
                : adapterStatus === 'running' ? 'Restart Adapter'
                : 'Start Claude Chat'}
            </button>

            {lastApplied && (
              <p className="text-center text-[9px] text-gray-700">Last applied: {lastApplied}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Render: adapter running → chat layout ──
  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-[#0a0a0a]">
      {/* Instance mismatch banner */}
      {!isActiveInstance && (
        <div className="shrink-0 px-4 py-2 bg-amber-900/20 border-b border-amber-700/30 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="text-[10px] text-amber-300">
              This tab is bound to a non-active instance.
            </span>
          </div>
          <button
            onClick={() => activateInstance(effectiveInstanceId)}
            className="text-[9px] px-2 py-1 bg-amber-700 hover:bg-amber-600 text-white rounded border border-amber-600 transition-colors shrink-0"
          >
            Switch to this instance
          </button>
        </div>
      )}

      {/* Thread bar */}
      <ThreadBar
        threads={threads}
        activeThreadId={activeThreadId}
        onSwitch={handleSwitchThread}
        onClose={handleCloseThread}
      />

      {/* Status bar */}
      <SessionStatusBar
        phase={displayPhase}
        connStatus={connStatus}
        isForkActive={threads.length > 1}
        threadCount={threads.length}
        messagesCount={parserTurns.length}
      />

      {/* Main content + Right panel */}
      <div className="flex flex-1 min-h-0 min-w-0">
        <MessageTimeline
          turns={parserTurns}
          phase={displayPhase}
          connStatus={connStatus}
          isRestoring={isRestoring}
          historyLoading={historyLoading}
          onFork={handleFork}
          onToggleOutput={handleToggleOutput}
          expandedOutputs={expandedToolOutputs}
          scrollRef={scrollContainerRef}
          endRef={actionEndRef}
        />

        <RightPanel
          open={rightPanelOpen}
          onToggle={() => setRightPanelOpen(o => !o)}
          turns={parserTurns}
          logs={logs}
          projectCwd={effectiveCwd}
          // Provider config panel props
          providerConfig={providerConfig}
          onSetProvider={setById}
          onSetApiKey={setApiKey}
          onSetModel={setModel}
          onSetBaseUrl={setBaseUrl}
          onApplyConfig={handleApplyConfig}
          adapterStatus={adapterStatus}
          adapterError={adapterError}
          isDirty={isDirty}
          lastApplied={lastApplied}
        />
      </div>

      {/* Input area */}
      <ChatInput
        inputValue={inputValue}
        setInputValue={setInputValue}
        handleSubmit={handleChatSubmit}
        handleInputChange={handleInputChange}
        handleKeyDown={handleKeyDown}
        showCommands={showCommands}
        setShowCommands={setShowCommands}
        handleCommandClick={handleCommandClick}
        cmdPanelRef={cmdPanelRef}
        showFileSuggest={showFileSuggest}
        fileSuggestions={fileSuggestions}
        handleFileSuggestionClick={handleFileSuggestionClick}
        phase={displayPhase}
        disabled={!isActiveInstance}
        handleInterrupt={handleInterrupt}
      />
    </div>
  );
}
