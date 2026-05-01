'use client';

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface ShellTerminalProps {
  wsUrl: string;
}

/** Envelope helper matching the v1 protocol. */
function env(type: string, body: Record<string, unknown> = {}) {
  return JSON.stringify({ v: 1, ts: Date.now(), type, body });
}

export default function ShellTerminal({ wsUrl }: ShellTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
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

    // ── WebSocket connection ──
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      term.focus();
      // Hello + spawn shell
      ws.send(env("hello", { role: "browser", features: ["shell"] }));
      ws.send(env("shell.spawn"));
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

        if (type === 'shell.output') {
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
      term.writeln('\r\n\x1b[90m[Connection closed]\x1b[0m');
    };

    // ── Resize observer ──
    const ro = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          ws.send(env("shell.resize", { cols: dims.cols, rows: dims.rows }));
        }
      }
    });
    ro.observe(containerRef.current);

    // ── User input → WS ──
    const disposable = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(env("shell.input", { data }));
      }
    });

    return () => {
      disposable.dispose();
      ro.disconnect();
      ws.close();
      term.dispose();
      wsRef.current = null;
    };
  }, [wsUrl]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: '#0a0a0a',
        overflow: 'hidden',
      }}
    />
  );
}
