'use client';

import { useState } from 'react';
import { Globe, Key, Eye, EyeOff, Check, RefreshCw } from 'lucide-react';
import { PROVIDER_PRESETS, PRESET_CATEGORIES } from '../../config/provider-presets';
import type { ProviderConfig } from '../../hooks/use-provider-config';
import type { AdapterStatus } from '../../hooks/use-adapter-lifecycle';

// ─── Props ──────────────────────────────────────────

interface ProviderPanelProps {
  config: ProviderConfig;
  onSetProvider: (id: string) => void;
  onSetApiKey: (key: string) => void;
  onSetModel: (model: string) => void;
  onSetBaseUrl: (url: string) => void;
  onApply: () => void;
  adapterStatus?: AdapterStatus;
  adapterError?: string | null;
  isDirty?: boolean;
  lastApplied?: string | null;
}

// ─── Component ──────────────────────────────────────

export function ProviderPanel({
  config, onSetProvider, onSetApiKey, onSetModel, onSetBaseUrl, onApply,
  adapterStatus, adapterError, isDirty, lastApplied,
}: ProviderPanelProps) {
  const [showKey, setShowKey] = useState(false);

  const isRunning = adapterStatus === 'running';
  const isLoading = adapterStatus === 'creating';

  return (
    <div className="space-y-2 px-1 py-1">
      {/* ── Adapter status indicator ── */}
      <div className="px-2.5 py-1.5 flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full shrink-0 ${
          adapterStatus === 'running' ? 'bg-emerald-500'
          : adapterStatus === 'creating' ? 'bg-amber-500 animate-pulse'
          : adapterStatus === 'error' ? 'bg-red-500'
          : 'bg-gray-600'
        }`} />
        <span className={`text-[10px] font-medium ${
          adapterStatus === 'running' ? 'text-emerald-400'
          : adapterStatus === 'creating' ? 'text-amber-400'
          : adapterStatus === 'error' ? 'text-red-400'
          : 'text-gray-500'
        }`}>
          {adapterStatus === 'running' ? 'Connected'
            : adapterStatus === 'creating' ? 'Starting...'
            : adapterStatus === 'error' ? 'Error'
            : adapterStatus === 'stopped' ? 'Stopped'
            : 'Idle'}
        </span>
        {isDirty && <span className="text-[9px] text-amber-500 ml-auto">Unsaved</span>}
      </div>

      {/* ── Preset selection ── */}
      <div className="px-2.5 py-1 text-[9px] text-gray-600 uppercase tracking-wider font-semibold">
        Provider
      </div>
      <div className="max-h-[30vh] overflow-y-auto space-y-1 px-1">
        {PRESET_CATEGORIES.map(cat => {
          const presets = PROVIDER_PRESETS.filter(p => p.category === cat.id);
          if (!presets.length) return null;
          return (
            <div key={cat.id}>
              <p className="text-[8px] text-gray-700 px-1 py-0.5 uppercase tracking-wider">{cat.label}</p>
              {presets.map(preset => {
                const isActive = config.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => onSetProvider(preset.id)}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[11px] transition-colors text-left ${
                      isActive
                        ? 'bg-purple-900/20 text-purple-300 border border-purple-700/30'
                        : 'text-gray-400 hover:bg-gray-800/40 border border-transparent'
                    }`}
                  >
                    <Globe className="w-3 h-3 shrink-0" />
                    <span className="min-w-0 truncate flex-1">{preset.label}</span>
                    {isActive && <Check className="w-3 h-3 text-purple-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* ── API Key ── */}
      <div className="pt-2">
        <div className="px-2.5 py-1 text-[9px] text-gray-600 uppercase tracking-wider font-semibold flex items-center gap-1">
          <Key className="w-3 h-3" /> API Key
        </div>
        <div className="px-2">
          <div className="flex items-center gap-1 bg-[#151515] border border-gray-700 rounded px-2 py-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={config.apiKey}
              onChange={e => onSetApiKey(e.target.value)}
              placeholder="sk-..."
              className="flex-1 bg-transparent text-[10px] text-gray-200 outline-none placeholder:text-gray-700"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="text-gray-600 hover:text-gray-400 transition-colors p-0.5"
            >
              {showKey ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
          </div>
        </div>
      </div>

      {/* ── Model ── */}
      <div className="pt-1">
        <div className="px-2.5 py-1 text-[9px] text-gray-600 uppercase tracking-wider font-semibold">
          Model
        </div>
        <div className="px-2">
          <input
            type="text"
            value={config.model}
            onChange={e => onSetModel(e.target.value)}
            placeholder="claude-sonnet-4-6"
            className="w-full bg-[#151515] border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-200 outline-none placeholder:text-gray-700"
          />
        </div>
      </div>

      {/* ── Base URL (hidden for standard presets) ── */}
      {!PROVIDER_PRESETS.some(p => p.id === config.id) && (
        <div className="pt-1">
          <div className="px-2.5 py-1 text-[9px] text-gray-600 uppercase tracking-wider font-semibold">
            Base URL
          </div>
          <div className="px-2">
            <input
              type="text"
              value={config.baseUrl}
              onChange={e => onSetBaseUrl(e.target.value)}
              placeholder="https://api.anthropic.com/v1"
              className="w-full bg-[#151515] border border-gray-700 rounded px-2 py-1 text-[10px] text-gray-200 font-mono outline-none placeholder:text-gray-700"
            />
          </div>
        </div>
      )}

      {/* ── Error ── */}
      {adapterError && (
        <div className="px-2">
          <div className="p-2 bg-red-950/20 border border-red-800/30 rounded text-[10px] text-red-400">
            {adapterError}
          </div>
        </div>
      )}

      {/* ── Apply button ── */}
      <div className="px-2 pt-2">
        <button
          onClick={onApply}
          disabled={isLoading || !config.apiKey}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-[10px] font-bold rounded border border-purple-600 disabled:border-gray-700 transition-colors"
        >
          {isLoading ? (
            <><RefreshCw className="w-3 h-3 animate-spin" /> Restarting...</>
          ) : (
            <>{isRunning ? <RefreshCw className="w-3 h-3" /> : null} {isRunning ? 'Apply & Restart' : 'Start'}</>
          )}
        </button>
        {lastApplied && (
          <p className="text-center text-[9px] text-gray-700 mt-1">Applied: {lastApplied}</p>
        )}
      </div>
    </div>
  );
}
