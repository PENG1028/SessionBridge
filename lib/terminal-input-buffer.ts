// ─── Terminal Input Buffer — Client-Side Input Batching ───
// Batches terminal stream.write calls to reduce HTTP POST frequency
// in proxy mode. Key presses are merged within a short window;
// control characters (Ctrl+C, Ctrl+D, Enter) flush immediately.
// Large pastes are split at maxBytes boundaries.
//
// Usage:
//   const buf = new TerminalInputBuffer({
//     write: (data) => core.call('stream.write', { sessionId, streamType: 'stdin', data }),
//   });
//   term.onData(data => buf.push(data));
//   // on unmount: buf.dispose();

export class TerminalInputBuffer {
  private _buffer: string[] = [];
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _write: (data: string) => Promise<unknown>;
  private _flushMs: number;
  private _maxBytes: number;
  private _immediateChars: Set<string>;
  private _disposed = false;
  private _onError?: (err: unknown) => void;

  constructor(options: {
    /** Flush interval in ms (default 30). */
    flushMs?: number;
    /** Max bytes before forced flush (default 4096). */
    maxBytes?: number;
    /** Characters that trigger immediate flush (default: Ctrl+C, Ctrl+D, \r, \n, \x0c). */
    immediateChars?: string[];
    /** Async function called with batched data on flush. */
    write: (data: string) => Promise<unknown>;
    /** Optional error callback (logged to console by default). */
    onError?: (err: unknown) => void;
  }) {
    this._write = options.write;
    this._flushMs = options.flushMs ?? 30;
    this._maxBytes = options.maxBytes ?? 4096;
    this._immediateChars = new Set(options.immediateChars ?? ['\x03', '\x04', '\r', '\n', '\x0c']);
    this._onError = options.onError;
  }

  /** Queue data for writing. Flushes immediately if it contains
   *  an immediate-flush character or if the buffer exceeds maxBytes. */
  push(data: string): void {
    if (this._disposed || !data) return;

    this._buffer.push(data);

    // Forced flush on max bytes
    const totalBytes = this._buffer.join('').length;
    if (totalBytes >= this._maxBytes) {
      this._scheduleFlush(0);
      return;
    }

    // Immediate flush if any char in data triggers it
    if (this._hasImmediateChar(data)) {
      this._scheduleFlush(0);
      return;
    }

    // Schedule deferred flush
    if (!this._timer) {
      this._timer = setTimeout(() => this.flush(), this._flushMs);
    }
  }

  /** Flush buffered data immediately. Safe to call multiple times. */
  async flush(): Promise<unknown> {
    if (this._disposed) return;
    this._cancelTimer();

    const data = this._buffer.join('');
    this._buffer = [];
    if (!data) return;

    try {
      await this._write(data);
    } catch (err) {
      this._onError?.(err);
      console.error('[TerminalInputBuffer] write error:', err);
    }
  }

  /** Cancel pending flush, flush remaining data, and mark disposed.
   *  Call on component unmount. */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._cancelTimer();
    const data = this._buffer.join('');
    this._buffer = [];
    if (data) {
      this._write(data).catch((err) => {
        this._onError?.(err);
        console.error('[TerminalInputBuffer] dispose write error:', err);
      });
    }
  }

  get disposed(): boolean {
    return this._disposed;
  }

  /** Schedule a flush. delayMs=0 flushes synchronously. */
  private _scheduleFlush(delayMs: number): void {
    this._cancelTimer();
    if (delayMs > 0) {
      this._timer = setTimeout(() => this.flush(), delayMs);
    } else {
      this.flush();
    }
  }

  private _cancelTimer(): void {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private _hasImmediateChar(data: string): boolean {
    for (let i = 0; i < data.length; i++) {
      if (this._immediateChars.has(data[i])) return true;
    }
    return false;
  }
}

// ─── Debounced Resize Helper ────────────────────────────
// Debounces process.resize calls to prevent excessive HTTP POSTs
// during window resize or font zoom.

export function createDebouncedResize(options: {
  delayMs?: number;
  onResize: (cols: number, rows: number) => void;
}): {
  resize: (cols: number, rows: number) => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastCols = 0;
  let lastRows = 0;

  return {
    resize(cols: number, rows: number): void {
      lastCols = cols;
      lastRows = rows;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        options.onResize(lastCols, lastRows);
      }, options.delayMs ?? 80);
    },
    cancel(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
