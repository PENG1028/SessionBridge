'use client';

import { GitBranch } from 'lucide-react';

interface Turn {
  userMsg: { timestamp: string; content: string };
  assistantMsgs: any[];
}

export interface ForkDialogProps {
  forkTarget: number;
  turn: Turn;
  forkPrompt: string;
  setForkPrompt: (v: string) => void;
  onClose: () => void;
  onRewind: (targetIdx: number) => void;
  onForkSnapshot: (targetIdx: number) => void;
  onForkWithPrompt: (targetIdx: number, prompt: string) => void;
}

export function ForkDialog({
  forkTarget,
  turn,
  forkPrompt,
  setForkPrompt,
  onClose,
  onRewind,
  onForkSnapshot,
  onForkWithPrompt,
}: ForkDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-[#151515] border border-gray-700 rounded-lg w-full max-w-lg shadow-2xl shadow-black/60" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-gray-800">
          <div className="flex items-center gap-2 text-xs text-gray-300">
            <GitBranch className="w-4 h-4 text-purple-400" />
            Fork Conversation
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">&times;</button>
        </div>
        <div className="p-4 space-y-4">
          <div className="bg-[#0a0a0a] border border-gray-800 rounded p-3 text-xs text-gray-400 max-h-24 overflow-y-auto">
            <span className="text-purple-400 font-bold">@{turn.userMsg.timestamp}</span>
            <span className="text-gray-200 ml-2">{turn.userMsg.content.slice(0, 200)}</span>
            {turn.userMsg.content.length > 200 && <span className="text-gray-600">...</span>}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onRewind(forkTarget)}
              className="flex-1 px-3 py-2 bg-amber-700 hover:bg-amber-600 text-white text-xs font-bold rounded transition-colors"
            >
              ↩ Rewind to here
            </button>
            <button
              onClick={() => onForkSnapshot(forkTarget)}
              className="flex-1 px-3 py-2 bg-purple-700 hover:bg-purple-600 text-white text-xs font-bold rounded transition-colors"
            >
              <GitBranch className="w-3 h-3 inline-block mr-1" />
              Fork as Snapshot
            </button>
          </div>

          <div>
            <label className="text-[10px] text-gray-500 block mb-1">Optional: send a new prompt after fork</label>
            <div className="flex gap-2">
              <input
                type="text" value={forkPrompt}
                onChange={e => setForkPrompt(e.target.value)}
                placeholder="Continue with..."
                className="flex-1 bg-[#0d0d0d] border border-gray-700 rounded px-3 py-2 text-xs text-gray-200 outline-none focus:border-purple-500"
                autoFocus
              />
              <button
                onClick={() => {
                  if (!forkPrompt.trim()) return;
                  onForkWithPrompt(forkTarget, forkPrompt);
                }}
                disabled={!forkPrompt.trim()}
                className="px-3 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold rounded transition-colors"
              >
                Send
              </button>
            </div>
          </div>

          <div className="text-[9px] text-gray-600 leading-relaxed">
            <p><strong className="text-gray-500">Rewind:</strong> discard messages after this turn and continue from here.</p>
            <p><strong className="text-gray-500">Fork:</strong> save current state as snapshot, then optionally send a new prompt from this point.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
