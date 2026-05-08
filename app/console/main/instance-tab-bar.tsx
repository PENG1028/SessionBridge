'use client';

import { useState } from 'react';
import { Plus, LayoutDashboard } from 'lucide-react';
import { getAdapterMeta, type AdapterMeta } from './view-registry';
import type { InstanceInfo } from '../../../lib/ws-client';

interface InstanceTabBarProps {
  instances: InstanceInfo[];
  activeInstanceId: string | null;
  onActivate: (id: string) => void;
  onCreate: (dir: string, adapterId: string) => void;
  projectCwd: string;
  /** Active workbench view ID (for highlighting system tabs). */
  activeViewId?: string;
  /** Callback when a system view tab is clicked. */
  onSelectSystemView?: (viewId: string) => void;
  /** Available adapter types for the + menu. */
  adapterTypes?: Array<{ id: string; meta: AdapterMeta }>;
}

export function InstanceTabBar({
  instances,
  activeInstanceId,
  onActivate,
  onCreate,
  projectCwd,
  activeViewId,
  onSelectSystemView,
  adapterTypes,
}: InstanceTabBarProps) {
  const [showNewMenu, setShowNewMenu] = useState(false);

  return (
    <div className="flex items-center border-b border-gray-800 bg-[#0a0a0a] shrink-0">
      <div className="flex-1 flex items-center overflow-x-auto">
        {/* System view tabs */}
        {onSelectSystemView && (
          <button
            onClick={() => onSelectSystemView('dashboard')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] border-r border-gray-800 transition-colors shrink-0 ${
              activeViewId === 'dashboard'
                ? 'bg-[#111] text-gray-200 border-b-2 border-b-purple-500'
                : 'text-gray-500 hover:text-gray-300 hover:bg-[#0d0d0d]'
            }`}
          >
            <LayoutDashboard className="w-3 h-3" />
            Dashboard
          </button>
        )}
        {instances.map(inst => {
          const isActive = inst.id === activeInstanceId;
          const meta = getAdapterMeta(inst.adapterId);
          return (
            <button
              key={inst.id}
              onClick={() => onActivate(inst.id)}
              onContextMenu={(e) => {
                e.preventDefault();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] border-r border-gray-800 transition-colors shrink-0 ${
                isActive
                  ? 'bg-[#111] text-gray-200 border-b-2 border-b-purple-500'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-[#0d0d0d]'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  inst.status === 'running'
                    ? 'bg-emerald-500/80'
                    : inst.status === 'starting'
                    ? 'bg-yellow-500'
                    : 'bg-gray-600'
                }`}
              />
              <span>
                {meta.emoji} {meta.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* + New dropdown */}
      <div className="relative">
        <button
          onClick={() => setShowNewMenu(v => !v)}
          className="px-2.5 text-[10px] text-gray-500 hover:text-gray-200 hover:bg-[#0d0d0d] border-l border-gray-800 shrink-0 transition-colors h-full"
        >
          <Plus className="w-3 h-3" />
        </button>
        {showNewMenu && adapterTypes && adapterTypes.length > 0 && (
          <div
            className="absolute top-full right-0 mt-1 z-50 bg-[#1a1a1a] border border-gray-700 rounded-lg shadow-2xl shadow-black/50 overflow-hidden min-w-[180px]"
            onMouseLeave={() => setShowNewMenu(false)}
          >
            {adapterTypes.map(({ id, meta }) => (
              <button
                key={id}
                onClick={() => {
                  onCreate(projectCwd || '.', id);
                  setShowNewMenu(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-gray-300 hover:bg-gray-800 transition-colors"
              >
                <span>{meta.emoji}</span> {meta.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
