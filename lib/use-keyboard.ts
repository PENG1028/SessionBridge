// ─── useKeyboard — detect virtual keyboard on mobile ──────────────
//
// Compares visualViewport.height against the initial innerHeight
// (recorded on first measurement when no keyboard should be open).
// When visual viewport is significantly shorter, the keyboard is open.
//
// Previous approach used screen.height - visualViewport.height minus
// a moving baseline. That failed because browser chrome (address bar)
// show/hide changes the baseline, causing false keyboard detections.

'use client';

import { useState, useEffect, useRef } from 'react';

export interface KeyboardState {
  keyboardHeight: number;
  isVisible: boolean;
  isSupported: boolean;
}

const KEYBOARD_THRESHOLD = 60;
const POLL_INTERVAL = 300;

export function useKeyboard(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({
    keyboardHeight: 0,
    isVisible: false,
    isSupported: false,
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  // Reference layout viewport height (when no keyboard is open).
  // Set once on first measurement and never updated.
  const refHeightRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // ── 1. Capacitor native ──────────────────────────────────
    const cap = (window as any).Capacitor;
    const capKeyboard = cap?.plugins?.Keyboard;
    if (capKeyboard) {
      setState({ keyboardHeight: 0, isVisible: false, isSupported: true });
      const showHandler = (info: { keyboardHeight?: number }) => {
        const h = info?.keyboardHeight ?? 0;
        setState({ keyboardHeight: h, isVisible: h > KEYBOARD_THRESHOLD, isSupported: true });
      };
      const hideHandler = () => {
        setState({ keyboardHeight: 0, isVisible: false, isSupported: true });
      };
      try {
        capKeyboard.addListener('keyboardWillShow', showHandler);
        capKeyboard.addListener('keyboardWillHide', hideHandler);
        return () => {
          try { capKeyboard.removeListener('keyboardWillShow', showHandler); } catch {}
          try { capKeyboard.removeListener('keyboardWillHide', hideHandler); } catch {}
        };
      } catch { /* fall through */ }
    }

    // ── 2. Web fallback ─────────────────────────────────────
    if (!('visualViewport' in window) || !window.visualViewport) {
      setState(prev => ({ ...prev, isSupported: true }));
      return;
    }

    const vp = window.visualViewport!;

    const sync = () => {
      // Record the full viewport height on first call (no keyboard should be open).
      // innerHeight stays stable on iOS and most Android browsers when keyboard opens;
      // visualViewport.height shrinks.
      if (refHeightRef.current === 0) {
        refHeightRef.current = window.innerHeight;
      }
      const refH = refHeightRef.current || window.innerHeight;
      const h = Math.max(0, refH - vp.height);
      const visible = h > KEYBOARD_THRESHOLD;
      const prev = stateRef.current;
      if (prev.keyboardHeight === h && prev.isVisible === visible) return;
      setState({ keyboardHeight: h, isVisible: visible, isSupported: true });
    };

    sync();

    // Event-driven
    vp.addEventListener('resize', sync, { passive: true });
    window.addEventListener('resize', sync, { passive: true });

    // Polling fallback (Android Edge doesn't reliably fire visualViewport.resize)
    const pollId = setInterval(sync, POLL_INTERVAL);

    return () => {
      clearInterval(pollId);
      vp.removeEventListener('resize', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return state;
}
