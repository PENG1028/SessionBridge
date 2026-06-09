// ─── useMobileTerminal — mobile touch/scroll for xterm.js ──────
//
// Self-contained hook. Handles ALL mobile-specific terminal behavior.
// Exposes touchScrollingRef for ResizeObserver coordination.
//
// Key design decision: intercept pointerdown via JS (capture phase)
// instead of CSS pointer-events:none. JS interception is more targeted
// — it blocks exactly one event type on one element, without the
// broad side effects of CSS (textarea blur, delayed pointer events
// firing after restore, etc.).

'use client';

import { useEffect, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { useKeyboard } from '../../../lib/use-keyboard';

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

function isScrollbarTarget(
  clientX: number,
  clientY: number,
  vp: HTMLElement | null,
  container: HTMLElement,
): boolean {
  if (!vp) return false;
  const target = document.elementFromPoint(clientX, clientY);
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
  return clientX > vpRect.right - 24;
}

export function useMobileTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  termRef: React.RefObject<Terminal | null>,
  fitRef: React.RefObject<FitAddon | null>,
) {
  const touchScrollingRef = useRef(false);
  const { keyboardHeight } = useKeyboard();

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isTouchDevice()) return;

    // Prevent browser from consuming touch events for native scroll
    container.style.touchAction = 'none';

    // Deferred: xterm element isn't created until the sibling xterm-init
    // useEffect runs (same tick, but after this callback).
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

    // ── State ────────────────────────────────────────────────
    let startY = 0;
    let startBaseY = 0;
    let scrolling = false;
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

    // ── pointerdown interception ─────────────────────────────
    // This is THE key fix. Browser fires pointerdown on first touch
    // contact. Xterm's handler focuses the textarea → scrollToBottom.
    // By blocking pointerdown in capture phase, xterm never sees it.
    // No CSS pointer-events manipulation needed → no side effects.
    const handlePointerDown = (e: PointerEvent) => {
      const vp = getViewport();
      if (isScrollbarTarget(e.clientX, e.clientY, vp, container)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    container.addEventListener('pointerdown', handlePointerDown, { capture: true });

    // ── touch handlers ───────────────────────────────────────
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;

      const vp = getViewport();
      if (isScrollbarTarget(e.touches[0].clientX, e.touches[0].clientY, vp, container)) {
        scrolling = false;
        return;
      }

      startY = e.touches[0].clientY;
      startBaseY = termRef.current?.buffer?.active?.baseY ?? 0;
      scrolling = false;
      anyTouchMove = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      // Block ALL touchmove from reaching xterm
      e.preventDefault();
      e.stopPropagation();

      if (e.touches.length === 0) return;  // Android ghost event
      if (e.touches.length > 1) {           // multi-touch → release scrolling
        scrolling = false;
        return;
      }

      anyTouchMove = true;
      const currentY = e.touches[0].clientY;
      const totalPxDelta = startY - currentY; // + = finger up → scroll down

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
        // Scroll gesture: block xterm from seeing touchend.
        // Xterm only saw touchstart (no touchmove, no touchend).
        // With no touchend, xterm can't classify it as a tap.
        e.preventDefault();
        e.stopPropagation();
      } else {
        // Pure tap: xterm saw touchstart but not pointerdown.
        // Manually focus the textarea so the keyboard appears,
        // then let touchend through so xterm scrolls to cursor.
        const ta = container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
        if (ta) ta.focus();
      }
      touchScrollingRef.current = false;
      scrolling = false;
      anyTouchMove = false;
      setTimeout(() => { justScrolled.value = false; }, 150);
    };

    // Suppress click→focus after scroll gesture
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
