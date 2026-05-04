'use client';

import { Cpu, Terminal as TerminalIcon, Sparkles, X, Plus } from 'lucide-react';

import type { InstanceInfo } from '../../../lib/ws-client';
export type { InstanceInfo };

interface InstanceListProps {
  instances: InstanceInfo[];
  activeInstanceId: string | null;
  onActivate: (id: string) => void;
  onCreate: () => void;
  onKill: (id: string) => void;
}

/** Get icon for instance based on adapter type */
function getInstanceIcon(inst: InstanceInfo) {
  const aid = inst.adapterId || '';
  if (aid === 'shell') return <TerminalIcon className="w-3 h-3 text-orange-400" />;
  if (aid === 'claude-code') return <Sparkles className="w-3 h-3 text-purple-400" />;
  return <Cpu className="w-3 h-3 text-gray-400" />;
}

/** Status dot color */
function statusColor(status: string) {
  switch (status) {
    case 'running': return 'bg-emerald-500/80';
    case 'starting': return 'bg-yellow-500 animate-pulse';
    case 'error': return 'bg-red-500';
    default: return 'bg-gray-600';
  }
}

export function InstanceList({ instances, activeInstanceId, onActivate, onCreate, onKill }: InstanceListProps) {
  const basename = (dir: string) => dir.replace(/\\/g, '/').split('/').filter(Boolean).pop() || dir;

  return (
    <div className="border-t border-gray-800 bg-[#111]">
      <div className="px-3 py-2 text-[10px] font-bold text-gray-500 flex items-center justify-between tracking-wider">
        <span className="flex items-center gap-1.5"><Cpu className="w-3 h-3" /> INSTANCES</span>
        <button
          onClick={onCreate}
          className="text-[9px] text-gray-600 hover:text-purple-400 transition-colors flex items-center gap-0.5"
          title="New instance"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>
      <div className="max-h-40 overflow-y-auto px-1 pb-2 text-[11px]">
        {instances.length === 0 ? (
          <div className="text-gray-700 text-[10px] px-2 py-1 italic">No instances</div>
        ) : (
          instances.map(inst => {
            const isActive = inst.id === activeInstanceId;
            return (
              <div
                key={inst.id}
                onClick={() => onActivate(inst.id)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                  isActive ? 'bg-purple-900/20 text-purple-200' : 'hover:bg-gray-800 text-gray-400'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusColor(inst.status)}`} />
                {getInstanceIcon(inst)}
                <span className="truncate flex-1">{inst.label}</span>
                {inst.source === 'remote' ? (
                  <span className="text-[8px] bg-cyan-900/30 text-cyan-400 px-1 rounded shrink-0">REMOTE</span>
                ) : (
                  <span className="text-[8px] bg-gray-800 text-gray-500 px-1 rounded shrink-0">LOCAL</span>
                )}
                <span className="text-[9px] text-gray-600 truncate max-w-[80px]">{basename(inst.dir)}</span>
                {!isActive && instances.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onKill(inst.id); }}
                    className="text-gray-600 hover:text-red-400 transition-colors shrink-0"
                    title="Kill instance"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
