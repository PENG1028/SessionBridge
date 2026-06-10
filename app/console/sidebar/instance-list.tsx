'use client';

import { X } from 'lucide-react';

import type { InstanceInfo } from '../../../lib/use-ws';
export type { InstanceInfo };

interface InstanceListProps {
  instances: InstanceInfo[];
  activeInstanceId: string | null;
  onActivate: (id: string) => void;
  onKill: (id: string) => void;
}

function statusColor(status: string) {
  switch (status) {
    case 'running': return 'bg-emerald-500';
    case 'starting': return 'bg-yellow-500';
    case 'error': return 'bg-red-500';
    default: return 'bg-gray-600';
  }
}

export function InstanceList({ instances, activeInstanceId, onActivate, onKill }: InstanceListProps) {
  // Phase 4I: This list shows ALL instances. Clicking an instance sets
  // activeInstanceId (the "management selection" in the sidebar). It does
  // NOT auto-create tabs or auto-bind to the active tab. Tab is the
  // subject — instance is a tab's binding, set via Attach Existing or
  // Create New.
  if (instances.length === 0) {
    return <div className="text-gray-700 text-[10px] px-3 py-2 italic">No instances</div>;
  }

  return (
    <div className="px-1.5 pb-2 text-xs space-y-0.5">
      {instances.map(inst => {
        const isActive = inst.id === activeInstanceId;
        return (
          <div
            key={inst.id}
            onClick={() => onActivate(inst.id)}
            className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer transition-all ${
              isActive
                ? 'bg-purple-900/25 text-purple-100 ring-1 ring-purple-700/40'
                : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-300'
            }`}
          >
            {/* Status dot — single primary status indicator */}
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusColor(inst.status)} ${isActive ? 'ring-1 ring-purple-400/40' : ''}`} />

            {/* Label — primary info */}
            <span className={`truncate flex-1 ${isActive ? 'font-semibold text-sm' : 'font-medium text-[13px]'}`}>
              {inst.label}
            </span>

            {/* Source badge — secondary info */}
            {inst.source === 'remote' ? (
              <span className="text-[9px] bg-cyan-900/25 text-cyan-400 px-1.5 py-0.5 rounded font-mono font-medium shrink-0">
                REMOTE
              </span>
            ) : (
              <span className="text-[9px] bg-gray-800 text-gray-600 px-1.5 py-0.5 rounded font-mono shrink-0">
                LOCAL
              </span>
            )}

            {/* Directory — tertiary info (hidden on narrow) */}
            <span className="text-[10px] text-gray-600 truncate max-w-[90px] hidden sm:block font-mono">
              {inst.dir.replace(/\\/g, '/').split('/').filter(Boolean).pop() || inst.dir}
            </span>

            {/* Kill — visible on hover only */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onKill(inst.id);
              }}
              className="text-gray-700 hover:text-red-400 transition-colors shrink-0 opacity-30 group-hover:opacity-100 focus-visible:opacity-100"
              title="Kill instance"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
