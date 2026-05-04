'use client';

import { Folder, History, Clock } from 'lucide-react';

interface SearchResultsPanelProps {
  results: any[];
  onClose: (v: boolean) => void;
  onLog: (msg: string) => void;
  onLoadSession: (sessionId: string, project: string, display?: string) => void;
}

export function SearchResultsPanel({ results, onClose, onLog, onLoadSession }: SearchResultsPanelProps) {
  const grouped = new Map<string, any[]>();
  for (const r of results) {
    const key = r.project || 'Unknown';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  return (
    <>
      {Array.from(grouped.entries()).map(([project, sessions]) => (
        <div key={project}>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0d0d0d] border-b border-gray-800 sticky top-0">
            <Folder className="w-3 h-3 text-yellow-600 shrink-0" />
            <span className="text-[10px] text-gray-400 font-bold truncate">{project.replace(/\\/g, '/')}</span>
            <span className="text-[9px] text-gray-700 ml-auto">{sessions.length}</span>
          </div>
          {sessions.map((s: any) => (
            <button key={s.sessionId} onClick={() => {
              onLoadSession(s.sessionId, s.project, s.display);
              onLog(`[Search] Loading session: ${(s.display || s.sessionId).slice(0, 100)}`);
            }}
              className="w-full flex flex-col gap-0.5 px-3 py-2 hover:bg-gray-800 text-left border-b border-gray-800/50 transition-colors"
            >
              <div className="flex items-start gap-2">
                <History className="w-3 h-3 text-gray-600 mt-0.5 shrink-0" />
                <span className="text-[11px] text-gray-200 line-clamp-2 leading-snug">
                  {s.display ? s.display.slice(0, 200) : '(no preview)'}
                </span>
              </div>
              <div className="flex items-center gap-2 pl-5">
                <Clock className="w-2.5 h-2.5 text-gray-700" />
                <span className="text-[9px] text-gray-600">
                  {s.timestamp ? new Date(s.timestamp).toLocaleString() : 'Unknown date'}
                </span>
                {s.matchedIn && (
                  <span className="text-[8px] text-purple-600 bg-purple-900/20 px-1 rounded">
                    {s.matchedIn === 'content' ? 'matched content' : s.matchedIn}
                  </span>
                )}
              </div>
              {s.snippet && (
                <div className="pl-5 text-[9px] text-gray-500 bg-[#0a0a0a] mt-1 p-1.5 rounded border border-gray-800 leading-relaxed line-clamp-2">
                  ...{s.snippet}...
                </div>
              )}
            </button>
          ))}
        </div>
      ))}
    </>
  );
}
