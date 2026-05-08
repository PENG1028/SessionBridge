'use client';

import { type ViewType } from './workbench-state';

interface ViewSelectorProps {
  onSelect: (viewType: ViewType) => void;
}

const VIEW_OPTIONS: Array<{ type: ViewType; label: string; icon: string; desc: string }> = [
  { type: 'terminal', label: 'Terminal', icon: '>_', desc: 'Shell / REPL' },
  { type: 'claude-code', label: 'Claude Code', icon: '♢', desc: 'AI coding agent' },
  { type: 'dashboard', label: 'Dashboard', icon: '▦', desc: 'Session overview' },
  { type: 'logs', label: 'Logs', icon: '☰', desc: 'Server & app logs' },
  { type: 'agent-monitor', label: 'Agent Monitor', icon: '◎', desc: 'AI agent status' },
  { type: 'ai', label: 'AI Chat', icon: '◇', desc: 'General AI assistant' },
  { type: 'browser', label: 'Browser', icon: '🌐', desc: 'Web preview' },
  { type: 'file-explorer', label: 'File Explorer', icon: '📁', desc: 'Browse files' },
];

export function ViewSelector({ onSelect }: ViewSelectorProps) {
  return (
    <div className="p-2">
      <div className="text-[9px] text-gray-600 font-bold tracking-wider mb-2 px-1">OPEN VIEW</div>
      <div className="grid grid-cols-2 gap-1">
        {VIEW_OPTIONS.map(opt => (
          <button
            key={opt.type}
            onClick={() => onSelect(opt.type)}
            className="flex items-center gap-2 px-2 py-2 rounded bg-[#1a1a1a] border border-gray-700/50 hover:border-purple-600 hover:bg-gray-800 text-left transition-colors"
          >
            <span className="text-[11px] font-mono w-5 text-center text-purple-400">{opt.icon}</span>
            <div className="flex flex-col">
              <span className="text-[10px] text-gray-200 font-medium">{opt.label}</span>
              <span className="text-[8px] text-gray-600">{opt.desc}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
