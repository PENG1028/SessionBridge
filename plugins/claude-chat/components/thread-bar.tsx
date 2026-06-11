'use client';

import { GitBranch } from 'lucide-react';

interface ThreadInfo {
  id: string;
  label: string;
  isOriginal: boolean;
}

interface ThreadBarProps {
  threads: ThreadInfo[];
  activeThreadId: string;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
}

export function ThreadBar({ threads, activeThreadId, onSwitch, onClose }: ThreadBarProps) {
  if (threads.length <= 1) return null;

  return (
    <div className="flex items-center h-9 px-3 gap-1 border-b border-gray-800 bg-neutral-950/30 shrink-0 overflow-x-auto">
      {threads.map(t => {
        const isActive = t.id === activeThreadId;
        return (
          <div
            key={t.id}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap transition-colors cursor-pointer select-none ${
              isActive
                ? 'bg-purple-900/20 text-purple-300'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
            }`}
            onClick={() => onSwitch(t.id)}
          >
            {/* Fork icon for non-original threads */}
            {!t.isOriginal && <GitBranch className="w-3 h-3 shrink-0" />}
            <span>{t.label}</span>
            {/* Close button for non-original threads */}
            {!t.isOriginal && (
              <button
                onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
                className="ml-0.5 p-0.5 rounded text-gray-600 hover:text-gray-300 hover:bg-gray-700 transition-colors"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
