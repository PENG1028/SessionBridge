/**
 * TerminalSession — extracted from TerminalView's onTerminalReady.
 *
 * Owns the terminal lifecycle: DA interception, OSC handlers, stdin buffer,
 * live stream processing, replay, and cleanup.
 *
 * Each phase is a self-contained method. The class tracks all disposables
 * so dispose() never misses a cleanup — no more scattered refs.
 */

import type { FitAddon } from '@xterm/addon-fit';
import { TerminalInputBuffer } from '../../sdk';

// ── Context passed from the React component ─────────────────────────
interface TerminalSessionContext {
  coreSessionId: string | null;
  core: any; // CoreClient
  sessionFresh: boolean;
  onCwdChange: (path: string) => void;
  onNavigatePath?: (path: string) => void;
  setTabTitle?: (title: string) => void;
  setLastActiveDir?: (path: string) => void;
  /** Ref that the component reads on each handleUserInput call to push stdin. */
  inputBufRef: { current: TerminalInputBuffer | null };
  termRef: { current: any };
  fitAddonRef: { current: FitAddon | null };
}

// ── Public API ─────────────────────────────────────────────────────
export type TerminalSessionHandle = { dispose: () => void };

const DEBUG_SURFACE =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).has('debugSurface');
function debugLog(...args: any[]) {
  if (DEBUG_SURFACE) console.log('[debugSurface]', ...args);
}

