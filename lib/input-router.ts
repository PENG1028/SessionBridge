'use client';

// ─── Input Router — global input target + Ctrl modifier state ──
// The toolbar (MobileKeyboardSlot) is rendered at ConsoleLayout level,
// but the actual input handling lives in the active view (e.g. Terminal).
// This router decouples them.
//
// Also exposes a global Ctrl modifier state: when the toolbar's Ctrl
// toggle is active, physical keyboard input (via xterm.js onData) is
// intercepted and converted to Ctrl+letter sequences. The user presses
// Ctrl on the toolbar, then types "c" on their phone keyboard → Ctrl+C.

let _inputHandler: ((data: string) => void) | null = null;
let _ctrlActive = false;

/** Register the active input handler. Call with null on unmount. */
export function setInputHandler(fn: ((data: string) => void) | null): void {
  _inputHandler = fn;
}

/** Route a keystroke from the toolbar to the active input handler. */
export function routeInput(data: string): void {
  _inputHandler?.(data);
}

/** Set the global Ctrl modifier state (toggled by toolbar button). */
export function setCtrlActive(active: boolean): void {
  _ctrlActive = active;
}

/** Check if Ctrl modifier is currently active. */
export function isCtrlActive(): boolean {
  return _ctrlActive;
}

/** Convert a lowercase letter to its Ctrl equivalent (a→\x01, etc.). */
export function ctrlSeq(key: string): string {
  const c = key.charCodeAt(0);
  if (c >= 0x40 && c <= 0x5f) return String.fromCharCode(c - 0x40);
  if (c >= 0x61 && c <= 0x7a) return String.fromCharCode(c - 0x60);
  return key;
}
