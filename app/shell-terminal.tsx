'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { ContextMenu, type ContextMenuItem } from './console/shell/context-menu';

const DEBUG_SURFACE = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('debugSurface');
function debugLog(...args: any[]) { if (DEBUG_SURFACE) console.log('[debugSurface]', ...args); }

interface ShellTerminalProps {
  wsUrl: string;
  instanceId?: string;
  token?: string;
  /** SharedSurface id — when set, use surface protocol (subscribe, replay, operation.input) */
  _surfaceId?: string;
  /** RemoteOperation id — for sending input/cancel to the surface's runtime */
  _operationId?: string;
  onOpenDirectoryPicker?: () => void;
}

/** Envelope helper matching the v1 protocol. */
function env(type: string, body: Record<string, unknown> = {}) {
  return JSON.stringify({ v: 1, ts: Date.now(), type, body });
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 1000;

export default function ShellTerminal({ wsUrl, instanceId, token, _surfaceId, _operationId, onOpenDirectoryPicker }: ShellTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const inputLogFirstRef = useRef(true);
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

  /** Connect via surface protocol — subscribe to shared surface, get replay + live output. */
  function connectSurface(term: Terminal, _fitAddon: FitAddon) {
    if (!mountedRef.current) return;
    if (!_surfaceId) return;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      reconnectAttemptRef.current = 0;
      term.writeln('\x1b[36mConnected to shared surface...\x1b[0m');
      term.focus();
      const helloBody: Record<string, unknown> = {
        role: 'browser',
        features: ['shell'],
        clientToken: `surface:${_surfaceId}`,
      };
      if (token) helloBody.token = token;
      ws.send(env('hello', helloBody));
      ws.send(env('surface.subscribe', { surfaceId: _surfaceId }));
      debugLog('ShellTerminal surface.subscribe SENT', { _surfaceId, _operationId });
    };

    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data);
        const body = (parsed.v === 1 && parsed.body) ? parsed.body : parsed;
        const type = parsed.type || '';

        if (type === 'ping') {
          ws.send(env('pong'));
        } else if (type === 'runtime.replay') {
          const outputs = Array.isArray(body.outputs) ? body.outputs : [];
          debugLog('ShellTerminal received runtime.replay', { surfaceId: _surfaceId, outputCount: outputs.length });
          for (const chunk of outputs) {
            if (chunk.data) term.write(chunk.data);
          }
        } else if (type === 'runtime.output') {
          if (body.data) term.write(body.data);
        } else if (type === 'runtime.result') {
          const ok = body.success !== false;
          term.writeln(ok
            ? `\r\n\x1b[90m[Operation completed, exit=${body.exitCode ?? '?'}]\x1b[0m`
            : `\r\n\x1b[91m[Operation failed: ${body.error || 'unknown'}]\x1b[0m`);
        } else if (type === 'runtime.status') {
          if (body.status === 'completed' || body.status === 'failed') {
            // result follows separately
          }
        } else if (type === 'error') {
          term.writeln(`\r\n\x1b[91m[Error] ${body.message || body.code || 'Unknown error'}\x1b[0m`);
        }
      } catch {}
    };

    ws.onerror = () => {
      term.writeln('\x1b[91m[Surface WebSocket error]\x1b[0m');
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      term.writeln('\r\n\x1b[90m[Surface connection closed]\x1b[0m');
      if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptRef.current++;
        const delay = RECONNECT_BASE_MS * Math.pow(2, reconnectAttemptRef.current - 1);
        reconnectTimerRef.current = setTimeout(() => connectSurface(term, _fitAddon), delay);
      }
    };
  }

  useEffect(() => {
    mountedRef.current = true;
    inputLogFirstRef.current = true;
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
          if (_surfaceId && _operationId) {
            ws.send(env('operation.input', { operationId: _operationId, data: '\x0c' }));
          } else {
            ws.send(env('shell.input', { data: '\x0c' }));
          }
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
              if (_surfaceId && _operationId) {
                ws.send(env('operation.input', { operationId: _operationId, data: text }));
              } else {
                ws.send(env('shell.input', { data: text }));
              }
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
    if (_surfaceId) {
      debugLog('ShellTerminal: connecting via SURFACE protocol', { _surfaceId, _operationId, instanceId });
      connectSurface(term, fitAddon);
    } else {
      debugLog('ShellTerminal: connecting via SHELL protocol', { instanceId });
      connect(term, fitAddon);
    }

    // ── Resize observer ──
    const ro = new ResizeObserver(() => {
      fitAddon.fit();
      if (_surfaceId) return; // surface mode: resize is N/A for shared terminal replay
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
        if (_surfaceId && _operationId) {
          if (inputLogFirstRef.current) { debugLog('ShellTerminal input routing: operation.input (surface path)', { _surfaceId, _operationId }); inputLogFirstRef.current = false; }
          ws.send(env('operation.input', { operationId: _operationId, data }));
        } else {
          if (inputLogFirstRef.current) { debugLog('ShellTerminal input routing: shell.input (direct path)', { instanceId }); inputLogFirstRef.current = false; }
          const body: Record<string, unknown> = { data };
          if (instanceId) body.instanceId = instanceId;
          ws.send(env("shell.input", body));
        }
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
  }, [wsUrl, token, instanceId, _surfaceId, _operationId]);

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
              if (_surfaceId && _operationId) {
                ws.send(env('operation.input', { operationId: _operationId, data: text }));
              } else {
                ws.send(env('shell.input', { data: text }));
              }
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
            if (_surfaceId && _operationId) {
              ws.send(env('operation.input', { operationId: _operationId, data: '\x0c' }));
            } else {
              ws.send(env('shell.input', { data: '\x0c' }));
            }
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
  }, [onOpenDirectoryPicker, _surfaceId, _operationId]);

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
