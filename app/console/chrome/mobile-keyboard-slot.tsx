// ─── MobileKeyboardSlot — Slot renderer for mobile keyboard toolbar ──
//
// Renders contributed keyboard buttons from all plugins, grouped by
// row, sorted by order within each row.
//
// Plugins declare buttons via plugin.yaml → mobileKeyboard[].
// The slot host (ShellTerminal) passes:
//   enabled  — whether the slot is active (e.g. terminal focused)
//   onSend   — sends characters to the active input
//
// Toggle keys (Ctrl/Alt) use sticky-on semantics with a 5s auto-reset
// timer. When a toggle is active and a regular key is pressed, the
// character is composed (Ctrl+X → ASCII control char, Alt+X → ESC+X).

'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useKeyboard } from '../../../lib/use-keyboard';
import { setCtrlActive } from '../../../lib/input-router';
import { getMobileKeyboardContributions } from './mobile-keyboard-registry';

interface MobileKeyboardSlotProps {
  enabled: boolean;
  onSend: (data: string) => void;
}

function ctrlSeq(key: string): string {
  const c = key.charCodeAt(0);
  if (c >= 0x40 && c <= 0x5f) return String.fromCharCode(c - 0x40);
  if (c >= 0x61 && c <= 0x7a) return String.fromCharCode(c - 0x60);
  return key;
}

function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window || window.matchMedia('(pointer: coarse)').matches;
}

