'use client';

import { Sparkles, AlertCircle } from 'lucide-react';
import type { Phase } from '../types';

interface SessionStatusBarProps {
  phase: Phase;
  connStatus: { status: string };
  isForkActive: boolean;
  threadCount: number;
  messagesCount: number;
}

const PHASE_META: Record<Phase, { label: string; dot: string; text: string }> = {
  idle:    { label: 'Idle',      dot: 'bg-gray-600',         text: 'text-gray-500' },
  running: { label: 'Running',   dot: 'bg-purple-500 animate-pulse', text: 'text-purple-400' },
  done:    { label: 'Completed', dot: 'bg-emerald-500',      text: 'text-emerald-400' },
  error:   { label: 'Error',     dot: 'bg-red-500',          text: 'text-red-400' },
};

export function SessionStatusBar({ phase, connStatus, isForkActive, threadCount, messagesCount }: SessionStatusBarProps) {
  const pm = PHASE_META[phase];
  const isConnected = connStatus.status === 'connected';

  return (
    <div className="flex items-center gap-3 px-4 h-9 border-b border-gray-800 bg-neutral-950/30 shrink-0">
      {/* ── Connection ── */}
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
      <span className={`text-[10px] font-medium ${isConnected ? 'text-emerald-400' : 'text-red-400'}`}>
        {isConnected ? 'Connected' : 'Disconnected'}
      </span>

      <span className="text-gray-700">·</span>

      {/* ── Phase ── */}
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pm.dot}`} />
      <span className={`text-[10px] font-medium ${pm.text}`}>{pm.label}</span>

      {/* ── Message count ── */}
      <span className="text-gray-700">·</span>
      <span className="text-[10px] text-gray-500">{messagesCount} messages</span>

      {/* ── Fork indicator ── */}
      {isForkActive && (
        <>
          <span className="text-gray-700">·</span>
          <span className="flex items-center gap-1 text-[10px] text-amber-400 font-medium">
            <Sparkles className="w-3 h-3" />
            {threadCount} threads
          </span>
        </>
      )}

      {/* ── Instance mismatch warning ── */}
      {/* This is shown as a banner in the message area, not here */}
    </div>
  );
}
