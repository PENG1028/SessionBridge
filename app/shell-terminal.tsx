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
  /** Called once after xterm is created and opened. Plugin registers
   *  OSC handlers, stream subscriptions, stdin pipes, etc. here.
   *  Return a cleanup disposable (disposed on unmount or session change). */
  onTerminalReady: (term: Terminal, fitAddon: FitAddon) => IDisposable | void;
  /** Called on every ResizeObserver tick with the new cols/rows. */
  onResize?: (cols: number, rows: number) => void;
  /** Called when the user types or pastes data. Plugin feeds into stdin buffer. */
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
    // Echo printable characters locally for immediate feedback.
    // Escape sequences (arrow keys) are not echoed — the shell handles those.
    // Tab (\t) is also skipped: shell tab-completion echoes it properly,
    // and local-echo of Tab causes cursor position desync on mobile.
    if (term && !data.startsWith('\x1b') && data !== '\t') {
      try {
        let echo = data;
        echo = echo.replace(/\r/g, '\n');       // Enter → new line
        echo = echo.replace(/\x03/g, '^C\r\n');  // Ctrl+C
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

    // Clear stale DOM from Strict Mode double-mount or previous instances
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

    // Suppress xterm.js parser warnings (they're harmless — just noise from
    // shell-generated escape sequences that the internal VT parser can't handle)
    const origConsoleError = console.error;
    console.error = (...args: any[]) => {
      if (args[0] && typeof args[0] === 'string' && args[0].startsWith('xterm.js: Parsing error')) return;
      origConsoleError.apply(console, args);
    };

    // Always focus the terminal — mobile needs it for physical keyboard
    // events (Ctrl+C etc.) and cursor positioning to work properly.
    term.focus();

    // On mobile, reposition xterm's hidden textarea so Android
    // doesn't scroll to x=-9999em when focusing it for keyboard input.
    // Place it at the container bottom so the browser scrolls recent
    // terminal output into view (above the keyboard), not the top-left.
    //
    // Also set touch-action: pan-y as inline style on the xterm element.
    // This lets the browser handle vertical touch-drags as native scroll
    // gestures on the .xterm-viewport, without JS interference.
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
      // Inline touch-action ensures it takes effect regardless of CSS order
      if (term.element) {
        term.element.style.touchAction = 'pan-y';
      }
      const vp = term.element?.querySelector('.xterm-viewport') as HTMLElement;
      if (vp) {
        vp.style.touchAction = 'pan-y';
      }
    }

    // ── Resize observer (fit only; onResize goes to plugin) ──
    const ro = new ResizeObserver(() => {
      fitAddon.fit();
      // After resize (keyboard open/close, pane split), keep the
      // input line visible. Without this, the viewport stays at its
      // previous scroll offset and the bottom gets clipped.
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
  }, []); // one-shot — session changes go through onTerminalReady cleanup

  // ── Touch-to-scroll for mobile ─────────────────────────────
  // xterm v6 has its own gesture system that intercepts touch events
  // and calls preventDefault(), which blocks native browser scrolling.
  // We use capture-phase listeners to intercept touch events BEFORE
  // xterm's gesture handler, and manually scroll the terminal buffer.
  //
  // Approach: absolute positioning via scrollToLine.
  // On touchstart, capture the current buffer viewport position (baseY).
  // On touchmove, convert total pixel delta to line delta and set
  // baseY + lineDelta as the target line. This avoids accumulation
  // drift and direction-reversal bugs that plagued the delta-based
  // approach.
  //
  //   - Capture phase: fires before xterm's document-level listeners,
  //     so preventDefault() stops xterm's gesture handling.
  //   - Single-finger only: multi-touch passes through to browser.
  //   - 5px dead zone: allows tap-to-focus without accidental scroll.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isTouchDevice()) return;

    let startY = 0;
    let startBaseY = 0;    // buffer baseY at touchstart
    let startViewY = 0;    // buffer viewportY at touchstart
    let scrolling = false;
    let lastTargetLine = -1;

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

    const getBaseY = (): number => {
      try {
        return (termRef.current as any)?._core?.bufferService?.buffer?.baseY
          ?? termRef.current?.buffer?.active?.baseY
          ?? 0;
      } catch { return 0; }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        startY = e.touches[0].clientY;
        startBaseY = getBaseY();
        startViewY = termRef.current?.buffer?.active?.viewportY ?? 0;
        scrolling = false;
        lastTargetLine = -1;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const currentY = e.touches[0].clientY;
      const totalPxDelta = startY - currentY; // + = finger up → scroll down

      if (!scrolling && Math.abs(totalPxDelta) > 5) {
        scrolling = true;
      }

      if (scrolling) {
        const lineH = getLineHeight();
        const lineDelta = Math.round(totalPxDelta / lineH);
        const targetLine = startBaseY + lineDelta + startViewY;
        if (targetLine !== lastTargetLine) {
          lastTargetLine = targetLine;
          termRef.current?.scrollToLine(Math.max(0, targetLine));
        }
        // Prevent xterm's gesture system from also handling this touch
        e.preventDefault();
      }
    };

    const handleTouchEnd = () => {
      scrolling = false;
      lastTargetLine = -1;
    };

    container.addEventListener('touchstart', handleTouchStart, { capture: true, passive: true });
    container.addEventListener('touchmove', handleTouchMove, { capture: true, passive: false });
    container.addEventListener('touchend', handleTouchEnd, { capture: true, passive: true });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart, { capture: true });
      container.removeEventListener('touchmove', handleTouchMove, { capture: true });
      container.removeEventListener('touchend', handleTouchEnd, { capture: true });
    };
  }, []);

  // Focus terminal on mount so keyboard shortcuts work immediately.
  // On mobile, skip auto-focus — the user taps to focus, which is the
  // expected mobile pattern (no unexpected keyboard pop).
  useLayoutEffect(() => {
    termRef.current?.focus();
  }, []);

  // ── Container style (keyboard-aware padding) ────────────────
  // When the mobile keyboard is open, the fixed toolbar sits above
  // the keyboard and covers the terminal's bottom portion. Read the
  // toolbar's actual rendered height from the DOM so the padding
  // exactly matches. Fallback: 100px (typical 2-row toolbar).
  const containerStyle = useMemo(() => {
    let toolbarH = 0;
    if (keyboardHeight > 0 && typeof document !== 'undefined') {
      const bar = document.querySelector('[data-mobile-keyboard-toolbar]') as HTMLElement | null;
      if (bar) {
        toolbarH = bar.offsetHeight;
      }
    }
    return {
      background: '#0a0a0a' as const,
      overflow: 'hidden' as const,
      fontFeatureSettings: 'normal' as const,
      fontVariantLigatures: 'none' as const,
      paddingBottom: keyboardHeight > 0 ? (toolbarH || 100) : 0,
    };
  }, [keyboardHeight]);

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
