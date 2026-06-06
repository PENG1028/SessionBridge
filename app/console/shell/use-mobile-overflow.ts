'use client';

// ─── useOverflow<T> — responsive overflow detection ──────────────
// Splits items into visible/overflowed based on available container
// width. Items are sorted by priority (descending). When they don't
// all fit, the lowest-priority items spill into an overflow list.
//
// Usage:
//   const containerRef = useRef(null);
//   const { visible, overflowed } = useOverflow(containerRef, items);
//   // items: { id, priority, estimatedWidth }[]
//   // default "more" button reserves 28px

import { useState, useMemo, useEffect } from 'react';

export interface OverflowItem {
  id: string;
  priority: number;
  /** Estimated width in px for this item. ~28–32 for icon-only, larger if text. */
  estimatedWidth: number;
}

export interface OverflowResult<T> {
  visible: T[];
  overflowed: T[];
}

/**
 * Distributes items between visible and overflow based on the measured
 * width of the container ref. Item.priority descending determines which
 * stay visible when space runs out. A fixed 28px is reserved for the
 * "more" overflow button when not all items fit.
 */
export function useOverflow<T extends OverflowItem>(
  containerRef: React.RefObject<HTMLElement | null>,
  items: T[],
  moreBtnWidth: number = 28,
): OverflowResult<T> {
  const [containerWidth, setContainerWidth] = useState(0);

  // ── Measure container via ResizeObserver ──────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setContainerWidth(el.clientWidth);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  // ── Calculate visible vs overflow ─────────────────────────────
  return useMemo(() => {
    if (!items.length || containerWidth === 0) {
      return { visible: items, overflowed: [] };
    }

    // Sort by priority descending (highest first)
    const sorted = [...items].sort((a, b) => b.priority - a.priority);

    // Check if everything fits without overflow
    const total = sorted.reduce((s, i) => s + i.estimatedWidth, 0);
    if (total <= containerWidth) {
      return { visible: sorted, overflowed: [] };
    }

    // Reserve space for the "more" button, then fit items
    const available = containerWidth - moreBtnWidth;
    const visible: T[] = [];
    let used = 0;

    for (const item of sorted) {
      if (used + item.estimatedWidth <= available) {
        visible.push(item);
        used += item.estimatedWidth;
      } else {
        break; // rest go to overflow
      }
    }

    const overflowed = sorted.filter((item) => !visible.includes(item));
    return { visible, overflowed };
  }, [items, containerWidth, moreBtnWidth]);
}
