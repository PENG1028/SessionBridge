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
let _wasPushedUp = false;         // true once offsetTop > 0 while keyboard detected → push mode

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
  //
  // Two keyboard modes on Android:
  //   Push:   keyboard pushes viewport up   → offsetTop > 0 when open
  //   Overlay: keyboard overlays viewport   → offsetTop = 0 always
  //
  // Open:  push mode: h > 100 AND offsetTop > 25
  //        overlay mode (first time): h > 100 (offsetTop may be 0)
  // Close: both modes: h < 40 (keyboard height dropped)
  //        push mode only: offsetTop < 5 (fast close signal — viewport
  //        returned to top before h recovers; system back-button dismiss)

  let visible: boolean;
  if (prevVisible) {
    // Primary close: keyboard height is negligible
    if (h < KEYBOARD_CLOSE_THRESHOLD) {
      visible = false;
    } else if (_wasPushedUp && offsetTop < 5) {
      // Push mode only: viewport returned to top before h recovered.
      // Do NOT use for overlay mode — offsetTop is always 0 there.
      visible = false;
    } else {
      visible = true;
    }
  } else {
    if (h > KEYBOARD_OPEN_THRESHOLD && offsetTop > OFFSET_TOP_OPEN_MIN) {
      // Push mode open
      visible = true;
      _wasPushedUp = true;
      _keyboardHasOpened = true;
    } else if (h > KEYBOARD_OPEN_THRESHOLD && !_keyboardHasOpened) {
      // First-ever open: accept h alone (overlay mode offsetTop=0).
      // _wasPushedUp stays false → close won't use offsetTop signal.
      visible = true;
      _keyboardHasOpened = true;
    } else {
      visible = false;
    }
  }

  // Track push mode: once offsetTop rises, we're in push mode
  // and can use offsetTop < 5 as a fast-close signal.
  if (offsetTop > OFFSET_TOP_OPEN_MIN) {
    _wasPushedUp = true;
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
