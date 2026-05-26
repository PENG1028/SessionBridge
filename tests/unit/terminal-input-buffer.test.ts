// ─── TerminalInputBuffer Unit Tests ─────────────────────
// Tests the client-side input batching for proxy-mode terminal.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TerminalInputBuffer, createDebouncedResize } from '../../app/console/core/terminal-input-buffer';

describe('TerminalInputBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches consecutive input within flush interval', async () => {
    const writes: string[] = [];
    const buf = new TerminalInputBuffer({
      flushMs: 30,
      write: async (data) => { writes.push(data); },
    });

    buf.push('h');
    buf.push('e');
    buf.push('l');
    buf.push('l');
    buf.push('o');

    // Nothing flushed yet (within batch window)
    expect(writes).toHaveLength(0);

    // Advance past flush interval
    await vi.advanceTimersByTimeAsync(30);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe('hello');
  });

  it('flushes immediately on Enter', async () => {
    const writes: string[] = [];
    const buf = new TerminalInputBuffer({
      flushMs: 100,
      write: async (data) => { writes.push(data); },
    });

    buf.push('l');
    buf.push('s');
    buf.push('\r');

    // Enter should trigger immediate flush
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe('ls\r');
  });

  it('flushes immediately on Ctrl+C', async () => {
    const writes: string[] = [];
    const buf = new TerminalInputBuffer({
      flushMs: 100,
      write: async (data) => { writes.push(data); },
    });

    buf.push('\x03');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe('\x03');
  });

  it('flushes immediately on Ctrl+D', async () => {
    const writes: string[] = [];
    const buf = new TerminalInputBuffer({
      flushMs: 100,
      write: async (data) => { writes.push(data); },
    });

    buf.push('e');
    buf.push('x');
    buf.push('i');
    buf.push('t');
    buf.push('\x04');

    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe('exit\x04');
  });

  it('flushes immediately on newline', async () => {
    const writes: string[] = [];
    const buf = new TerminalInputBuffer({
      flushMs: 100,
      write: async (data) => { writes.push(data); },
    });

    buf.push('e');
    buf.push('c');
    buf.push('h');
    buf.push('o');
    buf.push(' ');
    buf.push('"');
    buf.push('a');
    buf.push('"');
    buf.push('\n');

    expect(writes).toHaveLength(1);
  });

  it('flushes when buffer exceeds maxBytes', async () => {
    const writes: string[] = [];
    const buf = new TerminalInputBuffer({
      flushMs: 100,
      maxBytes: 10,
      write: async (data) => { writes.push(data); },
    });

    // Send 15 chars of data — exceeds maxBytes, flushes entire buffer
    buf.push('1234567890abcde');

    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe('1234567890abcde');
  });

  it('dispose flushes pending data', async () => {
    const writes: string[] = [];
    const buf = new TerminalInputBuffer({
      flushMs: 100,
      write: async (data) => { writes.push(data); },
    });

    buf.push('p');
    buf.push('e');
    buf.push('n');
    buf.push('d');
    buf.push('i');
    buf.push('n');
    buf.push('g');

    expect(writes).toHaveLength(0);

    buf.dispose();

    // Should flush synchronously
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe('pending');
  });

  it('dispose marks buffer as disposed', () => {
    const buf = new TerminalInputBuffer({
      write: async () => {},
    });

    expect(buf.disposed).toBe(false);
    buf.dispose();
    expect(buf.disposed).toBe(true);
  });

  it('does not accept data after dispose', async () => {
    const writes: string[] = [];
    const buf = new TerminalInputBuffer({
      flushMs: 10,
      write: async (data) => { writes.push(data); },
    });

    buf.dispose();
    buf.push('should be ignored');

    // Should not have flushed anything
    await vi.advanceTimersByTimeAsync(20);
    // dispose may have flushed (empty string is filtered out)
    expect(writes.length).toBe(0);
  });

  it('calls onError when write fails', async () => {
    const errors: unknown[] = [];
    const buf = new TerminalInputBuffer({
      write: async () => { throw new Error('write failed'); },
      onError: (err) => { errors.push(err); },
    });

    buf.push('test');
    buf.flush();

    // Let the promise rejection settle
    await vi.advanceTimersByTimeAsync(10);

    expect(errors).toHaveLength(1);
    if (errors[0] instanceof Error) {
      expect(errors[0].message).toBe('write failed');
    }
  });

  it('does not flush empty buffer', async () => {
    const writes: string[] = [];
    const buf = new TerminalInputBuffer({
      flushMs: 10,
      write: async (data) => { writes.push(data); },
    });

    buf.flush();

    await vi.advanceTimersByTimeAsync(20);
    expect(writes).toHaveLength(0);
  });

  it('immediate chars can be customized', async () => {
    const writes: string[] = [];
    const buf = new TerminalInputBuffer({
      flushMs: 100,
      immediateChars: ['!'], // only '!' triggers immediate flush
      write: async (data) => { writes.push(data); },
    });

    buf.push('a');
    buf.push('\r'); // \r is NOT in custom immediate chars
    expect(writes).toHaveLength(0); // should NOT flush

    buf.push('!'); // '!' IS in custom set
    expect(writes).toHaveLength(1);
    expect(writes[0]).toBe('a\r!');
  });
});

describe('createDebouncedResize', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces multiple resize calls', async () => {
    const calls: Array<{ cols: number; rows: number }> = [];
    const r = createDebouncedResize({
      delayMs: 80,
      onResize: (cols, rows) => { calls.push({ cols, rows }); },
    });

    r.resize(80, 24);
    r.resize(100, 30);
    r.resize(120, 40);

    expect(calls).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(80);

    // Only last call should fire
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ cols: 120, rows: 40 });
  });

  it('resize fires immediately if no subsequent call within delay', async () => {
    const calls: Array<{ cols: number; rows: number }> = [];
    const r = createDebouncedResize({
      delayMs: 80,
      onResize: (cols, rows) => { calls.push({ cols, rows }); },
    });

    r.resize(80, 24);

    await vi.advanceTimersByTimeAsync(80);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ cols: 80, rows: 24 });
  });

  it('cancel prevents pending resize', async () => {
    const calls: Array<{ cols: number; rows: number }> = [];
    const r = createDebouncedResize({
      delayMs: 80,
      onResize: (cols, rows) => { calls.push({ cols, rows }); },
    });

    r.resize(80, 24);
    r.cancel();

    await vi.advanceTimersByTimeAsync(80);

    expect(calls).toHaveLength(0);
  });
});
