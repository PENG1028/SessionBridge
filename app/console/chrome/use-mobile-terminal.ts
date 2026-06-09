// ─── useMobileTerminal — mobile touch/scroll for xterm.js v6 ──
//
// Handles touch-to-scroll via `scrollLines()` (relative, frame-delta
// tracked). Uses `scrollLines` instead of `scrollToLine` because the
// latter triggers xterm's internal "ensure cursor visible" logic
// which silently resets the viewport to the bottom.
//
// Scroll gesture flow:
//   touchstart  → record startY, reset lastAppliedDelta
//   touchmove   → after 5px deadzone: scrollLines(frameDelta),
//                 preventDefault + stopPropagation
//   touchend    → if moved: blur textarea (prevent keyboard popup)
//                 if tap:   focus textarea (show keyboard)
//
// Also: keyboard-aware bottom padding, scrollbar passthrough.

'use client';

import { useEffect, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { useKeyboard } from '../../../lib/use-keyboard';

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

export function useMobileTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  termRef: React.RefObject<Terminal | null>,
  fitRef: React.RefObject<FitAddon | null>,
) {
  const touchScrollingRef = useRef(false);
  const { keyboardHeight } = useKeyboard();

  // ── Touch-to-scroll ────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isTouchDevice()) return;

    // Prevent browser from consuming touch events natively
    container.style.touchAction = 'none';

    // ── Touch scroll state ──
    let startY = 0;
    let scrolling = false;
    let startedOnScrollbar = false;
    let anyTouchMove = false;
    let lastAppliedDelta = 0;

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

    const isScrollbarTouch = (touch: Touch): boolean => {
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      // xterm v6 scrollbar: .xterm-scrollable-element > .scrollbar > .scra
      return !!(target && (target as HTMLElement).closest('.scrollbar'));
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        startedOnScrollbar = isScrollbarTouch(e.touches[0]);
        if (startedOnScrollbar) {
          scrolling = false;
          return;
        }
        startY = e.touches[0].clientY;
        lastAppliedDelta = 0;
        scrolling = false;
        anyTouchMove = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (startedOnScrollbar) return;
      anyTouchMove = true;
      if (e.touches.length !== 1) {
        scrolling = false;
        return;
      }
      const currentY = e.touches[0].clientY;
      const totalPxDelta = startY - currentY;

      if (!scrolling && Math.abs(totalPxDelta) > 5) {
        scrolling = true;
      }

      if (scrolling) {
        touchScrollingRef.current = true;
        const lineH = getLineHeight();
        const totalDelta = Math.round(totalPxDelta / lineH);
        const frameDelta = totalDelta - lastAppliedDelta;
        if (frameDelta !== 0) {
          termRef.current?.scrollLines(frameDelta);
          lastAppliedDelta = totalDelta;
        }
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (anyTouchMove) {
        // Finger moved → scroll gesture. Block touchend + blur textarea
        // to prevent keyboard from popping up after scroll.
        e.preventDefault();
        e.stopPropagation();
        const ta = container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
        if (ta) ta.blur();
      } else {
        // Pure tap (no movement). Focus textarea to show keyboard.
        const ta = container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
        if (ta) ta.focus();
      }
      touchScrollingRef.current = false;
      scrolling = false;
      startedOnScrollbar = false;
      anyTouchMove = false;
    };
    container.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    container.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    container.addEventListener('touchend', handleTouchEnd, { capture: true, passive: false });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart, { capture: true });
      container.removeEventListener('touchmove', handleTouchMove, { capture: true });
      container.removeEventListener('touchend', handleTouchEnd, { capture: true });
    };
  }, []);

  // ── Keyboard-aware bottom padding ──────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isTouchDevice()) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (keyboardHeight > 0) {
      const bar = document.querySelector('[data-mobile-keyboard-toolbar]') as HTMLElement | null;
      const barH = bar?.offsetHeight || 90;
      // Only add toolbar height as padding — keyboard is outside
      // visualViewport so the viewport already shrunk to accommodate it
      container.style.paddingBottom = `${barH}px`;
      timer = setTimeout(() => {
        termRef.current?.scrollToBottom();
      }, 350);
    } else {
      container.style.paddingBottom = '';
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [keyboardHeight]);

  return { touchScrollingRef };
}
