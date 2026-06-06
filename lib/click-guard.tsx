// ─── Click Guard — prevent Click During Text Selection ──────────
// When the user selects text and releases the mouse, the click event
// can bubble to a parent handler that triggers setState / dispatch.
// This causes a React re-render that replaces the DOM node, which in
// turn clears the browser's text selection.
//
// Use isSelecting() in mouseup/touchend handlers to detect this state
// and skip the action, giving the selection priority over the click.

'use client';

import { useRef, type ReactNode } from 'react';

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

// ─── SelectionSafeContainer ─────────────────────────────────────
// Wraps children and prevents DOM updates while the user has an
// active text selection. During selection it returns the last known
// rendered content from a ref, so React bails out and the DOM stays
// unchanged — preserving the selection.
//
// This is the root fix for "selection disappears on re-render":
// streaming data or parent state changes that cascade down will
// NOT replace DOM nodes while text is highlighted.

export function SelectionSafeContainer({ children }: { children: ReactNode }) {
  const cacheRef = useRef<ReactNode>(null);

  // During render: save latest content when NOT selecting
  if (!isSelecting()) {
    cacheRef.current = children;
  }

  // During selection: return frozen content so React skips DOM update
  return <>{isSelecting() && cacheRef.current !== null ? cacheRef.current : children}</>;
}
