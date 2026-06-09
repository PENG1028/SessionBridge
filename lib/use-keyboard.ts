// ─── useKeyboard — detect virtual keyboard on mobile ──────────────
//
// Uses screen.height (constant) minus visualViewport.height minus a
// one-time baseline (browser chrome). Baseline is captured ONCE on
// first measurement and never lowered — this fixes the false positive
// when browser chrome (address bar) hides/shows.
//
// Previous approach kept lowering the baseline (min tracking), causing
// chrome hide→baseline→0 → chrome show→looks like keyboard. Fixed by
// never lowering baseline after initial capture.

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
  // Baseline: screen.height - visualViewport.height when NO keyboard is open.
  // Set once on first measurement, never lowered. This tracks browser chrome
  // height (address bar, navigation) which is the minimum raw value.
  const baselineRef = useRef<number>(0);
  const initializedRef = useRef(false);

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
      // screen.height is physical, never changes. vp.height shrinks when
      // keyboard opens. Their difference minus baseline (browser chrome)
      // gives keyboard height.
      const raw = window.screen.height - vp.height;
      if (!initializedRef.current) {
        // First measurement: assume no keyboard, raw = browser chrome only
        baselineRef.current = raw;
        initializedRef.current = true;
      }
      const h = Math.max(0, raw - baselineRef.current);
      const visible = h > KEYBOARD_THRESHOLD;
      const prev = stateRef.current;
      if (prev.keyboardHeight === h && prev.isVisible === visible) return;
      setState({ keyboardHeight: h, isVisible: visible, isSupported: true });
    };

    sync();

    vp.addEventListener('resize', sync, { passive: true });
    window.addEventListener('resize', sync, { passive: true });

    const pollId = setInterval(sync, POLL_INTERVAL);

    return () => {
      clearInterval(pollId);
      vp.removeEventListener('resize', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return state;
}
