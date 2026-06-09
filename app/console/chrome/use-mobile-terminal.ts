// ─── useMobileTerminal — mobile touch/scroll for xterm.js ──────
//
// Self-contained hook. Handles ALL mobile-specific terminal behavior:
//   - textarea repositioning (Android keyboard focus)
//   - touch-action: none on container (prevents browser preemption)
//   - touch-to-scroll via scrollToLine (position-based, no accumulation)
//   - exclusive gesture capture (content vs scrollbar)
//   - keyboard-aware bottom padding (avoids toolbar overlap)
//
// Exposes touchScrollingRef so the ResizeObserver in shell-terminal
// can suppress scrollToBottom during active touch gestures.

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

  // ── Initial mobile setup (runs once after xterm.open) ──────
  useEffect(() => {
    const container = containerRef.current;
    const term = termRef.current;
    if (!container || !term || !isTouchDevice()) return;

    // Reposition hidden textarea so Android doesn't scroll to
    // x=-9999em when focusing for keyboard input.
    const ta = term.element?.querySelector('.xterm-helper-textarea') as HTMLElement;
    if (ta) {
      ta.style.left = '0';
      ta.style.top = 'auto';
      ta.style.bottom = '0';
      ta.style.width = '1px';
      ta.style.height = '1px';
      ta.style.pointerEvents = 'none';
    }

    // Prevent browser from consuming touch events for native scroll.
    // Set on the container so edge zones are also covered.
    container.style.touchAction = 'none';
  }, []); // one-shot: fires after xterm.open() sets termRef

  // ── Keyboard-aware bottom padding ──────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isTouchDevice()) return;
    container.style.paddingBottom = keyboardHeight > 0 ? '100px' : '';
  }, [keyboardHeight]);

  // ── Touch-to-scroll ────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isTouchDevice()) return;

    let startY = 0;
    let startBaseY = 0;
    let scrolling = false;
    let startedOnScrollbar = false;
    const justScrolled = { value: false };

    const getViewport = (): HTMLElement | null =>
      container.querySelector('.xterm-viewport') as HTMLElement | null;

    const getLineHeight = (): number => {
      try {
        const dims = (termRef.current as any)?._core?._renderService?.dimensions;
        if (dims?.css?.cell?.height) return dims.css.cell.height;
      } catch { /* best-effort */ }
      try {
        const dims = fitRef.current?.proposeDimensions();
        if (dims) {
          const vpEl = getViewport();
          if (vpEl && dims.rows > 0) return vpEl.clientHeight / dims.rows;
        }
      } catch { /* fall through */ }
      return 14;
    };

    const isScrollbarTouch = (touch: Touch, vp: HTMLElement | null): boolean => {
      if (!vp) return false;
      const target = document.elementFromPoint(touch.clientX, touch.clientY);
      if (target) {
        let el: Element | null = target;
        while (el && el !== vp && el !== container) {
          if (el.getAttribute('role') === 'presentation' &&
              (el.parentElement as HTMLElement)?.classList?.contains('xterm-viewport')) {
            return true;
          }
          el = el.parentElement;
        }
      }
      const vpRect = vp.getBoundingClientRect();
      return touch.clientX > vpRect.right - 24;
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        const vp = getViewport();
        startedOnScrollbar = isScrollbarTouch(e.touches[0], vp);
        if (startedOnScrollbar) {
          scrolling = false;
          return;
        }
        startY = e.touches[0].clientY;
        startBaseY = termRef.current?.buffer?.active?.baseY ?? 0;
        scrolling = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (startedOnScrollbar) return;
      if (e.touches.length !== 1) {
        if (scrolling) {
          const vp = getViewport();
          if (vp) vp.style.pointerEvents = '';
          scrolling = false;
        }
        return;
      }
      const currentY = e.touches[0].clientY;
      const totalPxDelta = startY - currentY;

      if (!scrolling && Math.abs(totalPxDelta) > 5) {
        scrolling = true;
        const vp = getViewport();
        if (vp) vp.style.pointerEvents = 'none';
      }

      if (scrolling) {
        justScrolled.value = true;
        touchScrollingRef.current = true;
        const lineH = getLineHeight();
        const lineDelta = Math.round(totalPxDelta / lineH);
        const targetLine = Math.max(0, startBaseY + lineDelta);
        termRef.current?.scrollToLine(targetLine);
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleTouchEnd = () => {
      if (scrolling) {
        const vp = getViewport();
        if (vp) vp.style.pointerEvents = '';
      }
      touchScrollingRef.current = false;
      scrolling = false;
      startedOnScrollbar = false;
      setTimeout(() => { justScrolled.value = false; }, 150);
    };

    const guardClick = (e: Event) => {
      if (justScrolled.value) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    };

    container.addEventListener('click', guardClick, { capture: true });
    container.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    container.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    container.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true });

    return () => {
      const vp = getViewport();
      if (vp) vp.style.pointerEvents = '';
      container.removeEventListener('click', guardClick, { capture: true });
      container.removeEventListener('touchstart', handleTouchStart, { capture: true });
      container.removeEventListener('touchmove', handleTouchMove, { capture: true });
      container.removeEventListener('touchend', handleTouchEnd, { capture: true });
    };
  }, []);

  return { touchScrollingRef };
}
