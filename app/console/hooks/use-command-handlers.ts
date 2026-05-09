'use client';

import { useState, useRef, useCallback } from 'react';

export type Phase = 'idle' | 'running' | 'done' | 'error';

export function useCommandHandlers(
  connStatus: { status: string },
  phase: Phase,
  setPhase: (p: Phase) => void,
  setCurrentActivity: (a: string | null) => void,
  sendInput: (text: string, sessionId?: string) => void,
  sendCommand: (cmd: string, args?: any) => void,
  addLog: (msg: string) => void,
  activeSessionId: string | null | undefined,
  fileTree: Record<string, { items: any[]; loaded: boolean }>,
  handleInterrupt?: () => void,
) {
  const [inputValue, setInputValue] = useState('');
  const [showFileSuggest, setShowFileSuggest] = useState(false);
  const [fileSuggestions, setFileSuggestions] = useState<any[]>([]);
  const [atPos, setAtPos] = useState(0);
  const submittingRef = useRef(false);
  const [showCommands, setShowCommands] = useState(false);

  const handleSubmit = useCallback((overrideCmd?: string) => {
    const cmd = (overrideCmd || inputValue).trim();
    if (!cmd || phase === 'running' || submittingRef.current) return;
    submittingRef.current = true;
    if (connStatus.status !== 'connected') {
      addLog('[System] Cannot send — not connected to relay');
      submittingRef.current = false;
      return;
    }
    setInputValue('');

    if (cmd === '/rewind') {
      setCurrentActivity('Rewinding last change...');
      sendCommand('rewind');
      submittingRef.current = false;
      return;
    }
    if (cmd === '/rewind-all') {
      setCurrentActivity('Rewinding all changes...');
      sendCommand('rewind-all');
      submittingRef.current = false;
      return;
    }

    setPhase('running');
    setCurrentActivity('Processing...');
    sendInput(cmd, activeSessionId || undefined);
  }, [inputValue, phase, connStatus.status, sendInput, sendCommand, activeSessionId, setPhase, setCurrentActivity, addLog]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    const atIdx = val.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || val[atIdx - 1] === ' ')) {
      const query = val.slice(atIdx + 1).toLowerCase();
      setAtPos(atIdx);
      const root = fileTree['.']?.items || [];
      const flat: any[] = [];
      const walk = (items: any[]) => {
        for (const item of items) {
          if (item.name.toLowerCase().includes(query)) flat.push(item);
          const children = fileTree[item.path || item.name];
          if (children?.loaded) walk(children.items);
        }
      };
      walk(root);
      setFileSuggestions(flat.slice(0, 20));
      setShowFileSuggest(flat.length > 0);
    } else {
      setShowFileSuggest(false);
    }
  }, [fileTree]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && phase === 'running') {
      e.preventDefault();
      handleInterrupt?.();
      return;
    }
    if ((e.key === 'Enter' && !e.shiftKey) || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
      if (showFileSuggest && fileSuggestions.length > 0) {
        e.preventDefault();
        const selected = fileSuggestions[0];
        setInputValue(prev => prev.slice(0, atPos) + `@${selected.path || selected.name} `);
        setShowFileSuggest(false);
        return;
      }
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'ArrowUp' && !e.shiftKey && !showFileSuggest) {
      e.preventDefault();
    }
    if (e.key === 'Escape') setShowFileSuggest(false);
  }, [handleSubmit, showFileSuggest, fileSuggestions, atPos, phase, handleInterrupt]);

  const handleFileSuggestionClick = useCallback((item: any) => {
    setInputValue(prev => prev.slice(0, atPos) + `@${item.path || item.name} `);
    setShowFileSuggest(false);
  }, [atPos]);

  const handleQuickAction = useCallback((cmd: string) => {
    setInputValue(cmd);
  }, []);

  const handleCommandClick = useCallback((cmd: string) => {
    setInputValue(cmd + ' ');
    setShowCommands(false);
    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.msg-input');
      input?.focus();
    }, 50);
  }, []);

  return {
    inputValue,
    setInputValue,
    showFileSuggest,
    fileSuggestions,
    handleSubmit,
    handleInputChange,
    handleKeyDown,
    handleFileSuggestionClick,
    submittingRef,
    showCommands,
    setShowCommands,
    handleQuickAction,
    handleCommandClick,
  };
}
