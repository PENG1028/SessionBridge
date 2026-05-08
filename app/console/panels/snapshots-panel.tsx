'use client';

import { GitBranch, ChevronRight } from 'lucide-react';

interface SnapshotsPanelProps {
  snapshots?: { id: string; name: string; msgs: any[]; ts: string }[];
  onLoadSnapshot?: (id: string) => void;
  onForkSnapshot?: (id: string) => void;
}

export function SnapshotsPanel(props: SnapshotsPanelProps) {
  const { snapshots, onLoadSnapshot, onForkSnapshot } = props;

  if (!snapshots || snapshots.length === 0) return null;

  return (
    <div className="border-b border-gray-800 bg-[#111]">
      <div className="p-2 text-[10px] font-bold text-gray-500 flex items-center gap-2 tracking-wider">
        <GitBranch className="w-3 h-3" />
        SNAPSHOTS
        <span className="text-gray-700 font-normal">{snapshots.length}</span>
      </div>
      <div className="max-h-28 overflow-y-auto px-2 pb-2 space-y-0.5">
        {snapshots.slice().reverse().map(s => (
          <div key={s.id} className="flex items-center gap-1 group">
            <button
              onClick={() => onLoadSnapshot?.(s.id)}
              className="flex-1 flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] transition-colors text-left min-w-0"
              title={s.name}
            >
              <ChevronRight className="w-2 h-2 shrink-0 text-gray-600" />
              <span className="truncate text-[9px]">{s.name}</span>
              <span className="text-[7px] text-gray-700 ml-auto shrink-0">{s.ts.slice(5, 16)}</span>
            </button>
            <button
              onClick={() => onForkSnapshot?.(s.id)}
              className="opacity-0 group-hover:opacity-100 px-1 text-[8px] text-purple-600 hover:text-purple-400 transition-opacity"
              title="Fork from this snapshot"
            >fork</button>
          </div>
        ))}
      </div>
    </div>
  );
}
