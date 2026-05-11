'use client';

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface ShellTerminalProps {
  wsUrl: string;
  instanceId?: string;
  token?: string;
}

/** Envelope helper matching the v1 protocol. */
function env(type: string, body: Record<string, unknown> = {}) {
  return JSON.stringify({ v: 1, ts: Date.now(), type, body });
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 1000;

export default function ShellTerminal({ wsUrl, instanceId, token }: ShellTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

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

    ws.onopen = () => {
      reconnectAttemptRef.current = 0; // reset on successful connect
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
        }
      } catch {}
    };

    ws.onerror = () => {};

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

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
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

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

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

  return (
    <div
      ref={containerRef}
      className="flex-1 w-full min-h-0"
      style={{
        background: '#0a0a0a',
        overflow: 'hidden',
      }}
    />
  );
}
