'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CoreClient } from '../core/core-types';
import type { NodeInfo, SessionInfo, PluginInfo } from '../core/core-types';
import { PageHeader, PageLoading, PageError, PageEmpty, PageOffline, type PageState } from './page-utils';
import { listFromResponse, normalizeNodeInfo, normalizeSessionInfo } from './core-response-utils';

// ─── Dashboard Props ───────────────────────────────────────────
interface DashboardProps {
  core: CoreClient;
  onNavigate?: (route: string) => void;
}

/**
 * Dashboard — system overview page.
 * Calls: node.list, session.list, plugin.list
 * Events: node.health (WS), session.created/stopped (WS), plugin.registered (WS)
 *
 * Core truth: All data from Core. No caching. 30s auto-refresh or WS push.
 * UI preferences: card layout order (localStorage).
 */
export function Dashboard({ core, onNavigate }: DashboardProps) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function fetchData() {
    if (!core.isConnected) {
      setPageState('offline');
      return;
    }

    setPageState('loading');
    setError(null);

    try {
      const [nodeResult, sessionResult, pluginResult] = await Promise.all([
        core.call<unknown>('node.list'),
        core.call<unknown>('session.list'),
        core.call<unknown>('plugin.list'),
      ]);
      const normalizedNodes = listFromResponse<Partial<NodeInfo> & Record<string, unknown>>(nodeResult, 'nodes').map(normalizeNodeInfo);
      const normalizedSessions = listFromResponse<Partial<SessionInfo> & Record<string, unknown>>(sessionResult, 'sessions').map(normalizeSessionInfo);
      const normalizedPlugins = listFromResponse<PluginInfo>(pluginResult, 'plugins');

      setNodes(normalizedNodes);
      setSessions(normalizedSessions);
      setPlugins(normalizedPlugins);

      const hasData = normalizedNodes.length > 0
        || normalizedSessions.length > 0
        || normalizedPlugins.length > 0;

      setPageState(hasData ? 'ready' : 'empty');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
      setPageState('error');
    }
  }

  useEffect(() => {
    fetchData();
  }, [core]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [core]);

  const onlineNodes = nodes.filter(n => n.status === 'online').length;
  const runningSessions = sessions.filter(s => s.status === 'running').length;
  const enabledPlugins = plugins.filter(p => p.status === 'enabled').length;

  if (pageState === 'loading') return <div className="flex-1"><PageLoading rows={8} /></div>;
  if (pageState === 'offline') return <div className="flex-1"><PageOffline /></div>;
  if (pageState === 'error') return <div className="flex-1"><PageError message={error || 'Unknown error'} onRetry={fetchData} /></div>;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <PageHeader
        title="Dashboard"
        actions={
          <button
            onClick={fetchData}
            className="p-1.5 rounded hover:bg-[#1a1a1a] text-gray-400 hover:text-gray-200 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        }
      />

      <div className="p-4 space-y-4">
        {/* Stats cards */}
        <div className="grid grid-cols-4 gap-2">
          <DashboardCard
            label="Nodes"
            primary={String(nodes.length)}
            secondary={`${onlineNodes} online`}
            onClick={() => onNavigate?.('/nodes')}
          />
          <DashboardCard
            label="Sessions"
            primary={String(sessions.length)}
            secondary={`${runningSessions} running`}
            onClick={() => onNavigate?.('/sessions')}
          />
          <DashboardCard
            label="Plugins"
            primary={String(plugins.length)}
            secondary={`${enabledPlugins} enabled`}
            onClick={() => onNavigate?.('/plugins')}
          />
          <DashboardCard
            label="Errors"
            primary="—"
            secondary="last hour"
          />
        </div>

        {/* Node health section */}
        <div className="bg-[#111] rounded border border-gray-800">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
            <h2 className="text-[10px] font-mono text-gray-300">Node Health</h2>
            <button
              onClick={() => onNavigate?.('/nodes')}
              className="text-[9px] text-purple-400 hover:text-purple-300"
            >
              View All &gt;
            </button>
          </div>
          <div className="divide-y divide-gray-800">
            {nodes.length === 0 && (
              <div className="px-4 py-6 text-center text-gray-600 text-[10px]">No nodes configured</div>
            )}
            {nodes.map(node => (
              <div key={node.nodeId} className="flex items-center gap-3 px-4 py-2">
                <span className={`w-2 h-2 rounded-full ${node.status === 'online' ? 'bg-emerald-500' : 'bg-gray-600'}`} />
                <span className="text-gray-200 font-mono text-[10px]">{node.name}</span>
                <span className="text-gray-500 text-[9px]">{node.role || '—'}</span>
                <span className="text-gray-600 text-[9px] ml-auto">{node.uptime || ''}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Empty state when no data at all */}
        {pageState === 'empty' && nodes.length === 0 && sessions.length === 0 && plugins.length === 0 && (
          <div className="bg-[#111] rounded border border-gray-800 p-6 text-center">
            <p className="text-gray-400 text-[10px] font-mono">Cluster not configured yet. Install plugins and connect nodes to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DashboardCard ─────────────────────────────────────────────
function DashboardCard({
  label,
  primary,
  secondary,
  onClick,
}: {
  label: string;
  primary: string;
  secondary: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="bg-[#111] rounded border border-gray-800 p-3 text-left hover:border-purple-500/50 transition-colors"
    >
      <div className="text-[9px] text-gray-500 uppercase tracking-wide mb-1">{label}</div>
      <div className="text-xl font-mono text-gray-200">{primary}</div>
      <div className="text-[9px] text-gray-500 mt-1">{secondary}</div>
    </button>
  );
}
