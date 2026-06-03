'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ContextMenu, type ContextMenuItem } from './console/shell/context-menu';
import { MobileExtraKeys } from './console/chrome/mobile-extra-keys';
import type { CoreClient } from './console/core/core-types';
import { TerminalInputBuffer, createDebouncedResize } from './console/core/terminal-input-buffer';

interface ShellTerminalProps {
  core: CoreClient;
  coreSessionId: string;
  onOpenDirectoryPicker?: () => void;
  /** When true (restoring an existing session), skip history replay to avoid
   *  dumping stale buffered ANSI sequences into a fresh xterm.js instance. */
  fresh?: boolean;
}

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

export default function ShellTerminal({ core, coreSessionId, onOpenDirectoryPicker, fresh = true }: ShellTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const mountedRef = useRef(true);
  const coreHandlerRef = useRef<((event: any) => void) | null>(null);
  const inputBufRef = useRef<TerminalInputBuffer | null>(null);
  const debouncedResizeRef = useRef<ReturnType<typeof createDebouncedResize> | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [terminalFocused, setTerminalFocused] = useState(false);

  // Create input buffer and debounced resize for the current session
  useEffect(() => {
    if (!coreSessionId) return;

    const buf = new TerminalInputBuffer({
      write: (data) => core.call('stream.write', { sessionId: coreSessionId, streamType: 'stdin', data }).catch(() => {}),
    });
    inputBufRef.current = buf;

    const dr = createDebouncedResize({
      delayMs: 80,
      onResize: (cols, rows) => {
        core.call('process.resize', { sessionId: coreSessionId, cols, rows }).catch(() => {});
      },
    });
    debouncedResizeRef.current = dr;

    return () => {
      buf.dispose();
      dr.cancel();
      inputBufRef.current = null;
      debouncedResizeRef.current = null;
    };
  }, [coreSessionId, core]);

  // sendTerminalData: local echo for immediate feedback, then batch to server.
  // On Windows, pipe-mode stdin has no character echo — keystrokes feel
  // invisible until Enter. We echo printable characters and control codes
  // locally so the user sees what they type.
  //
  // Enter (\r) is converted to \n so the cursor advances to a new line.
  // If we stripped \r entirely, cmd.exe's line-mode echo would append
  // the command text on the same line as the local echo, producing
  // visible duplication like ">ksks" instead of readable:
  //   >ks
  //   ks
  // (both are the same command appearing twice — one local, one from
  //  the server echoing the line back after processing).
  //
  // Escape sequences (arrow keys) are not echoed, avoiding garbage.
  const sendTerminalData = useCallback((data: string) => {
    const term = termRef.current;
    if (term && !data.startsWith('\x1b')) {
      let echo = data;
      echo = echo.replace(/\r/g, '\n');       // Enter → new line (convertEol expands to \r\n)
      echo = echo.replace(/\x7f/g, '\b \b');   // Backspace → erase last char
      echo = echo.replace(/\x03/g, '^C\r\n');  // Ctrl+C
      if (echo) term.write(echo);
    }
    inputBufRef.current?.push(data);
  }, []);

  /** Replay existing history for this session and write to terminal. */
  const replayHistory = useCallback((term: Terminal) => {
    if (!coreSessionId) return;
    core.call<{ events?: Array<{ data: string }> }>('stream.replay', {
      sessionId: coreSessionId, streamType: 'stdout', fromSeq: 0,
    }).then(r => {
      if (r?.events) for (const evt of r.events) {
        if (evt.data) term.write(evt.data);
      }
    }).catch(() => {});
    core.call<{ events?: Array<{ data: string }> }>('stream.replay', {
      sessionId: coreSessionId, streamType: 'stderr', fromSeq: 0,
    }).then(r => {
      if (r?.events) for (const evt of r.events) {
        if (evt.data) term.write('\x1b[91m' + evt.data + '\x1b[0m');
      }
    }).catch(() => {});
  }, [core, coreSessionId]);

  /** Connect via CoreClient stream — subscribe, replay history, then listen for live chunk events. */
  function connectCore(term: Terminal, _fitAddon: FitAddon, isFresh: boolean) {
    if (!mountedRef.current) return;
    if (!core || !coreSessionId) return;

    if (isFresh) {
      term.writeln('\x1b[36mConnected to core stream...\x1b[0m');
    } else {
      term.writeln('\x1b[36mReconnected to existing session\x1b[0m');
    }
    if (!isTouchDevice()) term.focus();

    // Subscribe to streams (best-effort; Broadcast sends to all connections anyway)
    core.call('stream.subscribe', { sessionId: coreSessionId, streamType: 'stdout' }).catch(() => {});
    core.call('stream.subscribe', { sessionId: coreSessionId, streamType: 'stderr' }).catch(() => {});

    // Register the live chunk handler FIRST so SSE connects before replay runs.
    const handler = (event: any) => {
      if (event.sessionId !== coreSessionId) return;
      if (event.streamType === 'stderr') {
        term.write('\x1b[91m' + event.data + '\x1b[0m');
      } else {
        term.write(event.data);
      }
    };

    core.on('stream.chunk', handler);
    coreHandlerRef.current = handler;

    // Replay existing session output only for fresh sessions.
    // Restored sessions skip replay because the buffer contains terminal
    // initialization handshake sequences (CSI DA requests/responses,
    // cursor queries) that render as garbage in a fresh xterm.js instance.
    // Instead we send a newline to trigger a fresh shell prompt.
    if (isFresh) {
      replayHistory(term);
    } else {
      // Small delay then send Enter — shell prints a fresh prompt so the
      // user isn't staring at a blank screen.
      setTimeout(() => {
        inputBufRef.current?.push('\r');
      }, 200);
    }
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
      convertEol: typeof navigator !== 'undefined' && !/Win/i.test(navigator.userAgent),  // Windows shells already output CRLF; double-conversion causes blank lines
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
    connectCore(term, fitAddon, fresh);

    // ── Resize observer (debounced) ──
    const ro = new ResizeObserver(() => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      if (!dims) return;
      debouncedResizeRef.current?.resize(dims.cols, dims.rows);
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
  }, [core, coreSessionId, sendTerminalData, fresh]);

  // Ensure xterm textarea is focused after mount and on every render
  useLayoutEffect(() => {
    if (!isTouchDevice()) {
      termRef.current?.focus();
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
