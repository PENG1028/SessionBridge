'use client';

import { useState, useCallback } from 'react';
import type { Message, Turn } from '../../lib/session-types';

type Phase = 'idle' | 'running' | 'done' | 'error';

interface ForkActionsDeps {
  messagesBySession: Record<string, Message[]>;
  sessionKey: string;
  turns: Turn[];
  updateSession: (key: string, updater: (msgs: Message[]) => Message[]) => void;
  processedRef: React.MutableRefObject<number>;
  setPhase: (phase: Phase) => void;
  setCurrentActivity: (activity: string | null) => void;
  addLog: (msg: string) => void;
  saveSnapshot: (label: string) => void;
  setInputValue: React.Dispatch<React.SetStateAction<string>>;
}

export function useForkActions({
  messagesBySession,
  sessionKey,
  turns,
  updateSession,
  processedRef,
  setPhase,
  setCurrentActivity,
  addLog,
  saveSnapshot,
  setInputValue,
}: ForkActionsDeps) {
  const [forkTarget, setForkTarget] = useState<number | null>(null);
  const [forkPrompt, setForkPrompt] = useState('');

  const handleForkRewind = useCallback((targetIdx: number) => {
    const allMsgs = messagesBySession[sessionKey] || [];
    const turnMsgs: Message[] = [turns[targetIdx].userMsg, ...turns[targetIdx].assistantMsgs];
    const cutoffIdx = allMsgs.indexOf(turnMsgs[turnMsgs.length - 1]) + 1;
    updateSession(sessionKey, () => allMsgs.slice(0, cutoffIdx));
    processedRef.current = 0;
    setPhase('idle');
    setCurrentActivity(null);
    addLog(`[System] Rewound to turn ${targetIdx + 1}`);
    setForkTarget(null);
  }, [messagesBySession, sessionKey, turns, updateSession, processedRef, setPhase, setCurrentActivity, addLog]);

  const handleForkSnapshot = useCallback((targetIdx: number) => {
    saveSnapshot(`Fork from turn ${targetIdx + 1}`);
    const targetText = turns[targetIdx].userMsg.content;
    addLog(`[System] Forked from turn ${targetIdx + 1}: "${targetText.slice(0, 60)}..."`);
    setForkTarget(null);
  }, [saveSnapshot, turns, addLog]);

  const handleForkWithPrompt = useCallback((targetIdx: number, prompt: string) => {
    saveSnapshot(`Fork from turn ${targetIdx + 1}`);
    const targetText = turns[targetIdx].userMsg.content;
    addLog(`[System] Forked from turn ${targetIdx + 1}: "${targetText.slice(0, 60)}..." → "${prompt.slice(0, 60)}"`);
    setInputValue(prompt);
    setForkTarget(null);
    // Focus the message input after the next frame commit. Using rAF instead of
    // setTimeout avoids a magic delay — rAF fires after React commits the new
    // DOM but before paint, so the input is guaranteed to be in the tree.
    // Debt: replace document.querySelector with a ref when InputProvider exposes
    // a focusInput() callback through context.
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('.msg-input');
      input?.focus();
    });
  }, [saveSnapshot, turns, addLog, setInputValue]);

  return {
    forkTarget,
    setForkTarget,
    forkPrompt,
    setForkPrompt,
    handleForkRewind,
    handleForkSnapshot,
    handleForkWithPrompt,
  };
}