// ── OSC 7 path parser ─────────────────────────────────────────────
function parseOsc7(data: string): string | undefined {
  const prefix = 'file://';
  if (!data.startsWith(prefix)) return undefined;
  const rest = data.slice(prefix.length);
  const slash = rest.indexOf('/');
  if (slash < 0) return undefined;
  let path = rest.slice(slash);
  try {
    path = decodeURIComponent(path);
  } catch {
    /* malformed, use raw */
  }
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  path = path.replace(/\//g, '\\');
  return path || undefined;
}

// ── Session class ──────────────────────────────────────────────────
export function createTerminalSession(
  term: any,
  fitAddon: FitAddon | null,
  ctx: TerminalSessionContext,
): TerminalSessionHandle {
  const {
    coreSessionId,
    core,
    sessionFresh,
    onCwdChange,
    onNavigatePath,
    setTabTitle,
    inputBufRef,
    termRef,
    fitAddonRef,
  } = ctx;

  // Expose term/fitAddon to the component (font size control, etc.)
  termRef.current = term;
  fitAddonRef.current = fitAddon;

  // ---- shared state ---------------------------------------------------
  const disposables: Array<{ dispose: () => void }> = [];

  // ══════════════════════════════════════════════════════════════════
  // Phase 1 — Intercept DA (Device Attributes) responses
  // ══════════════════════════════════════════════════════════════════
  // Note: term.reset() is NOT called here. Clearing the buffer resets
  // the cursor to row 1 while xterm has N rows (from fit()), leaving
  // N-1 blank rows below the cursor before any content is written.
  // The DA handlers below are sufficient to suppress the DA echo.

  const daHits = { count: 0 };
  (window as any).__daHits = daHits;

  disposables.push(
    term.parser.registerCsiHandler({ prefix: '?', final: 'c' }, () => {
      daHits.count++;
      return true;
    }),
    term.parser.registerCsiHandler({ prefix: '>', final: 'c' }, () => {
      daHits.count++;
      return true;
    }),
    term.parser.registerCsiHandler({ final: 'c' }, (params: (number | number[])[]) => {
      if (params.length === 0 || (params.length === 1 && params[0] === 0)) {
        daHits.count++;
        return true;
      }
      return false;
    }),
  );
  (window as any).__daHandlers = true;

  // ══════════════════════════════════════════════════════════════════
  // Phase 2 — Defense-in-depth DA write filter + diagnostic
  // ══════════════════════════════════════════════════════════════════
  const origWrite = term.write.bind(term);
  (window as any).__filterHits = 0;
  term.write = (data: string) => {
    const before = data;
    data = data.replace(/\x1b\[\?[^a-zA-Z]*c/g, '');
    data = data.replace(/\[\?[^a-zA-Z]*c/g, '');
    // Clamp CUP row values to term.rows so that ConPTY ANSI sequences
    // emitted in a different row coordinate space don't place the
    // cursor outside the visible viewport.  This is defence-in-depth:
    // the primary fix is process.resize syncing PTY size to xterm.
    data = data.replace(/\x1b\[(\d+);(\d+)H/g, (_m: string, row: string, col: string) => {
      const cr = Math.min(+row, term.rows);
      return `\x1b[${cr};${col}H`;
    });
    if (data !== before) {
      (window as any).__filterHits = ((window as any).__filterHits || 0) + 1;
      (window as any).__lastFiltered = {
        before: before.slice(0, 80),
        after: data.slice(0, 80),
        time: Date.now(),
      };
    }
    if (data) origWrite(data);
  };

  // ══════════════════════════════════════════════════════════════════
  // Phase 3 — OSC handlers (CWD tracking, tab title)
  // ══════════════════════════════════════════════════════════════════
  let lastOsc7Cwd = '';

  disposables.push(
    term.parser.registerOscHandler(7, (data: string) => {
      const cwd = parseOsc7(data);
      debugLog('OSC 7', { data, cwd });
      if (cwd && cwd !== lastOsc7Cwd) {
        lastOsc7Cwd = cwd;
        onCwdChange(cwd);
        onNavigatePath?.(cwd);
        ctx.setLastActiveDir?.(cwd);
      }
      return true;
    }),
    term.parser.registerOscHandler(0, (data: string) => {
      if (data && setTabTitle) {
        const parts = data.split(';');
        const title = parts[parts.length - 1] || parts[0];
        const clean = title.replace(/[]/g, '').trim();
        if (clean) setTabTitle(clean);
      }
      return true;
    }),
    term.parser.registerOscHandler(2, (data: string) => {
      if (data && setTabTitle) {
        const clean = data.replace(/[]/g, '').trim();
        if (clean) setTabTitle(clean);
      }
      return true;
    }),
  );

  // ══════════════════════════════════════════════════════════════════
  // Phase 4 — Stdin buffer
  // ══════════════════════════════════════════════════════════════════
  const buf = new TerminalInputBuffer({
    write: (data: string) =>
      core
        .call('stream.write', {
          sessionId: coreSessionId,
          streamType: 'stdin',
          data,
        })
        .catch(() => {}),
  });
  inputBufRef.current = buf;

  // ══════════════════════════════════════════════════════════════════
  // Phase 5 — Live stream handler
  // ══════════════════════════════════════════════════════════════════
  const chunkHandler = (event: any) => {
    if (event.sessionId !== coreSessionId) return;
    if (event.streamType === 'stderr') {
      term.write('\x1b[91m' + event.data + '\x1b[0m');
    } else {
      term.write(event.data);
    }
  };
  if (core.on) core.on('stream.chunk', chunkHandler);

  // ══════════════════════════════════════════════════════════════════
  // Phase 5b — Sync PTY size to xterm dimensions
  // ══════════════════════════════════════════════════════════════════
  // The PTY starts with a safe default (80×24) but xterm's actual
  // dimensions come from fit() which adapts to the browser viewport.
  // Syncing them eliminates the coordinate-space mismatch that causes
  // ANSI CUP sequences from ConPTY to place the cursor at wrong rows.
  const { cols, rows } = term;
  if (cols > 0 && rows > 0 && coreSessionId) {
    core.call('process.resize', { sessionId: coreSessionId, cols, rows })
      .then(() => debugLog('PTY synced to xterm', { cols, rows }))
      .catch(() => {});
  }

  // ══════════════════════════════════════════════════════════════════
  // Phase 6 — Banner + replay → subscribe
  // ══════════════════════════════════════════════════════════════════
  if (sessionFresh) {
    term.writeln('\x1b[36mConnected to core stream...\x1b[0m');
  } else {
    term.writeln('\x1b[36mReconnected to existing session\x1b[0m');
  }

  const fromSeq = sessionFresh ? 0 : 20;

  const replayStdout = core
    .call('stream.replay', {
      sessionId: coreSessionId,
      streamType: 'stdout',
      fromSeq,
    })
    .then((r: any) => {
      if (r?.events)
        for (const evt of r.events) {
          if (evt.data) term.write(evt.data);
        }
    });

  const replayStderr = core
    .call('stream.replay', {
      sessionId: coreSessionId,
      streamType: 'stderr',
      fromSeq,
    })
    .then((r: any) => {
      if (r?.events)
        for (const evt of r.events) {
          if (evt.data) term.write('\x1b[91m' + evt.data + '\x1b[0m');
        }
    });

  Promise.all([replayStdout.catch(() => {}), replayStderr.catch(() => {})]).then(() => {
    requestAnimationFrame(() => {
      try {
        term.scrollToBottom();
      } catch {
        requestAnimationFrame(() => {
          try {
            term.scrollToBottom();
          } catch {
            /* give up */
          }
        });
      }
      core
        .call('stream.subscribe', {
          sessionId: coreSessionId,
          streamType: 'stdout',
        })
        .catch(() => {});
      core
        .call('stream.subscribe', {
          sessionId: coreSessionId,
          streamType: 'stderr',
        })
        .catch(() => {});
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // Cleanup handle
  // ══════════════════════════════════════════════════════════════════
  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
      core.off?.('stream.chunk', chunkHandler);
      buf.dispose();
      inputBufRef.current = null;
    },
  };
}
