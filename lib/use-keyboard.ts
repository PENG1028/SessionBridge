// ─── useKeyboard — detect virtual keyboard on mobile ──────────────
//
// Strategy:
//   1. Capacitor native (window.Capacitor.plugins.Keyboard)
//   2. Web: track max window.innerHeight vs visualViewport.height
//      with BOTH event listeners AND polling fallback (Android Edge
//      doesn't reliably fire visualViewport.resize).
//
// Cross-platform logic:
//   Track the largest window.innerHeight ever seen (full-screen when
//   no keyboard is open). keyboardHeight = maxInnerHeight - vp.height.
//   Works on both iOS (innerHeight fixed) and Android (both shrink).

'use client';

import { useState, useEffect, useRef } from 'react';

export interface KeyboardState {
  keyboardHeight: number;
  isVisible: boolean;
  isSupported: boolean;
}

const KEYBOARD_THRESHOLD = 30;
const POLL_INTERVAL = 300;

export function useKeyboard(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({
    keyboardHeight: 0,
    isVisible: false,
    isSupported: false,
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  // Track the minimum (screen.height - visualViewport.height) as the
  // "browser chrome only" baseline. Keyboard causes a large spike above
  // this baseline. Works on both iOS and Android regardless of whether
  // the layout viewport resizes.
  const baselineKbHRef = useRef<number>(9999);

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
          try {
            capKeyboard.removeListener('keyboardWillShow', showHandler);
            capKeyboard.removeListener('keyboardWillHide', hideHandler);
          } catch { /* cleanup best-effort */ }
        };
      } catch {
        // Fall through to web fallback
      }
    }

    // ── 2. Web fallback: max innerHeight vs visualViewport ────
    if (!('visualViewport' in window) || !window.visualViewport) {
      setState(prev => ({ ...prev, isSupported: true }));
      return;
    }

    const vp = window.visualViewport!;
    // Use screen.height (physical, constant) minus visualViewport.height.
    // This is the total space taken by browser chrome + keyboard.
    // Track the minimum as "browser chrome only" baseline.
    baselineKbHRef.current = window.screen.height - vp.height;

    const getKeyboardHeight = (): number => {
      const raw = window.screen.height - vp.height;
      // Update baseline with smaller values (browser chrome, no keyboard)
      if (raw < baselineKbHRef.current) {
        baselineKbHRef.current = raw;
      }
      return Math.max(0, raw - baselineKbHRef.current);
    };

    const sync = () => {
      const h = getKeyboardHeight();
      const visible = h > KEYBOARD_THRESHOLD;
      const prev = stateRef.current;
      if (prev.keyboardHeight === h && prev.isVisible === visible) return;
      setState({ keyboardHeight: h, isVisible: visible, isSupported: true });
    };

    // Initial check
    sync();

    // Event-driven updates
    vp.addEventListener('resize', sync, { passive: true });
    window.addEventListener('resize', sync, { passive: true });

    // Polling fallback — some Android browsers (Edge) don't reliably
    // fire visualViewport.resize when the keyboard opens/closes.
    const pollId = setInterval(sync, POLL_INTERVAL);

    return () => {
      clearInterval(pollId);
      vp.removeEventListener('resize', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return state;
}