export function MobileKeyboardSlot({ enabled, onSend }: MobileKeyboardSlotProps) {
  // Use lazy initializer (runs once) + useLayoutEffect (fires before paint)
  // to minimize the window where the toolbar DOM doesn't exist yet.
  // This is critical: if the toolbar div isn't in the DOM when keyboardHeight
  // first becomes > 0, the positioning effect won't be able to access
  // toolbarRef.current and the toolbar will stay hidden permanently.
  const [touchDevice, setTouchDevice] = useState(() => {
    if (typeof window === 'undefined') return false;
    return isTouchDevice();
  });
  const [ctrlOn, setCtrlOn] = useState(false);
  const [altOn, setAltOn] = useState(false);
  const ctrlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const altTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const keyboardHeightRef = useRef(0);
  const ctrlOnRef = useRef(false);
  const altOnRef = useRef(false);

  const { keyboardHeight } = useKeyboard();

  // Ensure touchDevice is set before the first paint. useEffect fires
  // after paint, which is too late — the toolbar DOM must exist before
  // keyboard detection fires. useLayoutEffect fires synchronously after
  // DOM mutations but before the browser paints.
  useLayoutEffect(() => {
    if (!touchDevice && isTouchDevice()) {
      setTouchDevice(true);
    }
  }, [touchDevice]);

  // Sync keyboardHeight to both the ref (for direct DOM updates)
  // and trigger re-render (for visibility toggle).
  keyboardHeightRef.current = keyboardHeight;
  ctrlOnRef.current = ctrlOn;
  altOnRef.current = altOn;

  // Direct DOM update for toolbar position — bypasses React render cycle.
  // Uses `top` (not `bottom`) because iOS Safari's position:fixed with
  // `bottom` doesn't track visualViewport changes when the keyboard opens.
  // Formula: position toolbar just above the keyboard, at the bottom of
  // the visual viewport.
  // Listens to BOTH keyboardHeight changes AND scroll events, because
  // after input the terminal auto-scrolls to bottom, which may shift the
  // visual viewport without changing keyboard height.
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;

    const reposition = () => {
      const h = keyboardHeightRef.current;
      if (h > 0) {
        el.style.display = 'flex';
        const vp = window.visualViewport;
        if (vp) {
          const th = el.offsetHeight || 90;
          el.style.top = `${vp.offsetTop + vp.height - th}px`;
          el.style.left = '0';
          el.style.right = '0';
        }
      } else {
        el.style.display = 'none';
        el.style.top = '';
        el.style.left = '';
        el.style.right = '';
      }
    };

    reposition();

    // Reposition on any viewport change, not just height changes
    window.visualViewport?.addEventListener('scroll', reposition, { passive: true });
    window.visualViewport?.addEventListener('resize', reposition, { passive: true });
    window.addEventListener('scroll', reposition, { passive: true });

    return () => {
      window.visualViewport?.removeEventListener('scroll', reposition);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition);
    };
  }, [keyboardHeight]);

  // Read contributed items from registry
  const items = useMemo(() => getMobileKeyboardContributions(), []);

  // Group by row for rendering
  const rows = useMemo(() => {
    const acc: Record<number, typeof items> = {};
    for (const item of items) {
      const r = item.row ?? 0;
      if (!acc[r]) acc[r] = [];
      acc[r].push(item);
    }
    return acc;
  }, [items]);
  const rowKeys = useMemo(() => Object.keys(rows).map(Number).sort((a, b) => a - b), [rows]);

  useEffect(() => {
    if (!enabled) {
      setCtrlOn(false);
      setAltOn(false);
      setCtrlActive(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (ctrlOn) {
      if (ctrlTimerRef.current) clearTimeout(ctrlTimerRef.current);
      ctrlTimerRef.current = setTimeout(() => { setCtrlOn(false); setCtrlActive(false); }, 5000);
    }
    return () => {
      if (ctrlTimerRef.current) clearTimeout(ctrlTimerRef.current);
    };
  }, [ctrlOn]);

  useEffect(() => {
    if (altOn) {
      if (altTimerRef.current) clearTimeout(altTimerRef.current);
      altTimerRef.current = setTimeout(() => setAltOn(false), 5000);
    }
    return () => {
      if (altTimerRef.current) clearTimeout(altTimerRef.current);
    };
  }, [altOn]);

  const handleKey = useCallback((item: typeof items[number]) => {
    if (item.toggle && item.toggleKey === 'ctrl') {
      setCtrlOn(on => {
        const next = !on;
        setCtrlActive(next);
        return next;
      });
      return;
    }
    if (item.toggle && item.toggleKey === 'alt') {
      setAltOn(on => !on);
      return;
    }

    // Use refs for immediate modifier state (avoids stale closure issue
    // when Ctrl is toggled and a letter key is pressed in the same frame)
    let data = item.send ?? '';
    if (ctrlOnRef.current && data.length === 1) {
      data = ctrlSeq(data);
      setCtrlOn(false);
      setCtrlActive(false);
    }
    if (altOnRef.current) {
      data = '\x1b' + data;
      setAltOn(false);
    }
    onSend(data);
  }, [onSend]);

  // Always render the outer div so toolbarRef is attached even before
  // touchDevice is confirmed. On non-touch devices, the inner buttons
  // are never rendered, and the div stays display:none permanently.
  // This eliminates the race condition where keyboardHeight fires before
  // touchDevice state updates, causing the toolbar to stay hidden.
  if (!touchDevice && typeof window !== 'undefined') {
    // After hydration, we can determine touch device status immediately.
    // Return the bare container so the ref is in the DOM.
    return (
      <div
        ref={toolbarRef}
        className="md:hidden"
        style={{ position: 'fixed', display: 'none' }}
      />
    );
  }

  // During SSR or before hydration, render nothing (or the bare container).
  // On touch devices, render the full toolbar.
  // On non-touch post-hydration, the early return above catches it.
  if (!touchDevice) {
    // SSR path: render bare container so ref is available after hydration
    return (
      <div
        ref={toolbarRef}
        className="md:hidden"
        style={{ position: 'fixed', display: 'none' }}
      />
    );
  }

  return (
    <div
      ref={toolbarRef}
      className="md:hidden flex flex-col gap-1 px-2 py-1.5 bg-[#0d0d0d]/98 border-t border-gray-800 z-40 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]"
      data-mobile-keyboard-toolbar
      style={{
        position: 'fixed',
        display: 'none',
        paddingBottom: 'calc(0.375rem + env(safe-area-inset-bottom))',
      }}
      onPointerDown={(e) => e.preventDefault()}
      onTouchStart={(e) => e.preventDefault()}
    >
      {rowKeys.map(rowNum => (
        <div key={rowNum} className="flex items-center gap-2 justify-center">
          {rows[rowNum].map(item => {
            const isOn = (item.toggle && item.toggleKey === 'ctrl' && ctrlOn)
              || (item.toggle && item.toggleKey === 'alt' && altOn);
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={isOn || undefined}
                onPointerDown={(e) => { e.preventDefault(); handleKey(item); }}
                className={`flex items-center justify-center min-w-11 h-9 px-3 rounded text-xs font-mono border select-none active:scale-95 transition-colors touch-manipulation ${
                  isOn
                    ? 'bg-blue-600/25 text-blue-300 border-blue-500/40'
                    : 'bg-gray-800/80 text-gray-300 border-gray-700'
                }`}
              >
                {(ctrlOn && item.id !== 'ctrl' && item.send?.length === 1)
                  ? `^${item.label.toUpperCase()}`
                  : (altOn && item.id !== 'alt')
                  ? `M-${item.label}`
                  : item.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
