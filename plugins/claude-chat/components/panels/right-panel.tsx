'use client';

import { useState, useCallback, useRef } from 'react';
import { Terminal, FileCode, Activity, Database, Settings, ChevronRight } from 'lucide-react';
import type { Turn } from '../../types';
import type { ProviderConfig } from '../../hooks/use-provider-config';
import type { AdapterStatus } from '../../hooks/use-adapter-lifecycle';
import { StatusSummary } from './status-summary';
import { ToolList } from './tool-list';
import { FileList } from './file-list';
import { ActivityLog } from './activity-log';
import { DataPanel } from './data-panel';
import { ProviderPanel } from './provider-panel';

// ─── Types ──────────────────────────────────────────

type TabId = 'tools' | 'files' | 'log' | 'data' | 'provider';

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  { id: 'tools',    label: 'Tools',    icon: <Terminal className="w-3.5 h-3.5" /> },
  { id: 'files',    label: 'Files',    icon: <FileCode className="w-3.5 h-3.5" /> },
  { id: 'log',      label: 'Log',      icon: <Activity className="w-3.5 h-3.5" /> },
  { id: 'data',     label: 'Data',     icon: <Database className="w-3.5 h-3.5" /> },
  { id: 'provider', label: 'Provider', icon: <Settings className="w-3.5 h-3.5" /> },
];

// ─── Props ──────────────────────────────────────────

interface RightPanelProps {
  open: boolean;
  onToggle: () => void;
  turns: Turn[];
  logs: string[];
  projectCwd?: string;
  // Provider config
  providerConfig?: ProviderConfig;
  onSetProvider?: (id: string) => void;
  onSetApiKey?: (key: string) => void;
  onSetModel?: (model: string) => void;
  onSetBaseUrl?: (url: string) => void;
  onApplyConfig?: () => void;
  adapterStatus?: AdapterStatus;
  adapterError?: string | null;
  isDirty?: boolean;
  lastApplied?: string | null;
}

// ─── Component ──────────────────────────────────────

export function RightPanel({
  open, onToggle, turns, logs, projectCwd,
  providerConfig, onSetProvider, onSetApiKey, onSetModel, onSetBaseUrl,
  onApplyConfig, adapterStatus, adapterError, isDirty, lastApplied,
}: RightPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('tools');
  const [panelWidth, setPanelWidth] = useState(280);
  const panelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startW = panelWidth;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const onMove = (ev: PointerEvent) => {
      if (!isDragging.current) return;
      const delta = startX - ev.clientX;
      setPanelWidth(Math.min(480, Math.max(200, startW + delta)));
    };
    const onUp = () => {
      isDragging.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }, [panelWidth]);

  // ── Collapsed state: narrow rail ──
  if (!open) {
    return (
      <aside className="flex shrink-0 border-l border-gray-800 bg-[#0a0a0a] select-none">
        <div className="flex flex-col items-center w-[38px] py-2 gap-1">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={onToggle}
              className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
                activeTab === tab.id ? 'text-purple-400 bg-purple-900/15' : 'text-gray-600 hover:text-gray-400 hover:bg-gray-800/50'
              }`}
              title={tab.label}
            >
              {tab.icon}
            </button>
          ))}
        </div>
      </aside>
    );
  }

  // ── Expanded panel ──
  return (
    <aside ref={panelRef} className="flex shrink-0 border-l border-gray-800 bg-[#0a0a0a] relative select-none" style={{ width: panelWidth }}>
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* ── Tab bar ── */}
        <div className="flex items-center justify-between h-10 border-b border-gray-800 px-2 shrink-0 gap-0.5">
          <div className="flex items-center gap-0.5">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'bg-gray-800 text-gray-200'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                }`}
              >
                <span className={activeTab === tab.id ? 'text-purple-400' : 'text-gray-500'}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
          <button
            onClick={onToggle}
            className="flex h-6 w-6 items-center justify-center rounded text-gray-600 hover:text-gray-400 hover:bg-gray-800 transition-colors"
            title="Collapse panel"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* ── Status summary ── */}
        <StatusSummary turns={turns} logs={logs} />

        {/* ── Tab content ── */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'tools' && <ToolList turns={turns} />}
          {activeTab === 'files' && <FileList turns={turns} />}
          {activeTab === 'log' && <ActivityLog logs={logs} />}
          {activeTab === 'data' && <DataPanel turns={turns} projectCwd={projectCwd} />}
          {activeTab === 'provider' && providerConfig && (
            <ProviderPanel
              config={providerConfig}
              onSetProvider={onSetProvider!}
              onSetApiKey={onSetApiKey!}
              onSetModel={onSetModel!}
              onSetBaseUrl={onSetBaseUrl!}
              onApply={onApplyConfig!}
              adapterStatus={adapterStatus}
              adapterError={adapterError}
              isDirty={isDirty}
              lastApplied={lastApplied}
            />
          )}
        </div>
      </div>

      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-purple-500/20 active:bg-purple-500/30 transition-colors z-10"
        onPointerDown={handleResizeStart}
      />
    </aside>
  );
}
