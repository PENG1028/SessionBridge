// ─── useKeyboard — detect virtual keyboard on mobile ──────────────
//
// Singleton: only one baseline, one sync(), one poll timer. All callers
// share the same module-level KeyboardState — no independent baselines,
// no conflicting layout changes from different isVisible values.

'use client';

import { useState, useEffect, useRef } from 'react';

export interface KeyboardState {
  keyboardHeight: number;
  isVisible: boolean;
  isSupported: boolean;
}

const KEYBOARD_OPEN_THRESHOLD = 100;
const KEYBOARD_CLOSE_THRESHOLD = 40;
const OFFSET_TOP_OPEN_MIN = 25;    // offsetTop must be > this to open (keyboard pushes viewport 200+px; scroll < 20px)
const POLL_INTERVAL = 300;

// ── Module-level singleton: never reset once initialized ────────
let _baseline = 0;
let _initialized = false;
let _listenerCount = 0;
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _state: KeyboardState = {
  keyboardHeight: 0,
  isVisible: false,
  isSupported: false,
};
let _keyboardHasOpened = false;

const _subs = new Set<() => void>();

function notify() {
  for (const cb of _subs) cb();
}

function sync() {
  if (typeof window === 'undefined') return;

  const vp = window.visualViewport;
  if (!vp) return;

  const raw = window.screen.height - vp.height;
  const offsetTop = vp.offsetTop;

  // Baseline: captured ONCE on first sync(), never reset.
  // Even if all subscribers briefly hit 0 during React batch
  // re-renders, _initialized persists → baseline is stable.
  if (!_initialized) {
    _baseline = raw;
    _initialized = true;
  }

  const h = Math.max(0, raw - _baseline);
  const prevVisible = _state.isVisible;

  // ── Hysteresis ──────────────────────────────────────────────
  // Open:  requires BOTH height > 100 AND offsetTop > 25 (keyboard
  //        pushes viewport up 200+px; scroll stays < 20px).
  //        Exception: first-time detection with h > 180.
  // Close: h < 40, OR viewport not pushed up (offsetTop < 5).
  //        offsetTop is the definitive signal — if the viewport
  //        isn't pushed up, the keyboard cannot be open. This
  //        handles system keyboard dismiss where vp.height doesn't
  //        immediately recover.
  let visible: boolean;
  if (prevVisible) {
    if (offsetTop < 5) {
      visible = false;
    } else {
      visible = h > KEYBOARD_CLOSE_THRESHOLD;
    }
  } else {
    if (h > KEYBOARD_OPEN_THRESHOLD && offsetTop > OFFSET_TOP_OPEN_MIN) {
      visible = true;
      _keyboardHasOpened = true;
    } else if (h > KEYBOARD_OPEN_THRESHOLD + 80 && !_keyboardHasOpened) {
      visible = true;
      _keyboardHasOpened = true;
    } else {
      visible = false;
    }
  }

  const next: KeyboardState = {
    keyboardHeight: h,
    isVisible: visible,
    isSupported: true,
  };

  if (
    next.keyboardHeight !== _state.keyboardHeight ||
    next.isVisible !== _state.isVisible
  ) {
    _state = next;
    notify();
  }
}

function ensureListeners() {
  if (typeof window === 'undefined') return;
  const vp = window.visualViewport;
  if (!vp) return;

  vp.addEventListener('resize', sync, { passive: true });
  window.addEventListener('resize', sync, { passive: true });
  _pollTimer = setInterval(sync, POLL_INTERVAL);
  // Run sync so subscribers see current state, but baseline is
  // already captured (if _initialized) — won't be recaptured.
  sync();
}

function teardownListeners() {
  if (typeof window === 'undefined') return;
  const vp = window.visualViewport;
  if (vp) {
    vp.removeEventListener('resize', sync);
  }
  window.removeEventListener('resize', sync);
  if (_pollTimer !== null) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

export function useKeyboard(): KeyboardState {
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    _listenerCount++;

    if (_listenerCount === 1) {
      ensureListeners();
    }

    const cb = () => {
      if (mountedRef.current) {
        setSnapshot(_state);
      }
    };
    _subs.add(cb);

    return () => {
      mountedRef.current = false;
      _subs.delete(cb);
      _listenerCount = Math.max(0, _listenerCount - 1);
      if (_listenerCount === 0) {
        teardownListeners();
        // _initialized and _keyboardHasOpened persist across
        // subscriber count fluctuations — baseline is forever.
      }
    };
  }, []);

  const [snapshot, setSnapshot] = useState<KeyboardState>(_state);
  return snapshot;
}
