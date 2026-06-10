// ─── useMobileTerminal — keyboard layout for xterm.js v6 on mobile ─
//
// Composes useTouchGesture (touch state machine) + useKeyboard
// (singleton keyboard detection). Only owns keyboard-aware layout
// (marginBottom). Touch handling is delegated to useTouchGesture.

'use client';

import { useEffect, useCallback, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { useKeyboard } from '../../../lib/use-keyboard';
import { useTouchGesture } from './use-touch-gesture';

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

export function useMobileTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  termRef: React.RefObject<Terminal | null>,
  fitRef: React.RefObject<FitAddon | null>,
) {
  const { isVisible: keyboardVisible, keyboardHeight } = useKeyboard();

  // ── Tap → toggle keyboard ──────────────────────────────────
  const handleTap = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const ta = container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
    if (!ta) return;
    if (document.activeElement === ta) {
      ta.blur();
    } else {
      ta.focus();
    }
  }, []);

  useTouchGesture({ containerRef, termRef, fitRef, onTap: handleTap });

  // ── Keyboard-aware bottom margin ────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isTouchDevice()) return;

    if (keyboardVisible) {
      const bar = document.querySelector('[data-mobile-keyboard-toolbar]') as HTMLElement | null;
      container.style.marginBottom = `${bar?.offsetHeight || 90}px`;
    } else {
      container.style.marginBottom = '';
      // iOS system keyboard dismiss does NOT fire 'blur' on the
      // textarea. document.activeElement stays focused, and any
      // subsequent touch causes the browser to re-show the keyboard
      // immediately. Force blur when keyboard is detected as closed.
      const ta = container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
      if (ta && document.activeElement === ta) {
        ta.blur();
      }
    }
  }, [keyboardVisible]);

  // ── Anchor to bottom after keyboard animation settles ─────
  // Mobile keyboard animates in over ~300ms. Each visualViewport
  // change triggers fit() which may shift the viewport. Wait for
  // keyboardHeight to stop changing before anchoring.
  const anchorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!keyboardVisible || keyboardHeight < 30) return;

    // Debounce: restart timer every time height changes
    if (anchorTimerRef.current) clearTimeout(anchorTimerRef.current);
    anchorTimerRef.current = setTimeout(() => {
      try { termRef.current?.scrollToBottom(); } catch {}
    }, 400);

    return () => {
      if (anchorTimerRef.current) clearTimeout(anchorTimerRef.current);
    };
  }, [keyboardVisible, keyboardHeight]);
}
