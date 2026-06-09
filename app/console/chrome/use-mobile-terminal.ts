// ─── useMobileTerminal — mobile touch/scroll for xterm.js ──────
//
// Self-contained hook. Handles ALL mobile-specific terminal behavior:
//   - textarea repositioning (Android keyboard focus)
//   - touch-action: none on container (prevents browser preemption)
//   - touch-to-scroll via scrollToLine (position-based, no accumulation)
//   - exclusive gesture capture (content vs scrollbar)
//   - keyboard-aware bottom padding (avoids toolbar overlap)
//
// Exposes touchScrollingRef so the ResizeObserver can suppress
// scrollToBottom during active touch gestures.
//
// NOTE: the touch-to-scroll effect uses [] deps and must run AFTER
// xterm.open() creates the .xterm element. React runs sibling effects
// in declaration order (top-down), and this hook is called BEFORE the
// xterm init useEffect in ShellTerminal. Term-dependent setup (textarea
// reposition) is deferred via requestAnimationFrame to wait for the
// xterm init effect to complete.

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

  // ── Touch-to-scroll + initial setup (single effect, [] deps) ──
  // Term-dependent setup (textarea reposition) is deferred via rAF
  // because the xterm init useEffect (which creates the .xterm element)
  // runs AFTER this hook's effects (React declaration order).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isTouchDevice()) return;

    // Immediate: prevent browser from consuming touch events
    container.style.touchAction = 'none';

    // Deferred: xterm element isn't created until sibling useEffect runs,
    // which is after this callback but before the next paint.
    const raf = requestAnimationFrame(() => {
      const ta = container.querySelector('.xterm-helper-textarea') as HTMLElement;
      if (ta) {
        ta.style.left = '0';
        ta.style.top = 'auto';
        ta.style.bottom = '0';
        ta.style.width = '1px';
        ta.style.height = '1px';
        ta.style.pointerEvents = 'none';
      }
    });

    // ── Touch scroll state ──
    let startY = 0;
    let startBaseY = 0;
    let scrolling = false;
    let startedOnScrollbar = false;
    let anyTouchMove = false;
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

    // ── pointerdown interception ───────────────────────────────
    // Xterm's pointerdown handler focuses the textarea → scrollToBottom.
    // Block pointerdown on content area. Rightmost 30px of viewport
    // passes through so xterm's custom scrollbar works.
    const isScrollbarZone = (clientX: number): boolean => {
      const vp = getViewport();
      if (!vp) return false;
      return clientX > vp.getBoundingClientRect().right - 30;
    };
    const handlePointerDown = (e: PointerEvent) => {
      if (isScrollbarZone(e.clientX)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    container.addEventListener('pointerdown', handlePointerDown, { capture: true });

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
        anyTouchMove = false;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (startedOnScrollbar) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.touches.length === 0) return;   // Android ghost event
      if (e.touches.length > 1) { scrolling = false; return; }

      anyTouchMove = true;
      const currentY = e.touches[0].clientY;
      const totalPxDelta = startY - currentY;

      if (!scrolling && Math.abs(totalPxDelta) > 5) {
        scrolling = true;
      }

      if (scrolling) {
        justScrolled.value = true;
        touchScrollingRef.current = true;
        const lineH = getLineHeight();
        const lineDelta = Math.round(totalPxDelta / lineH);
        const targetLine = Math.max(0, startBaseY + lineDelta);
        termRef.current?.scrollToLine(targetLine);
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (anyTouchMove) {
        // Finger moved → not a tap. Block touchend from xterm so
        // it can't interpret touchstart+touchend as a tap → focus
        // textarea → scrollToBottom.
        e.preventDefault();
        e.stopPropagation();
      }
      touchScrollingRef.current = false;
      scrolling = false;
      startedOnScrollbar = false;
      anyTouchMove = false;
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
    container.addEventListener('touchend', handleTouchEnd, { capture: true, passive: false });

    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      container.removeEventListener('click', guardClick, { capture: true });
      container.removeEventListener('touchstart', handleTouchStart, { capture: true });
      container.removeEventListener('touchmove', handleTouchMove, { capture: true });
      container.removeEventListener('touchend', handleTouchEnd, { capture: true });
    };
  }, []);

  // ── Keyboard-aware bottom padding ──────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isTouchDevice()) return;
    container.style.paddingBottom = keyboardHeight > 0 ? '100px' : '';
  }, [keyboardHeight]);

  return { touchScrollingRef };
}
