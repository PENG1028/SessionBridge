// ─── useMobileTerminal — mobile touch/scroll for xterm.js ──────
//
// Self-contained hook. ONE principle:
//   Xterm receives ZERO touch/pointer events. We handle everything.
//
// No monkey-patches. No __touchActive. No delayed timeouts.
// No fighting between two systems — only one system runs.

'use client';

import { useEffect, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { useKeyboard } from '../../../lib/use-keyboard';

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

function isScrollbarZone(
  clientX: number,
  vp: HTMLElement | null,
): boolean {
  if (!vp) return false;
  return clientX > vp.getBoundingClientRect().right - 30;
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

    container.style.touchAction = 'none';

    const raf = requestAnimationFrame(() => {
      const ta = container.querySelector('.xterm-helper-textarea') as HTMLElement;
      if (ta) {
        ta.style.left = '0';
        ta.style.top = 'auto';
        ta.style.bottom = '0';
        ta.style.width = '1px';
        ta.style.height = '1px';
      }
    });

    // ── State ────────────────────────────────────────────────
    let startY = 0;
    let startBaseY = 0;
    let moved = false;
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
          const vp = getViewport();
          if (vp && dims.rows > 0) return vp.clientHeight / dims.rows;
        }
      } catch { /* fall through */ }
      return 14;
    };

    // ── Block ALL pointer events ──────────────────────────────
    const block = (e: Event) => {
      const vp = getViewport();
      if (e instanceof PointerEvent && isScrollbarZone(e.clientX, vp)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    container.addEventListener('pointerdown', block, { capture: true });
    container.addEventListener('pointerup', block, { capture: true });
    container.addEventListener('pointermove', block, { capture: true });
    container.addEventListener('pointercancel', block, { capture: true });

    // ── Touch handlers ────────────────────────────────────────
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const vp = getViewport();
      if (isScrollbarZone(e.touches[0].clientX, vp)) return; // scrollbar
      e.preventDefault();
      e.stopPropagation();
      startY = e.touches[0].clientY;
      startBaseY = termRef.current?.buffer?.active?.baseY ?? 0;
      moved = false;
    };

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.touches.length !== 1) return;
      moved = true;
      const totalPxDelta = startY - e.touches[0].clientY;
      if (Math.abs(totalPxDelta) < 3) return;
      touchScrollingRef.current = true;
      const lineH = getLineHeight();
      const lineDelta = Math.round(totalPxDelta / lineH);
      termRef.current?.scrollToLine(Math.max(0, startBaseY + lineDelta));
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      touchScrollingRef.current = false;

      if (!moved) {
        // Pure tap → focus textarea + scroll to cursor
        const ta = container.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
        if (ta) {
          ta.focus();
          termRef.current?.scrollToBottom();
        }
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { capture: true, passive: false });
    container.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    container.addEventListener('touchend', handleTouchEnd, { capture: true, passive: false });

    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener('pointerdown', block, { capture: true });
      container.removeEventListener('pointerup', block, { capture: true });
      container.removeEventListener('pointermove', block, { capture: true });
      container.removeEventListener('pointercancel', block, { capture: true });
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
