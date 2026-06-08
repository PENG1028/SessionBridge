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
const DEBOUNCE_MS = 16; // ~1 frame at 60fps — instant enough for toolbar follow

export function useKeyboard(): KeyboardState {
  const [state, setState] = useState<KeyboardState>({
    keyboardHeight: 0,
    isVisible: false,
    isSupported: false,
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // ── 1. Capacitor native ──────────────────────────────────
    // window.Capacitor is injected by the Capacitor runtime in
    // native WebViews. No build-time dependency needed.
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

    // ── 2. Web fallback: visualViewport ──────────────────────
    if (!('visualViewport' in window) || !window.visualViewport) {
      return; // no detection possible
    }

    const vp = window.visualViewport!;
    setState(prev => ({ ...prev, isSupported: true }));

    const getOverlap = (): number =>
      Math.max(0, window.innerHeight - (vp.offsetTop + vp.height));

    const sync = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const h = getOverlap();
        const visible = h > KEYBOARD_THRESHOLD;

        // Avoid noise: skip update if height within threshold
        // of the last reported value and visibility unchanged.
        const prev = stateRef.current;
        if (
          Math.abs(prev.keyboardHeight - h) <= KEYBOARD_THRESHOLD &&
          prev.isVisible === visible
        ) {
          // Still update keyboardHeight if it's the same ballpark.
          // This keeps the toolbar smooth for small adjustments
          // without treating every 5px change as a new event.
          if (prev.keyboardHeight === h) return;
        }

        setState({ keyboardHeight: h, isVisible: visible, isSupported: true });
      }, DEBOUNCE_MS);
    };

    // Sync immediately
    sync();

    vp.addEventListener('resize', sync);
    vp.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);

    return () => {
      vp.removeEventListener('resize', sync);
      vp.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return state;
}
