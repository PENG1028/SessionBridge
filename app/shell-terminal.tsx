'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { IDisposable } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { ContextMenu, type ContextMenuItem } from './console/shell/context-menu';
import { MobileKeyboardSlot } from './console/chrome/mobile-keyboard-slot';
import { useKeyboard } from '../lib/use-keyboard';

// ─── ShellTerminal — pure xterm.js host ────────────────────────────
// Owns: xterm init/theme/fit, keyboard shortcuts, context menu, resize observer.
// Does NOT know about Core, streams, stdin buffering, or OSC protocols.
// All Core integration goes through onTerminalReady / onUserInput / onResize.

export interface ShellTerminalProps {
  onTerminalReady: (term: Terminal, fitAddon: FitAddon) => IDisposable | void;
  onResize?: (cols: number, rows: number) => void;
  onUserInput?: (data: string) => void;
  onOpenDirectoryPicker?: () => void;
}

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

export default function ShellTerminal({ onTerminalReady, onResize, onUserInput, onOpenDirectoryPicker }: ShellTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [terminalFocused, setTerminalFocused] = useState(false);
  const { keyboardHeight } = useKeyboard();

  // Stable refs so callbacks don't cause unnecessary re-registration
  const onTerminalReadyRef = useRef(onTerminalReady);
  onTerminalReadyRef.current = onTerminalReady;
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const onUserInputRef = useRef(onUserInput);
  onUserInputRef.current = onUserInput;

  // ── Local echo + user-input bridge ──────────────────────────
  const handleUserInput = useCallback((data: string) => {
    const term = termRef.current;
    if (term && !data.startsWith('\x1b') && data !== '\t') {
      try {
        let echo = data;
        echo = echo.replace(/\r/g, '\n');
        echo = echo.replace(/\x03/g, '^C\r\n');
        if (echo) term.write(echo);
      } catch (_e) {
        // Local echo is best-effort; shell echo will cover it
      }
    }
    onUserInputRef.current?.(data);
  }, []);

  // ── xterm.js initialization ─────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    (containerRef.current as HTMLElement).innerHTML = '';

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: '"Cascadia Mono", "JetBrains Mono", monospace',
      lineHeight: 1.0,
      letterSpacing: 0,
      allowTransparency: true,
      convertEol: typeof navigator !== 'undefined' && !/Win/i.test(navigator.userAgent),
      scrollback: 5000,
      theme: {
        background: '#0a0a0a',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
        selectionBackground: '#404040',
        black: '#000000',
        red: '#e06c75',
        green: '#98c379',
        yellow: '#d19a66',
        blue: '#61afef',
        magenta: '#c678dd',
        cyan: '#56b6c2',
        white: '#abb2bf',
        brightBlack: '#5c6370',
        brightRed: '#e06c75',
        brightGreen: '#98c379',
        brightYellow: '#d19a66',
        brightBlue: '#61afef',
        brightMagenta: '#c678dd',
        brightCyan: '#56b6c2',
        brightWhite: '#ffffff',
      },
    });

    // ── Keyboard shortcuts ──
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const { key, ctrlKey, shiftKey } = event;

      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(key)) {
        event.preventDefault();
        return true;
      }
      if (key === 'Tab') {
        event.preventDefault();
        return true;
      }
      if (ctrlKey && key === 'c') {
        const sel = term.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel).catch(() => {});
          event.preventDefault();
          return false;
        }
        return true;
      }
      if (ctrlKey && key === 'l') {
        event.preventDefault();
        handleUserInput('\x0c');
        return false;
      }
      if (ctrlKey && shiftKey && key === 'C') {
        const sel = term.getSelection();
        if (sel) navigator.clipboard.writeText(sel).catch(() => {});
        event.preventDefault();
        return false;
      }
      if ((ctrlKey && key === 'v') || (ctrlKey && shiftKey && key === 'V') || (shiftKey && key === 'Insert')) {
        event.preventDefault();
        navigator.clipboard.readText()
          .then(text => { handleUserInput(text); })
          .catch(() => {});
        return false;
      }
      return true;
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    // Plugin setup hook
    const pluginCleanup = onTerminalReadyRef.current(term, fitAddon);

    termRef.current = term;
    fitRef.current = fitAddon;

    // Suppress xterm.js parser warnings
    const origConsoleError = console.error;
    console.error = (...args: any[]) => {
      if (args[0] && typeof args[0] === 'string' && args[0].startsWith('xterm.js: Parsing error')) return;
      origConsoleError.apply(console, args);
    };

    term.focus();

    // On mobile, reposition xterm's hidden textarea so the browser
    // scrolls recent terminal output into view when focusing for
    // keyboard input, rather than scrolling to the top-left corner
    // where xterm places it by default (x=-9999em).
    if (isTouchDevice()) {
      const ta = term.element?.querySelector('.xterm-helper-textarea') as HTMLElement;
      if (ta) {
        ta.style.left = '0';
        ta.style.top = 'auto';
        ta.style.bottom = '0';
        ta.style.width = '1px';
        ta.style.height = '1px';
        ta.style.pointerEvents = 'none';
      }
      // Set touch-action: none on the xterm element so the browser
      // doesn't consume touch events for native scroll — xterm v6
      // has its own gesture system that handles touch scrolling
      // internally via the custom scrollbar.
      if (term.element) {
        term.element.style.touchAction = 'none';
      }
    }

    // ── Resize observer ──
    const ro = new ResizeObserver(() => {
      fitAddon.fit();
      term.scrollToBottom();
      const dims = fitAddon.proposeDimensions();
      if (dims) onResizeRef.current?.(dims.cols, dims.rows);
    });
    ro.observe(containerRef.current);

    // ── User input from xterm → plugin ──
    const onDataDisposable = term.onData(handleUserInput);

    // ── Focus tracking (for MobileKeyboardSlot) ──
    const focusRoot = containerRef.current;
    const handleFocusIn = () => setTerminalFocused(true);
    const handleFocusOut = () => {
      window.setTimeout(() => {
        if (focusRoot?.contains(document.activeElement)) return;
        setTerminalFocused(false);
      }, 0);
    };
    focusRoot?.addEventListener('focusin', handleFocusIn);
    focusRoot?.addEventListener('focusout', handleFocusOut);

    return () => {
      console.error = origConsoleError;
      onDataDisposable.dispose();
      pluginCleanup?.dispose?.();
      focusRoot?.removeEventListener('focusin', handleFocusIn);
      focusRoot?.removeEventListener('focusout', handleFocusOut);
      ro.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // Focus terminal on mount
  useLayoutEffect(() => {
    termRef.current?.focus();
  }, []);

  const containerStyle = useMemo(() => ({
    background: '#0a0a0a' as const,
    overflow: 'hidden' as const,
    fontFeatureSettings: 'normal' as const,
    fontVariantLigatures: 'none' as const,
  }), []);

  // ── Keyboard-aware bottom padding ───────────────────────────
  // When the mobile keyboard is open, the fixed toolbar sits above
  // it and overlaps the terminal's bottom. Add padding so xterm
  // renders its last rows above the toolbar.
  // The toolbar is py-1.5 (12px) + 2 rows of h-9 (72px) + gap-1
  // (4px) + safe-area (~16px) ≈ 104px. Use 100px for a clean value.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isTouchDevice()) return;
    container.style.paddingBottom = keyboardHeight > 0 ? '100px' : '';
  }, [keyboardHeight]);

  // ── Touch-to-scroll for mobile ─────────────────────────────
  // xterm v6 renders content on an absolutely-positioned .xterm-screen
  // inside .xterm-viewport, so the viewport has no native overflow
  // (scrollHeight === clientHeight). touch-action: none lets touch
  // events through to JS; we convert finger drags to scrollLines().
  //
  // Delta accumulation: frame-by-frame pixel deltas are accumulated
  // and converted to line scrolls when the accumulation crosses the
  // terminal cell height. Direction reversal is natural because the
  // accDelta can go positive or negative.
  //
  // Post-scroll guard: after a scroll gesture, the browser fires a
  // click event. We suppress term.focus() for 150ms to prevent xterm
  // from scrolling to the cursor position (bottom).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isTouchDevice()) return;

    let startY = 0;
    let lastY = 0;
    let scrolling = false;
    let accDelta = 0;
    const justScrolled = { value: false };

    const getLineHeight = (): number => {
      try {
        const dims = (termRef.current as any)?._core?._renderService?.dimensions;
        if (dims?.css?.cell?.height) return dims.css.cell.height;
      } catch { /* best-effort */ }
      try {
        const dims = fitRef.current?.proposeDimensions();
        if (dims) {
          const vpEl = container.querySelector('.xterm-viewport') as HTMLElement;
          if (vpEl && dims.rows > 0) return vpEl.clientHeight / dims.rows;
        }
      } catch { /* fall through */ }
      return 14;
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        startY = e.touches[0].clientY;
        lastY = startY;
        scrolling = false;
        accDelta = 0;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const currentY = e.touches[0].clientY;
      const frameDelta = lastY - currentY; // + = finger up → scroll down

      if (!scrolling && Math.abs(currentY - startY) > 5) {
        scrolling = true;
      }

      if (scrolling) {
        justScrolled.value = true;
        accDelta += frameDelta;
        const lineH = getLineHeight();
        const term = termRef.current;
        if (term && lineH > 0) {
          while (accDelta >= lineH) {
            term.scrollLines(1);
            accDelta -= lineH;
          }
          while (accDelta <= -lineH) {
            term.scrollLines(-1);
            accDelta += lineH;
          }
        }
        e.preventDefault();
      }
      lastY = currentY;
    };

    const handleTouchEnd = () => {
      scrolling = false;
      accDelta = 0;
      setTimeout(() => { justScrolled.value = false; }, 150);
    };

    // Prevent onClick → focus from scrolling to bottom after a gesture
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
      container.removeEventListener('click', guardClick, { capture: true });
      container.removeEventListener('touchstart', handleTouchStart, { capture: true });
      container.removeEventListener('touchmove', handleTouchMove, { capture: true });
      container.removeEventListener('touchend', handleTouchEnd, { capture: true });
    };
  }, []);

  // ── Context menu ────────────────────────────────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const term = termRef.current;
    const items: ContextMenuItem[] = [
      {
        label: 'Copy', shortcut: '⌘C',
        action: () => {
          const sel = term?.getSelection();
          if (sel) navigator.clipboard.writeText(sel).catch(() => {});
        },
      },
      {
        label: 'Paste', shortcut: '⌘V',
        action: () => {
          navigator.clipboard.readText().then(text => handleUserInput(text)).catch(() => {});
        },
      },
      { label: '', action: () => {}, divider: true },
      {
        label: 'Clear Display', shortcut: '⌘L',
        action: () => { handleUserInput('\x0c'); },
      },
      { label: '', action: () => {}, divider: true },
      {
        label: 'Select All',
        action: () => { term?.selectAll(); },
      },
      { label: '', action: () => {}, divider: true },
      {
        label: 'Change Directory...',
        action: () => { onOpenDirectoryPicker?.(); },
      },
    ];
    setCtxMenu({ x: e.clientX, y: e.clientY, items });
  }, [onOpenDirectoryPicker, handleUserInput]);

  return (
    <>
      <div
        ref={containerRef}
        className="flex-1 w-full min-h-0"
        style={containerStyle}
        onClick={() => { termRef.current?.focus(); }}
        onContextMenu={handleContextMenu}
      />
      {ctxMenu && (
        <ContextMenu items={ctxMenu.items} x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} />
      )}
      <MobileKeyboardSlot enabled={terminalFocused} onSend={handleUserInput} />
    </>
  );
}
