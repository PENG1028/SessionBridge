// ─── useTouchGesture — explicit state machine for touch handling ───
//
// Four states, five transitions. No scattered booleans.
//
//   IDLE ──touchstart(scrollbar)→ SCROLLBAR_DRAG
//   IDLE ──touchstart(content)──→ PENDING
//   PENDING ──move ≤5px─────────→ PENDING (dead zone)
//   PENDING ──move >5px─────────→ SCROLLING
//   PENDING ──touchend──────────→ IDLE   (+ onTap)
//   SCROLLING ──touchmove───────→ SCROLLING (apply delta)
//   SCROLLING ──touchend────────→ IDLE
//   SCROLLBAR_DRAG ──touchend───→ IDLE
//   any ──touchcancel───────────→ IDLE
//
// Pointer events from touch are blocked at document capture level,
// preventing xterm from auto-focusing the textarea. Focus is
// managed exclusively by the onTap callback.

'use client';

import { useEffect, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

// ── State machine types ────────────────────────────────────────────
type GestureState = 'idle' | 'pending' | 'scrolling' | 'scrollbar-drag';

interface GestureFrame {
  state: GestureState;
  startY: number;
  lastAppliedDelta: number;
}

// ── Helpers ────────────────────────────────────────────────────────
function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

// ── Hook ───────────────────────────────────────────────────────────
interface UseTouchGestureOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  termRef: React.RefObject<Terminal | null>;
  fitRef: React.RefObject<FitAddon | null>;
  /** Called on pure tap (touch without movement). Manages keyboard focus. */
  onTap: () => void;
}

export function useTouchGesture({
  containerRef,
  termRef,
  fitRef,
  onTap,
}: UseTouchGestureOptions) {
  const gestureRef = useRef<GestureFrame>({
    state: 'idle',
    startY: 0,
    lastAppliedDelta: 0,
  });
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isTouchDevice()) return;

    container.style.touchAction = 'none';
    const g = gestureRef;

    // ── Line height (cached per gesture via fit dimensions) ────
    const getLineHeight = (): number => {
      try {
        const dims = (termRef.current as any)?._core?._renderService?.dimensions;
        if (dims?.css?.cell?.height) return dims.css.cell.height;
      } catch { /* best-effort */ }
      try {
        const dims = fitRef.current?.proposeDimensions();
        if (dims && dims.rows > 0) {
          const vp = container.querySelector('.xterm-viewport') as HTMLElement | null;
          if (vp) return vp.clientHeight / dims.rows;
        }
      } catch { /* fall through */ }
      return 14;
    };

    const isScrollbarTarget = (x: number, y: number): boolean => {
      const el = document.elementFromPoint(x, y);
      return !!(el && (el as HTMLElement).closest('.scrollbar'));
    };

    // ── pointerdown: block all touch pointer events ───────────
    // Fires BEFORE touchstart. Check scrollbar directly — the
    // gesture state isn't set yet.
    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      if (isScrollbarTarget(e.clientX, e.clientY)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    // ── touchstart: enter pending or scrollbar-drag ───────────
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      if (isScrollbarTarget(t.clientX, t.clientY)) {
        g.current = { state: 'scrollbar-drag', startY: 0, lastAppliedDelta: 0 };
      } else {
        g.current = { state: 'pending', startY: t.clientY, lastAppliedDelta: 0 };
        // Stop xterm from receiving this touch + suppress click.
        // Without stopPropagation, xterm's own touchstart handler
        // focuses the textarea → keyboard reopens on any touch.
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // ── touchmove: dead-zone → scrolling → apply delta ────────
    const handleTouchMove = (e: TouchEvent) => {
      const cur = g.current;
      if (cur.state === 'idle' || cur.state === 'scrollbar-drag') return;
      // Don't let xterm see touchmove — it may focus textarea
      e.preventDefault();
      e.stopPropagation();
      if (e.touches.length !== 1) {
        g.current = { state: 'idle', startY: 0, lastAppliedDelta: 0 };
        return;
      }
      const py = e.touches[0].clientY;
      const totalPxDelta = cur.startY - py;

      if (cur.state === 'pending') {
        if (Math.abs(totalPxDelta) <= 5) return;
        g.current = { state: 'scrolling', startY: cur.startY, lastAppliedDelta: 0 };
      }

      const lineH = getLineHeight();
      const totalDelta = Math.round(totalPxDelta / lineH);
      const frameDelta = totalDelta - g.current.lastAppliedDelta;
      if (frameDelta !== 0) {
        termRef.current?.scrollLines(frameDelta);
        g.current = { ...g.current, lastAppliedDelta: totalDelta };
      }
    };

    // ── touchend: tap → onTap(), else block click → reset ─────
    const handleTouchEnd = (e: TouchEvent) => {
      if (g.current.state === 'pending') {
        onTapRef.current();
      } else {
        e.preventDefault();
        e.stopPropagation();
      }
      g.current = { state: 'idle', startY: 0, lastAppliedDelta: 0 };
    };

    const handleTouchCancel = () => {
      g.current = { state: 'idle', startY: 0, lastAppliedDelta: 0 };
    };

    // ── Sync xterm internal state on textarea blur ────────────
    // When system dismisses keyboard (iOS swipe-down), textarea
    // loses focus but xterm doesn't know. Tell it so it won't
    // auto-refocus on the next touch.
    const ta = container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
    const onTextareaBlur = () => { termRef.current?.blur(); };
    ta?.addEventListener('blur', onTextareaBlur);

    // ── Register listeners ────────────────────────────────────
    document.addEventListener('pointerdown', handlePointerDown, { capture: true });
    container.addEventListener('touchstart', handleTouchStart, { capture: true, passive: false });
    container.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    container.addEventListener('touchend', handleTouchEnd, { capture: true, passive: false });
    container.addEventListener('touchcancel', handleTouchCancel, { capture: true });

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      ta?.removeEventListener('blur', onTextareaBlur);
      container.removeEventListener('touchstart', handleTouchStart, { capture: true });
      container.removeEventListener('touchmove', handleTouchMove, { capture: true });
      container.removeEventListener('touchend', handleTouchEnd, { capture: true });
      container.removeEventListener('touchcancel', handleTouchCancel, { capture: true });
    };
  }, []);
}
