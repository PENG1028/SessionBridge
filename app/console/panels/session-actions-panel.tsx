'use client';

interface SessionActionsPanelProps {
  onNewSession?: () => void;
  onQuickCompact?: () => void;
  onSaveSnapshot?: () => void;
}

export function SessionActionsPanel(props: SessionActionsPanelProps) {
  const { onNewSession, onQuickCompact, onSaveSnapshot } = props;

  return (
    <div className="p-3 border-b border-gray-800 bg-[#111] space-y-2">
      <div className="text-[10px] text-gray-500 font-bold tracking-wider">ACTIONS</div>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={onNewSession}
          className="flex-1 px-2 py-1.5 bg-[#1a1a1a] hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] rounded border border-gray-700 transition-colors">
          + New Session
        </button>
        <button onClick={onQuickCompact}
          className="px-2 py-1.5 bg-[#1a1a1a] hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] rounded border border-gray-700 transition-colors"
          title="Compress context to free tokens">
          /compact
        </button>
        <button onClick={onSaveSnapshot}
          className="px-2 py-1.5 bg-[#1a1a1a] hover:bg-gray-800 text-gray-400 hover:text-gray-200 text-[10px] rounded border border-gray-700 transition-colors"
          title="Save current conversation as snapshot">
          + Snapshot
        </button>
      </div>
    </div>
  );
}
