'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, Bot, Zap, Activity, Shield } from 'lucide-react';
import type { CoreClient, PluginInfo, RunInfo, BlockerEntry } from '../../core/core-types';
import { PageHeader, PageLoading, PageError, PageEmpty, PageOffline, type PageState } from './page-utils';
import { listFromResponse } from './core-response-utils';

interface AIManagerProps {
  core: CoreClient;
  onNavigate?: (route: string) => void;
}

interface ReadinessResult {
  status: string;
  blockers: BlockerEntry[];
}

export function AIManager({ core, onNavigate }: AIManagerProps) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [error, setError] = useState<string | null>(null);

  const [aiPlugins, setAiPlugins] = useState<PluginInfo[]>([]);
  const [activeRuns, setActiveRuns] = useState<RunInfo[]>([]);
  const [readiness, setReadiness] = useState<Record<string, ReadinessResult>>({});
  const [checkRunning, setCheckRunning] = useState(false);

  async function fetchAll() {
    if (!core.isConnected) {
      setPageState('offline');
      return;
    }

    setPageState('loading');
    setError(null);

    try {
      const [pluginResult, runResult] = await Promise.all([
        core.call<unknown>('plugin.list'),
        core.call<unknown>('run.list'),
      ]);

      const allPlugins = listFromResponse<PluginInfo>(pluginResult, 'plugins');
      const allRuns = listFromResponse<RunInfo>(runResult, 'runs');

      // AI plugins: those with AI-related capabilities
      const ai = allPlugins.filter(p => {
        const caps = p.capabilities || [];
        return caps.some((c: string) =>
          c.startsWith('ai.') || c.startsWith('llm.') || c.startsWith('agent.') || c === 'chat.completion'
        );
      });

      setAiPlugins(ai);
      setActiveRuns(allRuns);

      const hasData = ai.length > 0 || allRuns.length > 0;
      setPageState(hasData ? 'ready' : 'empty');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load AI data');
      setPageState('error');
    }
  }

  async function runReadinessChecks() {
    setCheckRunning(true);
    const results: Record<string, ReadinessResult> = {};
    const tasks = aiPlugins.map(async (p) => {
      try {
        const res = await core.call<{ status: string; blockers?: BlockerEntry[] }>('plugin.check', { pluginId: p.pluginId });
        results[p.pluginId] = {
          status: res?.status || 'ok',
          blockers: Array.isArray(res?.blockers) ? res.blockers as BlockerEntry[] : [],
        };
      } catch {
        results[p.pluginId] = { status: 'error', blockers: [] };
      }
    });
    await Promise.allSettled(tasks);
    setReadiness(results);
    setCheckRunning(false);
  }

  useEffect(() => {
    fetchAll();
    const unsub = core.on('connectionStatus', () => { if (core.isConnected) fetchAll(); });
    return () => { unsub(); };
  }, [core]);

  const aiRuns = useMemo(() =>
    activeRuns.filter(r => r.pluginId && aiPlugins.some(p => p.pluginId === r.pluginId)),
    [activeRuns, aiPlugins]
  );

  const readyCount = useMemo(() =>
    Object.values(readiness).filter(r => r.status === 'ok').length,
    [readiness]
  );

  if (pageState === 'loading') return <div className="flex-1"><PageLoading rows={6} /></div>;
  if (pageState === 'offline') return <div className="flex-1"><PageOffline /></div>;
  if (pageState === 'error') return <div className="flex-1"><PageError message={error || 'Unknown error'} onRetry={fetchAll} /></div>;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <PageHeader
        title="AI / Agents"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={runReadinessChecks}
              disabled={checkRunning || aiPlugins.length === 0}
              className="text-xs px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors disabled:opacity-50"
              title="Check readiness of all AI plugins"
            >
              {checkRunning ? 'Checking...' : 'Check Readiness'}
            </button>
            <button
              onClick={fetchAll}
              className="p-2 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        }
      />

      {pageState === 'empty' ? (
        <div className="flex-1 flex items-center justify-center">
          <PageEmpty
            title="No AI plugins detected"
            description="Install an AI plugin (LLM provider, agent runtime, etc.) to get started. AI plugins declare ai.* or llm.* capabilities."
          />
        </div>
      ) : (
        <div className="p-6 space-y-6">
          {/* ─── AI Plugins Section ─────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Bot size={16} className="text-purple-400" />
              <h2 className="text-sm font-semibold text-gray-200">AI Plugins</h2>
              <span className="text-xs text-gray-600">({aiPlugins.length})</span>
            </div>

            {aiPlugins.length === 0 ? (
              <p className="text-xs text-gray-500">No AI-capable plugins found. Install an LLM or agent plugin.</p>
            ) : (
              <div className="space-y-2">
                {aiPlugins.map(plugin => {
                  const r = readiness[plugin.pluginId];
                  return (
                    <div
                      key={plugin.pluginId}
                      className="flex items-center gap-4 px-4 py-3 rounded-lg border border-gray-800 bg-gray-900"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-200">{plugin.pluginId}</span>
                          <span className="text-xs text-gray-600">{plugin.version}</span>
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            plugin.status === 'enabled' ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'
                          }`}>
                            {plugin.status}
                          </span>
                        </div>
                        {plugin.description && (
                          <p className="text-xs text-gray-500 mt-0.5">{plugin.description}</p>
                        )}
                        {plugin.capabilities && plugin.capabilities.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {plugin.capabilities.map((cap: string) => (
                              <span key={cap} className="text-[10px] px-1.5 py-0.5 bg-gray-800 text-gray-500 rounded">{cap}</span>
                            ))}
                          </div>
                        )}
                        {r && (
                          <div className="text-xs mt-1">
                            <span className={
                              r.status === 'ok' ? 'text-green-500' :
                              r.status === 'blocked' ? 'text-red-500' :
                              'text-yellow-500'
                            }>
                              {r.status === 'blocked' ? '[BLOCKED]' : r.status === 'incomplete' ? '[WARN]' : '[OK]'} {r.status}
                            </span>
                            {r.blockers.length > 0 && (
                              <span className="text-red-400 ml-2">
                                {r.blockers.length} blocker{r.blockers.length > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      <button
                        onClick={() => onNavigate?.(`/plugin-detail/${plugin.pluginId}`)}
                        className="text-xs px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors"
                      >
                        Detail
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ─── Active Runs Section ────────────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Activity size={16} className="text-blue-400" />
              <h2 className="text-sm font-semibold text-gray-200">Active AI Runs</h2>
              <span className="text-xs text-gray-600">({aiRuns.length})</span>
            </div>

            {aiRuns.length === 0 ? (
              <p className="text-xs text-gray-500">No active AI runs. Start an agent or chat session to see runs here.</p>
            ) : (
              <div className="space-y-2">
                {aiRuns.map(run => (
                  <div
                    key={run.runId}
                    className="flex items-center gap-4 px-4 py-3 rounded-lg border border-gray-800 bg-gray-900"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-400">{run.runId}</span>
                        <span className="text-xs text-gray-600">{run.kind}</span>
                        {run.label && <span className="text-xs text-gray-500">{run.label}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          run.state === 'running' ? 'bg-green-900/50 text-green-400' :
                          run.state === 'stopped' ? 'bg-gray-800 text-gray-500' :
                          'bg-yellow-900/50 text-yellow-400'
                        }`}>
                          {run.state}
                        </span>
                        {run.pluginId && (
                          <span className="text-xs text-gray-600">{run.pluginId}</span>
                        )}
                        {run.sessionId && (
                          <span className="text-xs text-gray-600">session: {run.sessionId}</span>
                        )}
                      </div>
                    </div>

                    {run.process && (
                      <div className="text-xs text-gray-500">
                        PID {run.process.pid ?? '—'} | {run.process.state ?? 'unknown'}
                      </div>
                    )}

                    <button
                      onClick={() => onNavigate?.(`/sessions`)}
                      className="text-xs px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 transition-colors"
                    >
                      View Session
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ─── Readiness Summary Section ───────────────────────── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Shield size={16} className="text-green-400" />
              <h2 className="text-sm font-semibold text-gray-200">Readiness</h2>
              {Object.keys(readiness).length > 0 && (
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  readyCount === aiPlugins.length && aiPlugins.length > 0
                    ? 'bg-green-900/50 text-green-400'
                    : 'bg-yellow-900/50 text-yellow-400'
                }`}>
                  {readyCount}/{aiPlugins.length} ready
                </span>
              )}
            </div>

            {Object.keys(readiness).length === 0 ? (
              <p className="text-xs text-gray-500">Run "Check Readiness" to verify all AI plugins.</p>
            ) : (
              <div className="space-y-2">
                {aiPlugins.map(plugin => {
                  const r = readiness[plugin.pluginId];
                  if (!r) return null;
                  return (
                    <div key={plugin.pluginId} className="flex items-center gap-3 px-3 py-2 bg-gray-900 rounded-lg border border-gray-800 text-sm">
                      <span className={`w-2 h-2 rounded-full ${
                        r.status === 'ok' ? 'bg-green-500' :
                        r.status === 'blocked' ? 'bg-red-500' :
                        'bg-yellow-500'
                      }`} />
                      <span className="text-gray-200">{plugin.pluginId}</span>
                      <span className={`text-xs ${
                        r.status === 'ok' ? 'text-green-400' :
                        r.status === 'blocked' ? 'text-red-400' :
                        'text-yellow-400'
                      }`}>
                        {r.status}
                      </span>
                      {r.blockers.length > 0 && (
                        <button
                          onClick={() => onNavigate?.(`/plugin-detail/${plugin.pluginId}`)}
                          className="text-xs text-blue-400 hover:text-blue-300 ml-auto"
                        >
                          View {r.blockers.length} blocker{r.blockers.length > 1 ? 's' : ''}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
