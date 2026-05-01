// ─── Shared ANSI Stripping Utility ─────────────────────────────
// Used by both the PTY output processor (server) and the web UI (client).

/**
 * Strip ANSI escape codes and TUI box-drawing characters from text.
 * Removes:
 *   - CSI sequences (cursor movement, SGR colors)
 *   - OSC sequences (window title, etc.)
 *   - DCS / SOS / PM / APC sequences
 *   - C1 control characters and DEL
 *   - Box-drawing (U+2500-257F) and Block elements (U+2580-259F)
 */
export function stripAnsi(s: string): string {
  return s
    // CSI sequences — parameter bytes 0x30-0x3F (digits, :;<=>?),
    // intermediate bytes 0x20-0x2F, final byte 0x40-0x7E.
    .replace(/\x1B\[[\x30-\x3F]*[\x20-\x2F]*[\x40-\x7E]/g, '')
    // OSC 0 (set window title) — common in terminals
    .replace(/\x1B\]0;.*?(?:\x07|\x1B\\)/g, '')
    // Other OSC sequences (ESC ] ... ST)
    .replace(/\x1B\][0-9;]*(?:\x07|\x1B\\)/g, '')
    // DCS, SOS, PM, APC sequences
    .replace(/\x1B[PX^_].*?(?:\x07|\x1B\\)/g, '')
    // C1 control chars and DEL
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\x80-\x9F]/g, '')
    // Box-drawing (U+2500-257F) + Block elements (U+2580-259F)
    .replace(/[─-▟]/g, '')
    // Carriage returns — just keep line-feeds
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}
