'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { IDisposable } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { ContextMenu, type ContextMenuItem } from './console/shell/context-menu';
import { MobileKeyboardSlot, consumeMobileModifiers } from './console/chrome/mobile-keyboard-slot';
import { useMobileTerminal } from './console/chrome/use-mobile-terminal';
import { pushInputDiagEvent } from '../lib/input-diag';

// ─── ShellTerminal — pure xterm.js host ────────────────────────────
// Owns: xterm init/theme/fit, keyboard shortcuts, context menu, resize observer.
// Mobile touch/scroll/padding → useMobileTerminal hook.
// Does NOT know about Core, streams, stdin buffering, or OSC protocols.
// All Core integration goes through onTerminalReady / onUserInput.
// PTY dimensions are fixed at session creation — local fit() does not resize the shell.

export interface ShellTerminalProps {
  onTerminalReady: (term: Terminal, fitAddon: FitAddon) => IDisposable | void;
  onUserInput?: (data: string) => void;
  onOpenDirectoryPicker?: () => void;
}

export default function ShellTerminal({ onTerminalReady, onUserInput, onOpenDirectoryPicker }: ShellTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [terminalFocused, setTerminalFocused] = useState(false);

  // ── Mobile: touch scroll, keyboard padding ──────────────────
  useMobileTerminal(containerRef, termRef, fitRef);

  // Stable refs so callbacks don't cause unnecessary re-registration
  const onTerminalReadyRef = useRef(onTerminalReady);
  onTerminalReadyRef.current = onTerminalReady;
  const onUserInputRef = useRef(onUserInput);
  onUserInputRef.current = onUserInput;

  // ── User-input bridge ─────────────────────────────────────
  // No local echo — the shell echoes back via stream.chunk with
  // proper ANSI formatting. Dual echo (local + shell) causes
  // ghost text and cursor position drift on mobile.
  const handleUserInput = useCallback((data: string) => {
    // ── Input diagnostic (mobile only) ──
    if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) {
      pushInputDiagEvent('onD', data);
    }
    onUserInputRef.current?.(consumeMobileModifiers(data));
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

    // ── Input safety net + diagnostic on mobile ──
    // xterm.js v6 on mobile processes text input via a hidden textarea.
    // Some characters (e.g. ") hit a code path where xterm.js fails to
    // consume textarea.value, leaving leftovers that corrupt subsequent
    // input (they get concatenated with the next typed character).
    //
    // This safety net monitors the textarea input event. After giving
    // xterm.js one rAF to process, if text is still in the textarea
    // (and we're not in an IME composition), flush it directly.
    const ta = containerRef.current.querySelector('.xterm-helper-textarea') as HTMLTextAreaElement | null;
    let _inComposition = false;
    const diagOnCS = () => { _inComposition = true; pushInputDiagEvent('cS', ''); };
    const diagOnCU = (e: CompositionEvent) => pushInputDiagEvent('cU', e.data || '');
    const diagOnCE = () => { _inComposition = false; pushInputDiagEvent('cE', ''); };
    const diagOnInp = (e: Event) => {
      const t = e.target as HTMLTextAreaElement;
      pushInputDiagEvent('inp', t?.value?.slice(-40) || '');
      if (!t || !t.value || _inComposition) return;
      requestAnimationFrame(() => {
        if (!t.value || _inComposition) return;
        pushInputDiagEvent('onD', '[flush]' + t.value.slice(0, 30));
        handleUserInput(t.value);
        t.value = '';
      });
    };
    ta?.addEventListener('compositionstart', diagOnCS);
    ta?.addEventListener('compositionupdate', diagOnCU);
    ta?.addEventListener('compositionend', diagOnCE);
    ta?.addEventListener('input', diagOnInp);

    // ══════ Xterm styles — moved from globals.css ══════
    const xtermStyle = document.createElement('style');
    xtermStyle.dataset.sbXterm = '1';
    xtermStyle.textContent = [
      '.xterm{height:100%;padding:0 .25rem}',
      '.xterm-viewport{scrollbar-width:thin;scrollbar-color:#30363d transparent}',
      '.xterm-viewport::-webkit-scrollbar{width:6px}',
      '.xterm-viewport::-webkit-scrollbar-track{background:transparent}',
      '.xterm-viewport::-webkit-scrollbar-thumb{border-radius:9999px;background:#30363d}',
      '@media(pointer:coarse){.xterm-viewport::-webkit-scrollbar{width:16px}}',
      // Keep custom overlay scrollbar always visible
      '.xterm .xterm-scrollable-element>.invisible{opacity:1!important;pointer-events:auto!important;transition:none!important}',
    ].join('');
    document.head.appendChild(xtermStyle);
    // ══════ END ══════

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

    // Focus on desktop only — mobile keyboard is triggered by user tap
    if (typeof navigator !== 'undefined' && navigator.maxTouchPoints === 0) {
      term.focus();
    }

    // ── Resize observer ──
    // fit() adjusts the terminal to match the container. This is a
    // purely local operation — it does NOT resize the shared PTY.
    // The PTY (120×40) is fixed and never changes. On small viewports
    // xterm clamps CUP positions to its own rows, and the scrollbar
    // provides access to all content. Use the font size ± controls
    // in the header to zoom in/out.
    const ro = new ResizeObserver(() => {
      fitAddon.fit();
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
      xtermStyle.remove();
      console.error = origConsoleError;
      onDataDisposable.dispose();
      pluginCleanup?.dispose?.();
      focusRoot?.removeEventListener('focusin', handleFocusIn);
      focusRoot?.removeEventListener('focusout', handleFocusOut);
      ta?.removeEventListener('compositionstart', diagOnCS);
      ta?.removeEventListener('compositionupdate', diagOnCU);
      ta?.removeEventListener('compositionend', diagOnCE);
      ta?.removeEventListener('input', diagOnInp);
      ro.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // Focus terminal on mount — desktop only
  useLayoutEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.maxTouchPoints === 0) {
      termRef.current?.focus();
    }
  }, []);

  const containerStyle = useMemo(() => ({
    background: '#0a0a0a' as const,
    overflow: 'hidden' as const,
    fontFeatureSettings: 'normal' as const,
    fontVariantLigatures: 'none' as const,
  }), []);

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
        onClick={() => {
          // Touch devices manage focus via touchend handler in
          // useMobileTerminal. onClick fires after every touch
          // (including scroll/close-keyboard taps) and would
          // refocus the textarea → reopen the keyboard.
          if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) return;
          termRef.current?.focus();
        }}
        onContextMenu={handleContextMenu}
      />
      {ctxMenu && (
        <ContextMenu items={ctxMenu.items} x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)} />
      )}
      <MobileKeyboardSlot enabled={terminalFocused} onSend={handleUserInput} />
    </>
  );
}
