'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocus } from '../workbench/focus-context';
import { useRuntimePolicy, type PermissionMode, type EffortLevel } from '../workbench/runtime-policy-context';
import { getAdapterMeta } from '../main/view-registry';

interface RuntimeControlCenterProps {
  /** Send mode change to relay server. */
  onSetMode?: (mode: string) => void;
  /** Send effort change to relay server. */
  onSetEffort?: (level: string) => void;
}

// ── Mode display config ──────────────────────────────────────

const MODE_CONFIG: Record<PermissionMode, { label: string; badge: string; color: string }> = {
  default:   { label: 'Ask before edits', badge: 'ASK',  color: 'text-yellow-400' },
  acceptEdits: { label: 'Edit automatically', badge: 'AUTO', color: 'text-emerald-400' },
  plan:      { label: 'Plan mode',           badge: 'PLAN', color: 'text-purple-400' },
};

const EFFORT_CONFIG: Record<EffortLevel, { badge: string; color: string }> = {
  low:    { badge: 'OFF', color: 'text-gray-600' },
  medium: { badge: 'ON',  color: 'text-purple-400' },
  high:   { badge: 'MAX', color: 'text-amber-400' },
};

// ── Component ────────────────────────────────────────────────

export function RuntimeControlCenter({ onSetMode, onSetEffort }: RuntimeControlCenterProps) {
  const { adapterId, paneViewType } = useFocus();
  const { activePolicy, setPolicy, activeScope } = useRuntimePolicy();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Outside click handler
  useEffect(() => {
    if (!showDropdown) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDropdown]);

  // Listen for Ctrl+Shift+M toggle event
  useEffect(() => {
    const handler = () => setShowDropdown(v => !v);
    window.addEventListener('toggle-mode-picker', handler);
    return () => window.removeEventListener('toggle-mode-picker', handler);
  }, []);

  const adapterLabel = paneViewType
    ? paneViewType === 'claude-code' ? 'Claude'
      : paneViewType === 'claude-chat' ? 'Claude'
      : paneViewType === 'terminal' ? 'Terminal'
      : paneViewType === 'dashboard' ? 'Dashboard'
      : paneViewType === 'logs' ? 'Logs'
      : paneViewType === 'agent-monitor' ? 'Monitor'
      : paneViewType === 'browser' ? 'Browser'
      : paneViewType.charAt(0).toUpperCase() + paneViewType.slice(1)
    : getAdapterMeta(adapterId ?? undefined).label;
  const modeCfg = MODE_CONFIG[activePolicy.permissionMode];
  const effortCfg = EFFORT_CONFIG[activePolicy.effortLevel];

  const handleModeChange = useCallback((mode: PermissionMode) => {
    setPolicy(activeScope, { permissionMode: mode });
    onSetMode?.(mode);
    setShowDropdown(false);
  }, [setPolicy, activeScope, onSetMode]);

  const handleEffortChange = useCallback((level: EffortLevel) => {
    setPolicy(activeScope, { effortLevel: level });
    onSetEffort?.(level);
    setShowDropdown(false);
  }, [setPolicy, activeScope, onSetEffort]);

  return (
    <div ref={dropdownRef} className="relative flex items-center gap-2 text-[10px] border-l border-gray-800 pl-3">
      {/* Focus target */}
      <span className="text-gray-500 font-mono"># {adapterLabel}</span>

      {/* Mode indicator */}
      <button
        onClick={() => setShowDropdown(v => !v)}
        className={`font-mono font-bold tracking-wider ${modeCfg.color} hover:brightness-125 transition-all cursor-pointer`}
        title={modeCfg.label}
      >
        [{modeCfg.badge}]
      </button>

      {/* Effort indicator */}
      <span className={`font-mono ${effortCfg.color}`}>
        THINK:{effortCfg.badge}
      </span>

      {/* Dropdown panel */}
      {showDropdown && (
        <div className="absolute bottom-full left-0 mb-1.5 bg-[#1a1a1a] border border-gray-700 shadow-2xl shadow-black/60 overflow-hidden z-50" style={{ minWidth: '220px' }}>
          {/* Permission mode section */}
          <div className="px-3 py-1.5 text-[9px] text-gray-600 font-bold tracking-wider border-b border-gray-800 bg-[#151515]">
            PERMISSION MODE
          </div>
          <div className="py-1">
            {(Object.entries(MODE_CONFIG) as [PermissionMode, typeof MODE_CONFIG['default']][]).map(([mode, cfg]) => {
              const isActive = activePolicy.permissionMode === mode;
              return (
                <button key={mode}
                  onClick={() => handleModeChange(mode)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-800 border-l-2 ${
                    isActive ? 'border-purple-500 bg-purple-900/10' : 'border-transparent'
                  }`}
                >
                  <span className={`font-mono font-bold text-[10px] ${cfg.color}`}>[{cfg.badge}]</span>
                  <div className="flex flex-col">
                    <span className={`text-[10px] ${isActive ? 'text-purple-300 font-bold' : 'text-gray-200'}`}>
                      {cfg.label}
                    </span>
                    <span className="text-[8px] text-gray-600">
                      {mode === 'default' ? 'Claude asks before each edit'
                       : mode === 'acceptEdits' ? 'Claude edits files directly'
                       : 'Claude plans before acting'}
                    </span>
                  </div>
                  {isActive && <span className="ml-auto text-purple-400 text-[9px] font-mono">&gt;</span>}
                </button>
              );
            })}
          </div>

          {/* Effort section */}
          <div className="border-t border-gray-800">
            <div className="px-3 py-1.5 text-[9px] text-gray-600 font-bold tracking-wider border-b border-gray-800 bg-[#151515]">
              THINKING EFFORT
            </div>
            <div className="py-1">
              {(Object.entries(EFFORT_CONFIG) as [EffortLevel, typeof EFFORT_CONFIG['low']][]).map(([level, cfg]) => {
                const isActive = activePolicy.effortLevel === level;
                return (
                  <button key={level}
                    onClick={() => handleEffortChange(level)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-800 border-l-2 ${
                      isActive ? 'border-purple-500 bg-purple-900/10' : 'border-transparent'
                    }`}
                  >
                    <span className={`font-mono font-bold text-[10px] ${cfg.color}`}>THINK:{cfg.badge}</span>
                    <div className="flex flex-col">
                      <span className={`text-[10px] ${isActive ? 'text-purple-300 font-bold' : 'text-gray-200'}`}>
                        {level === 'low' ? 'Off'
                         : level === 'medium' ? 'On'
                         : 'Max'}
                      </span>
                      <span className="text-[8px] text-gray-600">
                        {level === 'low' ? 'No extended thinking'
                         : level === 'medium' ? 'Enable extended thinking'
                         : 'Maximum thinking depth'}
                      </span>
                    </div>
                    {isActive && <span className="ml-auto text-purple-400 text-[9px] font-mono">&gt;</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
