// ─── useKeyboard — detect virtual keyboard on mobile ──────────────
//
// Strategy (auto-detected):
//   1. Capacitor native  → @capacitor/keyboard (window.Capacitor.plugins.Keyboard)
//   2. Web fallback       → window.visualViewport + debounce
//   3. Unsupported        → isSupported: false
//
// The hook only reports the OS-level keyboard state. Consumer
// components decide whether to act on it (e.g. only when terminal is
// focused).
//
// Capacitor detection is zero-dep: it reads the global that the
// Capacitor runtime injects — no import needed.

'use client';

import { useState, useEffect, useRef } from 'react';

export interface KeyboardState {
  /** Height of the keyboard in pixels. 0 when hidden. */
  keyboardHeight: number;
  /** Whether the keyboard is currently visible. Uses a threshold to
   *  ignore sub-30px fluctuations (address bar, toolbar adjustments). */
  isVisible: boolean;
  /** Whether keyboard detection is supported in this environment. */
  isSupported: boolean;
}

const KEYBOARD_THRESHOLD = 30;

export function useKeyboard(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({
    keyboardHeight: 0,
    isVisible: false,
    isSupported: false,
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const rafRef = useRef<number | null>(null);

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
        // Fall through to visualViewport
      }
    }

    // ── 2. Web fallback: visualViewport + rAF ────────────────
    if (!('visualViewport' in window) || !window.visualViewport) {
      return; // no detection possible
    }

    const vp = window.visualViewport!;
    setState(prev => ({ ...prev, isSupported: true }));

    const getOverlap = (): number =>
      Math.max(0, window.innerHeight - (vp.offsetTop + vp.height));

    // Use requestAnimationFrame to sync with the browser's render
    // loop, avoiding both setTimeout drift and redundant React renders.
    // The rAF fires right before the next paint, so the keyboard height
    // update reaches the DOM in the same frame as the viewport change.
    const sync = () => {
      if (rafRef.current !== null) return; // already scheduled
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const h = getOverlap();
        const visible = h > KEYBOARD_THRESHOLD;

        // Only call setState when values actually change — avoids
        // unnecessary React re-renders that cause toolbar jank.
        const prev = stateRef.current;
        if (prev.keyboardHeight === h && prev.isVisible === visible) return;
        setState({ keyboardHeight: h, isVisible: visible, isSupported: true });
      });
    };

    // Sync immediately
    sync();

    vp.addEventListener('resize', sync, { passive: true });
    window.addEventListener('resize', sync, { passive: true });

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      vp.removeEventListener('resize', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return state;
}
