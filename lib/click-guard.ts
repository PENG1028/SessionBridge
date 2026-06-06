// ─── Click Guard — prevent Click During Text Selection ──────────
// When the user selects text and releases the mouse, the click event
// can bubble to a parent handler that triggers setState / dispatch.
// This causes a React re-render that replaces the DOM node, which in
// turn clears the browser's text selection.
//
// Use isSelecting() in mouseup/touchend handlers to detect this state
// and skip the action, giving the selection priority over the click.

'use client';

/**
 * Check if the user currently has a non-collapsed text selection.
 * Returns true when text is highlighted on screen.
 */
export function isSelecting(): boolean {
  if (typeof window === 'undefined') return false;
  const sel = window.getSelection();
  return sel !== null && !sel.isCollapsed;
}

/**
 * Wrap a click/tap handler to skip execution while text is selected.
 *
 * @example
 * <div onClick={guardClick(handleClick)}>...</div>
 */
export function guardClick(handler: () => void) {
  return (e: React.MouseEvent | React.TouchEvent) => {
    if (isSelecting()) return;
    handler();
  };
}
