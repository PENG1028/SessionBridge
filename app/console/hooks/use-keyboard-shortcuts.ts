'use client';

import { useEffect, useRef } from 'react';

interface MessageLike {
  role: string;
  content?: string;
}

/**
 * Global keyboard shortcuts with view-context awareness.
 * Claude-specific shortcuts (Ctrl+L, Ctrl+R, Ctrl+Shift+C, Ctrl+Shift+M) only
 * fire when the active view is claude-chat.
 */
export function useKeyboardShortcuts(
  messages: MessageLike[],
  onClearSession: () => void,
  onToggleCommandPalette: () => void,
  onToggleLeftSidebar: () => void,
  onRestart: () => void,
  enabled = true,
  activeViewId?: string,
) {
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const activeViewIdRef = useRef(activeViewId);
  activeViewIdRef.current = activeViewId;

  useEffect(() => {
    if (!enabled) return;
    const isClaude = () => !activeViewIdRef.current || activeViewIdRef.current === 'claude-chat';

    const handleGlobalKey = (e: KeyboardEvent) => {
      // Ctrl+L: clear session (claude-chat only)
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        if (!isClaude()) return;
        e.preventDefault();
        onClearSession();
        return;
      }
      // Ctrl+Shift+C: copy last assistant message (claude-chat only)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'c') {
        if (!isClaude()) return;
        e.preventDefault();
        const msgs = messagesRef.current;
        const lastAssistant = [...msgs].reverse().find(m => m.role === 'assistant');
        if (lastAssistant?.content) {
          navigator.clipboard.writeText(lastAssistant.content).catch(() => {});
        }
        return;
      }
      // Ctrl+Shift+P: toggle command palette (all views)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        onToggleCommandPalette();
        return;
      }
      // Ctrl+B: toggle left sidebar (all views)
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        e.preventDefault();
        onToggleLeftSidebar();
        return;
      }
      // Ctrl+Shift+M: toggle mode picker (claude-chat only)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'm' || e.key === 'M')) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (!isClaude()) return;
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('toggle-mode-picker'));
        return;
      }
      // Ctrl+R: restart session (claude-chat only)
      if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (!isClaude()) return;
        e.preventDefault();
        onRestart();
        return;
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [enabled, onClearSession, onToggleCommandPalette, onToggleLeftSidebar, onRestart]);
}
