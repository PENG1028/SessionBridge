'use client';

import { useMemo, useRef, useEffect } from 'react';
import { Terminal } from 'lucide-react';

// ─── Props ──────────────────────────────────────────

interface ActivityLogProps {
  logs: string[];
}

// ─── Component ──────────────────────────────────────

export function ActivityLog({ logs }: ActivityLogProps) {
  const endRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  if (logs.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 px-4">
        <div className="text-center space-y-1">
          <Terminal className="w-6 h-6 text-gray-700 mx-auto" />
          <p className="text-[10px] text-gray-600">No activity yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-1 py-1">
      <div className="max-h-[calc(100vh-320px)] overflow-y-auto space-y-0.5">
        {logs.map((log, i) => (
          <LogRow key={i} text={log} />
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// ─── LogRow ─────────────────────────────────────────

function LogRow({ text }: { text: string }) {
  const color = text.includes('Error') || text.includes('[Error]')
    ? 'text-red-400'
    : text.includes('✓') || text.includes('[System]')
    ? 'text-emerald-400'
    : text.includes('[Tokens]')
    ? 'text-purple-400'
    : 'text-gray-500';

  return (
    <div className={`text-[9px] font-mono whitespace-pre-wrap break-all leading-relaxed px-2.5 py-0.5 ${color}`}>
      {text}
    </div>
  );
}
