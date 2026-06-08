'use client';

// ─── Input Router — global input target for mobile keyboard toolbar ──
// The toolbar (MobileKeyboardSlot) is rendered at ConsoleLayout level,
// but the actual input handling lives in the active view (e.g. Terminal).
// This router decouples them: the view registers its handler, the toolbar
// calls it when a key is pressed.

let _inputHandler: ((data: string) => void) | null = null;

/** Register the active input handler. Call with null on unmount. */
export function setInputHandler(fn: ((data: string) => void) | null): void {
  _inputHandler = fn;
}

/** Route a keystroke from the toolbar to the active input handler. */
export function routeInput(data: string): void {
  _inputHandler?.(data);
}
