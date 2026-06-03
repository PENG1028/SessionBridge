// ─── Unit tests: ANSI processing ─────────────────────────────

import { describe, it, expect } from 'vitest';
import { stripAnsi, hasAnsi } from '../../lib/ansi';

// Parse simple ANSI-styled segments
interface AnsiSegment {
  text: string;
  bold?: boolean;
  color?: string;
}

function parseAnsi(str: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  const parts = str.split(/(\x1B\[[0-9;]*[a-zA-Z])/);
  let currentStyle: { bold?: boolean; color?: string } = {};
  let textBuffer = '';

  for (const part of parts) {
    const ansiMatch = part.match(/^\x1B\[([0-9;]*)m$/);
    if (ansiMatch) {
      if (textBuffer) {
        segments.push({ text: textBuffer, ...currentStyle });
        textBuffer = '';
      }
      const codes = ansiMatch[1] ? ansiMatch[1].split(';') : ['0'];
      for (const code of codes) {
        switch (code) {
          case '0': currentStyle = {}; break;
          case '1': currentStyle.bold = true; break;
          case '31': currentStyle.color = 'red'; break;
          case '32': currentStyle.color = 'green'; break;
          case '33': currentStyle.color = 'yellow'; break;
          case '34': currentStyle.color = 'blue'; break;
          case '35': currentStyle.color = 'magenta'; break;
          case '36': currentStyle.color = 'cyan'; break;
          default: break;
        }
      }
    } else {
      textBuffer += part;
    }
  }
  if (textBuffer) segments.push({ text: textBuffer, ...currentStyle });
  return segments;
}

describe('stripAnsi', () => {
  it('strips simple color codes', () => {
    expect(stripAnsi('\x1B[31mred\x1B[0m')).toBe('red');
  });

  it('strips bold codes', () => {
    expect(stripAnsi('\x1B[1mbold\x1B[0m')).toBe('bold');
  });

  it('strips multiple codes', () => {
    expect(stripAnsi('\x1B[1m\x1B[31mbold red\x1B[0m')).toBe('bold red');
  });

  it('returns plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('');
  });

  it('strips cursor movement codes', () => {
    expect(stripAnsi('\x1B[2J\x1B[Hclear')).toBe('clear');
  });

  it('strips OSC window title sequences', () => {
    expect(stripAnsi('\x1B]0;My Title\x07text')).toBe('text');
    expect(stripAnsi('\x1B]0;Title\x1B\\more')).toBe('more');
  });

  it('strips DCS sequences', () => {
    expect(stripAnsi('\x1BP123abc\x07remain')).toBe('remain');
  });

  it('strips C1 control characters', () => {
    expect(stripAnsi('\x80\x9Fnormal')).toBe('normal');
  });

  it('strips box-drawing and block characters', () => {
    expect(stripAnsi('─╿text')).toBe('text');
    expect(stripAnsi('▀▟more')).toBe('more');
  });

  it('normalizes carriage returns', () => {
    expect(stripAnsi('a\r\nb')).toBe('a\nb');
    expect(stripAnsi('a\rb')).toBe('a\nb');
  });
});

describe('hasAnsi', () => {
  it('detects ANSI codes', () => {
    expect(hasAnsi('\x1B[31mtest')).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(hasAnsi('test')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasAnsi('')).toBe(false);
  });
});

describe('parseAnsi', () => {
  it('parses red text', () => {
    const segs = parseAnsi('\x1B[31mred\x1B[0m');
    expect(segs).toHaveLength(1);
    expect(segs[0].color).toBe('red');
    expect(segs[0].text).toBe('red');
  });

  it('parses bold text', () => {
    const segs = parseAnsi('\x1B[1mbold\x1B[0m');
    expect(segs).toHaveLength(1);
    expect(segs[0].bold).toBe(true);
  });

  it('handles mixed plain and styled text', () => {
    const segs = parseAnsi('plain \x1B[31mred\x1B[0m plain');
    expect(segs).toHaveLength(3);
    expect(segs[0].text).toBe('plain ');
    expect(segs[0].color).toBeUndefined();
    expect(segs[1].text).toBe('red');
    expect(segs[1].color).toBe('red');
    expect(segs[2].text).toBe(' plain');
  });

  it('handles string with no ANSI codes', () => {
    const segs = parseAnsi('plain text');
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe('plain text');
  });

  it('handles empty string', () => {
    const segs = parseAnsi('');
    expect(segs).toHaveLength(0);
  });

  it('handles green bold combination', () => {
    const segs = parseAnsi('\x1B[1m\x1B[32mbold green\x1B[0m');
    expect(segs).toHaveLength(1);
    expect(segs[0].bold).toBe(true);
    expect(segs[0].color).toBe('green');
    expect(segs[0].text).toBe('bold green');
  });
});
