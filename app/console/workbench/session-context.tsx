'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Phase, Message, Turn } from '../../lib/session-types';

// ── Context value type ─────────────────────────────────────

export interface SessionContextValue {
  messages: Message[];
  turns: Turn[];
  phase: Phase;
  setPhase: (p: Phase) => void;
  currentActivity: string | null;
  setCurrentActivity: (a: string | null) => void;
  connStatus: { status: string };
  isRestoring: boolean;
  historyLoading: boolean;
  sendCommand: (cmd: string, args?: Record<string, string>, sessionId?: string) => void;
  sendInput: (text: string, sessionId?: string) => void;
  handleInterrupt: () => void;
  setForkTarget: (v: number | null) => void;
  setForkPrompt: (v: string) => void;
}

// ── Context ────────────────────────────────────────────────

const SessionContext = createContext<SessionContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────

export function SessionProvider({
  value,
  children,
}: {
  value: SessionContextValue;
  children: ReactNode;
}) {
  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────

export function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSessionContext must be used within a SessionProvider');
  return ctx;
}
