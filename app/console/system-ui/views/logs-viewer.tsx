'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import type { CoreClient } from '../../core/core-types';
import { PageHeader, PageLoading, PageError, PageOffline, type PageState } from './page-utils';

type LogTab = 'core' | 'audit' | 'plugin-logs' | 'events' | 'install';

const LOG_TABS: { id: LogTab; label: string }[] = [
  { id: 'core', label: 'Core Logs' },
  { id: 'audit', label: 'Audit Trail' },
  { id: 'plugin-logs', label: 'Plugin Logs' },
  { id: 'events', label: 'Events' },
  { id: 'install', label: 'Install' },
];

interface LogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
}

interface AuditEntry {
  timestamp: string;
  type: string;
  actor: string;
  target: string;
}

interface LogsViewerProps {
  core: CoreClient;
}

/**
 * Logs & Audit — unified log viewing page.
 * Core API separation:
 *   - Diagnostic logs → logs.tail / logs.query (stream history NOT mixed here)
 *   - Audit → audit.list / audit.get
 *   - Session events → session.events
 *   - Plugin install history → plugin.history
 *
 * Stream history is in Sessions page, NOT in Logs & Audit.
 */
export function LogsViewer({ core }: LogsViewerProps) {
  const [pageState, setPageState] = useState<PageState>('loading');
  const [activeTab, setActiveTab] = useState<LogTab>('core');
  const [logLines, setLogLines] = useState<LogEntry[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function fetchCoreLogs() {
    if (!core.isConnected) { setPageState('offline'); return; }
    setPageState('loading');
    setError(null);
    try {
      const result = await core.call<{ lines: LogEntry[] }>('logs.tail', { source: 'core', lines: 100 });
      setLogLines(result?.lines || []);
      setPageState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load logs');
      setPageState('error');
    }
  }

  async function fetchAuditLogs() {
    if (!core.isConnected) { setPageState('offline'); return; }
    setPageState('loading');
    setError(null);
    try {
      const result = await core.call<{ entries: AuditEntry[] }>('audit.list');
      setAuditEntries(result?.entries || []);
      setPageState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit');
      setPageState('error');
    }
  }

  useEffect(() => {
    if (activeTab === 'core' || activeTab === 'plugin-logs') {
      fetchCoreLogs();
    } else if (activeTab === 'audit') {
      fetchAuditLogs();
    } else {
      setPageState('ready');
    }
  }, [core, activeTab]);

  if (pageState === 'loading') return <div className="flex-1"><PageLoading rows={8} /></div>;
  if (pageState === 'offline') return <div className="flex-1"><PageOffline /></div>;
  if (pageState === 'error') return <div className="flex-1"><PageError message={error || 'Unknown error'} />{null}</div>;

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      <PageHeader
        title="Logs & Audit"
        actions={
          <button
            onClick={activeTab === 'audit' ? fetchAuditLogs : fetchCoreLogs}
            className="p-2 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={16} />
          </button>
        }
      />

      {/* Tab switcher */}
      <div className="flex border-b border-gray-800 px-6 overflow-x-auto">
        {LOG_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 p-4">
        {activeTab === 'audit' ? (
          <AuditContent entries={auditEntries} />
        ) : activeTab === 'events' ? (
          <div className="text-gray-500 text-sm">Session events timeline (Phase 2). Uses session.events API.</div>
        ) : activeTab === 'install' ? (
          <div className="text-gray-500 text-sm">Plugin install history (Phase 2). Uses plugin.history API.</div>
        ) : (
          <LogContent lines={logLines} />
        )}
      </div>
    </div>
  );
}

function LogContent({ lines }: { lines: LogEntry[] }) {
  if (lines.length === 0) {
    return <div className="text-gray-500 text-sm">No log entries.</div>;
  }

  const levelColors: Record<string, string> = {
    INFO: 'text-blue-400',
    WARN: 'text-yellow-400',
    ERROR: 'text-red-400',
    DEBUG: 'text-gray-500',
  };

  return (
    <div className="font-mono text-xs space-y-0.5">
      {lines.map((line, i) => (
        <div key={i} className="flex gap-2 hover:bg-gray-900 px-2 py-0.5 rounded">
          <span className="text-gray-600 flex-shrink-0">{line.timestamp}</span>
          <span className={`flex-shrink-0 ${levelColors[line.level] || 'text-gray-400'}`}>
            {line.level.padEnd(5)}
          </span>
          <span className="text-gray-500 flex-shrink-0">{line.source}</span>
          <span className="text-gray-300 break-all">{line.message}</span>
        </div>
      ))}
    </div>
  );
}

function AuditContent({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return <div className="text-gray-500 text-sm">No audit entries.</div>;
  }

  return (
    <div className="w-full text-sm">
      <div className="grid grid-cols-4 gap-4 px-3 py-2 text-xs text-gray-500 font-medium border-b border-gray-800">
        <span>Time</span>
        <span>Type</span>
        <span>Actor</span>
        <span>Target</span>
      </div>
      {entries.map((entry, i) => (
        <div key={i} className="grid grid-cols-4 gap-4 px-3 py-2 text-sm border-b border-gray-800/50 hover:bg-gray-900">
          <span className="text-gray-500 font-mono text-xs">{entry.timestamp}</span>
          <span className="text-gray-300">{entry.type}</span>
          <span className="text-gray-400">{entry.actor}</span>
          <span className="text-gray-400">{entry.target}</span>
        </div>
      ))}
    </div>
  );
}
