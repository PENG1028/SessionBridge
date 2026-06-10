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
// timer. When a toggle is active and a character is typed (toolbar button
// OR system keyboard), consumeMobileModifiers() composes the character
// (Ctrl+X → ASCII control char, Alt+X → ESC+X) and clears the toggle.
// Both input paths are unified through this single composition point.

'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useKeyboard } from '../../../lib/use-keyboard';
import { getSnapshotMobileKeyboardItems, subscribeMobileKeyboardItems } from './mobile-keyboard-registry';

// ── Module-level modifier state ──────────────────────────────────
// Singleton like useKeyboard — one set of modifiers, consumable from
// any input path (toolbar button or system keyboard).
let _ctrlOn = false;
let _altOn = false;
let _ctrlTimer: ReturnType<typeof setTimeout> | null = null;
let _altTimer: ReturnType<typeof setTimeout> | null = null;
const _modSubs = new Set<() => void>();

function notifyMods() { for (const cb of _modSubs) cb(); }

function clearCtrlTimer() {
  if (_ctrlTimer) { clearTimeout(_ctrlTimer); _ctrlTimer = null; }
}
function clearAltTimer() {
  if (_altTimer) { clearTimeout(_altTimer); _altTimer = null; }
}

export function setCtrlOn(v: boolean) {
  _ctrlOn = v;
  clearCtrlTimer();
  if (v) _ctrlTimer = setTimeout(() => { _ctrlOn = false; notifyMods(); }, 5000);
  notifyMods();
}
export function setAltOn(v: boolean) {
  _altOn = v;
  clearAltTimer();
  if (v) _altTimer = setTimeout(() => { _altOn = false; notifyMods(); }, 5000);
  notifyMods();
}

function ctrlSeq(key: string): string {
  const c = key.charCodeAt(0);
  if (c >= 0x40 && c <= 0x5f) return String.fromCharCode(c - 0x40);
  if (c >= 0x61 && c <= 0x7a) return String.fromCharCode(c - 0x60);
  return key;
}

/** Compose modifiers into the next input character, then clear modifiers.
 *  Call this at the single entry point where all input passes through
 *  (both toolbar buttons and system keyboard). */
export function consumeMobileModifiers(data: string): string {
  if (_ctrlOn && data.length === 1) {
    data = ctrlSeq(data);
    clearCtrlTimer();
    _ctrlOn = false;
  }
  if (_altOn) {
    data = '\x1b' + data;
    clearAltTimer();
    _altOn = false;
  }
  notifyMods();
  return data;
}

interface MobileKeyboardSlotProps {
  enabled: boolean;
  onSend: (data: string) => void;
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
  const [ctrlOn, _setCtrlOn] = useState(_ctrlOn);
  const [altOn, _setAltOn] = useState(_altOn);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const { keyboardHeight, isVisible: keyboardVisible } = useKeyboard();

  // Subscribe to module-level modifier changes
  useEffect(() => {
    const cb = () => { _setCtrlOn(_ctrlOn); _setAltOn(_altOn); };
    _modSubs.add(cb);
    return () => { _modSubs.delete(cb); };
  }, []);

  // Ensure touchDevice is set before the first paint. useEffect fires
  // after paint, which is too late — the toolbar DOM must exist before
  // keyboard detection fires. useLayoutEffect fires synchronously after
  // DOM mutations but before the browser paints.
  useLayoutEffect(() => {
    if (!touchDevice && isTouchDevice()) {
      setTouchDevice(true);
    }
  }, [touchDevice]);

  // Toolbar visibility: driven by terminal focus on touch devices.
  // The tap that opens the keyboard is the same action that should
  // show the toolbar. Passive visualViewport detection (keyboardVisible)
  // is only an auxiliary signal for positioning/margins.
  const visible = enabled && touchDevice;

  // Toolbar positioning
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el || !visible) return;

    const reposition = () => {
      const vp = window.visualViewport;
      if (!vp) return;
      const th = el.offsetHeight || 90;
      el.style.top = `${vp.offsetTop + vp.height - th}px`;
      el.style.left = '0';
      el.style.right = '0';
    };

    reposition();

    window.visualViewport?.addEventListener('scroll', reposition, { passive: true });
    window.visualViewport?.addEventListener('resize', reposition, { passive: true });
    window.addEventListener('scroll', reposition, { passive: true });

    return () => {
      window.visualViewport?.removeEventListener('scroll', reposition);
      window.visualViewport?.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition);
    };
  }, [visible, keyboardVisible]);

  // Reactive subscription — recomputes when plugins sync (async).
  // useMemo([], []) would cache the empty initial array forever.
  const items = useSyncExternalStore(subscribeMobileKeyboardItems, getSnapshotMobileKeyboardItems);

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

  // Clear modifiers when terminal loses focus
  useEffect(() => {
    if (!enabled) {
      setCtrlOn(false);
      setAltOn(false);
    }
  }, [enabled]);

  const handleKey = useCallback((item: typeof items[number]) => {
    if (item.toggle && item.toggleKey === 'ctrl') {
      setCtrlOn(!_ctrlOn);
      return;
    }
    if (item.toggle && item.toggleKey === 'alt') {
      setAltOn(!_altOn);
      return;
    }

    // Modifier composition is done by consumeMobileModifiers() in
    // handleUserInput — the single entry point for both toolbar
    // buttons and system keyboard.
    onSend(item.send ?? '');
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
      className="md:hidden flex flex-col gap-1 px-2 py-1.5 bg-[#0d0d0d] border-t border-gray-800 z-40 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]"
      data-mobile-keyboard-toolbar
      style={{
        position: 'fixed',
        display: visible ? 'flex' : 'none',
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
