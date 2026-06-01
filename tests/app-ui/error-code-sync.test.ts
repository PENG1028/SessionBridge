// ─── Error Code Sync Test ──────────────────────────────────────────
// Verifies that every error code constant in Go Core's errors.go
// has a corresponding entry in the frontend's CODE_TO_CATEGORY table.
//
// Canonical source: go-core/pkg/protocol/errors.go
// Mirror: app/console/core/core-error.ts
//
// If this test fails after a Go Core change, update CODE_TO_CATEGORY
// in core-error.ts to include the new/missing error code.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Extract error code string constants from a Go source file.
 * Matches patterns like:
 *   ErrCodeFoo = "FOO"
 *   ErrCodeBar      = "BAR"
 */
function extractGoErrorCodes(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const codes: string[] = [];
  // Matches ErrCode<Name> = "<VALUE>" (with optional whitespace around =)
  const re = /ErrCode\w+\s*=\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    codes.push(match[1]);
  }
  return codes.sort();
}

/**
 * Extract CODE_TO_CATEGORY keys from the frontend core-error.ts.
 */
function extractCodeToCategoryKeys(filePath: string): string[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const codes: string[] = [];
  // Match keys inside CODE_TO_CATEGORY: 'KEY': 'category',
  const re = /'([A-Z][A-Z_0-9]+)'\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    // Only match entries inside the CODE_TO_CATEGORY block (between the
    // start marker and the closing brace)
    const lineStart = content.lastIndexOf('\n', match.index) + 1;
    const line = content.substring(lineStart, content.indexOf('\n', match.index));
    // Skip comment lines and the const declaration line
    if (line.trim().startsWith('//') || line.trim().startsWith('const ')) continue;
    codes.push(match[1]);
  }
  return codes.sort();
}

describe('error-code-sync: Go Core ↔ frontend error codes', () => {
  const errorsGoPath = path.resolve(process.cwd(), 'go-core/pkg/protocol/errors.go');
  const coreErrorPath = path.resolve(process.cwd(), 'app/console/core/core-error.ts');

  const goCodes = extractGoErrorCodes(errorsGoPath);
  const frontendCodes = extractCodeToCategoryKeys(coreErrorPath);

  it('Go Core error codes should exist in CODE_TO_CATEGORY', () => {
    const missing = goCodes.filter(code => !frontendCodes.includes(code));
    if (missing.length > 0) {
      console.error(
        `\n  ✗ ${missing.length} Go error code(s) missing from CODE_TO_CATEGORY:\n` +
        missing.map(c => `    - "${c}"`).join('\n') +
        '\n\n  → Add entries to app/console/core/core-error.ts:\n' +
        missing.map(c => `      '${c}': 'unknown',`).join('\n')
      );
    }
    expect(missing).toEqual([]);
  });

  it('CODE_TO_CATEGORY should not have stale entries (no longer in Go)', () => {
    const stale = frontendCodes.filter(code => !goCodes.includes(code));
    if (stale.length > 0) {
      console.error(
        `\n  ✗ ${stale.length} CODE_TO_CATEGORY key(s) no longer in errors.go:\n` +
        stale.map(c => `    - "${c}"`).join('\n') +
        '\n\n  → Remove them from CODE_TO_CATEGORY in app/console/core/core-error.ts'
      );
    }
    expect(stale).toEqual([]);
  });

  it('should have the same count of error codes', () => {
    expect(goCodes.length).toBe(frontendCodes.length);
  });
});
