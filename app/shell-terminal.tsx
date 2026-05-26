'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ContextMenu, type ContextMenuItem } from './console/shell/context-menu';
import { MobileExtraKeys } from './console/chrome/mobile-extra-keys';
import type { CoreClient } from './console/core/core-types';

interface ShellTerminalProps {
  core: CoreClient;
  coreSessionId: string;
  onOpenDirectoryPicker?: () => void;
}

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

export default function ShellTerminal({ core, coreSessionId, onOpenDirectoryPicker }: ShellTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const mountedRef = useRef(true);
  const coreHandlerRef = useRef<((event: any) => void) | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [terminalFocused, setTerminalFocused] = useState(false);

  const sendTerminalData = useCallback((data: string) => {
    if (core.isConnected && coreSessionId) {
      core.call('stream.write', { sessionId: coreSessionId, data }).catch(() => {});
    }
  }, [core, coreSessionId]);

  /** Connect via CoreClient stream — subscribe to stream.chunk events for this session. */
  function connectCore(term: Terminal, _fitAddon: FitAddon) {
    if (!mountedRef.current) return;
    if (!core || !coreSessionId) return;

    term.writeln('\x1b[36mConnected to core stream...\x1b[0m');
    if (!isTouchDevice()) term.focus();

    const handler = (event: any) => {
      if (event.type !== 'stream.chunk') return;
      if (event.sessionId !== coreSessionId) return;
      if (event.data) term.write(event.data);
    };

    core.on('stream.chunk', handler);
    coreHandlerRef.current = handler;
  }

  useEffect(() => {
    mountedRef.current = true;
    if (!containerRef.current) return;

    // Clear stale xterm DOM from Strict Mode double-mount or previous instances
    (containerRef.current as HTMLElement).innerHTML = '';

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: '"Cascadia Mono", "JetBrains Mono", monospace',
      lineHeight: 1.0,
      letterSpacing: 0,
      allowTransparency: true,
      convertEol: true,          // \n → \r\n on Windows
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

    // ── Keyboard shortcuts: copy/paste, prevent browser scroll ──
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const { key, ctrlKey, shiftKey } = event;

      // Navigation keys: prevent browser scroll, send to terminal
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(key)) {
        event.preventDefault();
        return true;
      }

      // Tab: prevent focus loss, send \t to terminal
      if (key === 'Tab') {
        event.preventDefault();
        return true;
      }

      // Ctrl+C: copy if selection exists, else SIGINT
      if (ctrlKey && key === 'c') {
        const sel = term.getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel).catch(() => {});
          event.preventDefault();
          return false;
        }
        return true;
      }

      // Ctrl+L: clear terminal (send form-feed to shell)
      if (ctrlKey && key === 'l') {
        event.preventDefault();
        sendTerminalData('\x0c');
        return false;
      }

      // Ctrl+Shift+C: always copy
      if (ctrlKey && shiftKey && key === 'C') {
        const sel = term.getSelection();
        if (sel) navigator.clipboard.writeText(sel).catch(() => {});
        event.preventDefault();
        return false;
      }

      // Paste: Ctrl+V / Ctrl+Shift+V / Shift+Insert
      if ((ctrlKey && key === 'v') || (ctrlKey && shiftKey && key === 'V') || (shiftKey && key === 'Insert')) {
        event.preventDefault();
        navigator.clipboard.readText()
          .then(text => {
            sendTerminalData(text);
          })
          .catch(() => {});
        return false;
      }

      return true;
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    if (!isTouchDevice()) term.focus();

    // ── Initial connection ──
    connectCore(term, fitAddon);

    // ── Resize observer ──
    const ro = new ResizeObserver(() => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (!dims) return;

      if (core.isConnected) {
        core.call('process.resize', { sessionId: coreSessionId, cols: dims.cols, rows: dims.rows }).catch(() => {});
      }
    });
    ro.observe(containerRef.current);

    // ── User input → WS ──
    const disposable = term.onData(sendTerminalData);
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
      mountedRef.current = false;
      disposable.dispose();
      focusRoot?.removeEventListener('focusin', handleFocusIn);
      focusRoot?.removeEventListener('focusout', handleFocusOut);
      ro.disconnect();
      if (coreHandlerRef.current) {
        core?.off('stream.chunk', coreHandlerRef.current);
        coreHandlerRef.current = null;
      }
      term.dispose();
      termRef.current = null;
    };
  }, [core, coreSessionId, sendTerminalData]);

  // Re-focus terminal after React re-renders (prevents focus-steal from parent updates)
  useLayoutEffect(() => {
    if (!isTouchDevice() && core.isConnected) {
      requestAnimationFrame(() => { termRef.current?.focus(); });
    }
  });

  const containerStyle = useMemo(() => ({
    background: '#0a0a0a' as const,
    overflow: 'hidden' as const,
    fontFeatureSettings: 'normal' as const,
    fontVariantLigatures: 'none' as const,
  }), []);

  // ── Context menu handler ──────────────────────────────────────
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const term = termRef.current;
    const items: ContextMenuItem[] = [
      {
        label: 'Copy',
        shortcut: '⌘C',
        action: () => {
          const sel = term?.getSelection();
          if (sel) navigator.clipboard.writeText(sel).catch(() => {});
        },
      },
      {
        label: 'Paste',
        shortcut: '⌘V',
        action: () => {
          navigator.clipboard.readText().then(text => {
            if (core.isConnected) sendTerminalData(text);
          }).catch(() => {});
        },
      },
      { label: '', action: () => {}, divider: true },
      {
        label: 'Clear Display',
        shortcut: '⌘L',
        action: () => {
          sendTerminalData('\x0c');
        },
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
  }, [onOpenDirectoryPicker, sendTerminalData, core.isConnected]);

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
      <MobileExtraKeys enabled={terminalFocused} onSend={sendTerminalData} />
    </>
  );
}
