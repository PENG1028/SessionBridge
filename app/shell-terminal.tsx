'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ContextMenu, type ContextMenuItem } from './console/shell/context-menu';

interface ShellTerminalProps {
  wsUrl: string;
  instanceId?: string;
  token?: string;
  onOpenDirectoryPicker?: () => void;
}

/** Envelope helper matching the v1 protocol. */
function env(type: string, body: Record<string, unknown> = {}) {
  return JSON.stringify({ v: 1, ts: Date.now(), type, body });
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 1000;

export default function ShellTerminal({ wsUrl, instanceId, token, onOpenDirectoryPicker }: ShellTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  /** Connect (or reconnect) the WebSocket for this terminal. */
  function connect(term: Terminal, fitAddon: FitAddon) {
    if (!mountedRef.current) return;

    // Phase 4F: Do NOT connect without an instanceId — shell.spawn without
    // instanceId creates a new runtime, which is an implicit side effect.
    // The caller (TerminalView) is responsible for rendering ShellTerminal
    // only when a valid instanceId is available.
    if (!instanceId) return;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    // Show connection progress in the terminal itself
    term.writeln('\x1b[90mConnecting to shell...\x1b[0m');

    ws.onopen = () => {
      reconnectAttemptRef.current = 0; // reset on successful connect
      term.writeln('\x1b[36mWebSocket connected, spawning shell...\x1b[0m');
      term.focus();
      // Hello + spawn shell
      // Use stable clientToken so the relay preserves the shell across page
      // refreshes (60s grace period). Derived from instanceId for stability.
      const helloBody: Record<string, unknown> = {
        role: "browser",
        features: ["shell"],
        clientToken: `shell:${instanceId}`,
      };
      if (token) helloBody.token = token;
      ws.send(env("hello", helloBody));
      ws.send(env("shell.spawn", { instanceId }));
      // Initial resize
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(env("shell.resize", { cols: dims.cols, rows: dims.rows }));
      }
    };

    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        // Handle both v1 envelope and legacy format
        const body = (parsed.v === 1 && parsed.body) ? parsed.body : parsed;
        const type = parsed.type || '';

        if (type === 'ping') {
          ws.send(env('pong'));
        } else if (type === 'shell.output') {
          term.write(body.data || body.data);
        } else if (type === 'shell_output') {
          // Legacy format
          term.write(body.data);
        } else if (type === 'shell.exit') {
          term.writeln(`\r\n\x1b[90m[Shell exited with code ${body.code}]\x1b[0m`);
        } else if (type === 'shell_exit') {
          term.writeln(`\r\n\x1b[90m[Shell exited with code ${body.code}]\x1b[0m`);
        } else if (type === 'error') {
          term.writeln(`\r\n\x1b[91m[Error] ${body.message || body.code || 'Unknown error'}\x1b[0m`);
        } else if (type === 'shell.error') {
          term.writeln(`\r\n\x1b[91m[Shell Error] ${body.message || 'Shell error'}\x1b[0m`);
        } else if (type === 'shell.ready' || type === 'shell_ready') {
          term.writeln('\x1b[32mShell ready — type below\x1b[0m');
        }
      } catch {}
    };

    ws.onerror = () => {
      term.writeln('\x1b[91m[WebSocket error]\x1b[0m');
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      term.writeln('\r\n\x1b[90m[Connection closed]\x1b[0m');
      // Reconnect with exponential backoff
      if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptRef.current++;
        const delay = RECONNECT_BASE_MS * Math.pow(2, reconnectAttemptRef.current - 1);
        reconnectTimerRef.current = setTimeout(() => connect(term, fitAddon), delay);
      }
    };
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
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(env('shell.input', { data: '\x0c' }));
        } else {
          term.clear();
        }
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
            const ws = wsRef.current;
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(env('shell.input', { data: text }));
            }
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

    // Auto-focus on click so typing works immediately
    term.focus();

    // ── Initial WebSocket connection ──
    connect(term, fitAddon);

    // ── Resize observer ──
    const ro = new ResizeObserver(() => {
      fitAddon.fit();
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ws.send(env("shell.resize", { cols: dims.cols, rows: dims.rows }));
        }
      }
    });
    ro.observe(containerRef.current);

    // ── User input → WS ──
    const disposable = term.onData((data) => {
      const ws = wsRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        const body: Record<string, unknown> = { data };
        if (instanceId) body.instanceId = instanceId;
        ws.send(env("shell.input", body));
      }
    });

    return () => {
      mountedRef.current = false;
      disposable.dispose();
      ro.disconnect();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
    };
  }, [wsUrl, token, instanceId]);

  // Re-focus terminal after React re-renders (prevents focus-steal from parent updates)
  // Only when WebSocket is open — avoids stealing focus from other tabs/elements
  useLayoutEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
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
    const ws = wsRef.current;
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
            if (ws?.readyState === WebSocket.OPEN) {
              ws.send(env('shell.input', { data: text }));
            }
          }).catch(() => {});
        },
      },
      { label: '', action: () => {}, divider: true },
      {
        label: 'Clear Display',
        shortcut: '⌘L',
        action: () => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(env('shell.input', { data: '\x0c' }));
          } else {
            term?.clear();
          }
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
  }, [onOpenDirectoryPicker]);

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
    </>
  );
}
