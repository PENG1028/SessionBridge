'use client';

// ─── SessionListPanel ────────────────────────────────────────────
// Lists active sessions from Core. Used by terminal.sessions panel.

import { useState, useEffect } from 'react';
import type { HostComponentProps } from '../plugin-host/host-component-registry';

export function SessionListPanel({ core, config }: HostComponentProps) {
  if (!config) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-950 text-gray-500 text-xs">
        Sessions — not available in this context
      </div>
    );
  }

  const [sessions, setSessions] = useState<Array<{ sessionId: string; state: string; command: string }>>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try {
      const result = await core.call<{ sessions: Array<{ sessionId: string; state: string; command: string }> }>('session.list');
      setSessions(result?.sessions || []);
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-gray-950">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800 bg-gray-900 text-xs">
        <span className="text-gray-400 font-medium">{config.title}</span>
        <button onClick={refresh} className="text-gray-500 hover:text-gray-300">Refresh</button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 text-xs">
        {loading && <div className="text-gray-600 p-2">Loading...</div>}
        {!loading && sessions.length === 0 && <div className="text-gray-600 p-2">No active sessions.</div>}
        {sessions.map(s => (
          <div key={s.sessionId} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-900 rounded">
            <span className={`w-1.5 h-1.5 rounded-full ${s.state === 'running' ? 'bg-green-500' : 'bg-gray-600'}`} />
            <span className="text-gray-300 flex-1">{s.command || 'shell'}</span>
            <span className="text-gray-500">{s.sessionId.slice(0, 8)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
