'use client';

import { useEffect, useRef } from 'react';

/**
 * Global keyboard shortcuts (Ctrl+L, Ctrl+Shift+C, Ctrl+Shift+P, Ctrl+B,
 * Ctrl+Shift+M, Ctrl+R).
 */
export function useKeyboardShortcuts(
  messages: any[],
  onClearSession: () => void,
  onToggleCommandPalette: () => void,
  onToggleLeftSidebar: () => void,
  onRestart: () => void,
) {
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      // Ctrl+L: clear main output area
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        onClearSession();
        return;
      }
      // Ctrl+Shift+C: copy last assistant message
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'c') {
        e.preventDefault();
        const msgs = messagesRef.current;
        const lastAssistant = [...msgs].reverse().find((m: any) => m.role === 'assistant');
        if (lastAssistant?.content) {
          navigator.clipboard.writeText(lastAssistant.content).catch(() => {});
        }
        return;
      }
      // Ctrl+Shift+P: toggle command palette
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        onToggleCommandPalette();
        return;
      }
      // Ctrl+B: toggle left sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        onToggleLeftSidebar();
        return;
      }
      // Ctrl+Shift+M: toggle mode picker
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('toggle-mode-picker'));
        return;
      }
      // Ctrl+R: restart session (only if not focused in input)
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        onRestart();
        return;
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [onClearSession, onToggleCommandPalette, onToggleLeftSidebar, onRestart]);
}
