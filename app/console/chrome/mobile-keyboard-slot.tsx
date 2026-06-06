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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useKeyboard } from '../../../lib/use-keyboard';
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
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

export function MobileKeyboardSlot({ enabled, onSend }: MobileKeyboardSlotProps) {
  const [touchDevice, setTouchDevice] = useState(false);
  const [ctrlOn, setCtrlOn] = useState(false);
  const [altOn, setAltOn] = useState(false);
  const ctrlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const altTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { keyboardHeight } = useKeyboard();

  // Read contributed items from registry
  const items = getMobileKeyboardContributions();

  // Group by row for rendering
  const rows = items.reduce<Record<number, typeof items>>((acc, item) => {
    const r = item.row ?? 0;
    if (!acc[r]) acc[r] = [];
    acc[r].push(item);
    return acc;
  }, {});
  const rowKeys = Object.keys(rows).map(Number).sort((a, b) => a - b);

  useEffect(() => {
    setTouchDevice(isTouchDevice());
  }, []);

  useEffect(() => {
    if (!enabled) {
      setCtrlOn(false);
      setAltOn(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (ctrlOn) {
      if (ctrlTimerRef.current) clearTimeout(ctrlTimerRef.current);
      ctrlTimerRef.current = setTimeout(() => setCtrlOn(false), 5000);
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
      setCtrlOn(on => !on);
      return;
    }
    if (item.toggle && item.toggleKey === 'alt') {
      setAltOn(on => !on);
      return;
    }

    let data = item.send ?? '';
    if (ctrlOn && data.length === 1) {
      data = ctrlSeq(data);
      setCtrlOn(false);
    }
    if (altOn) {
      data = '\x1b' + data;
      setAltOn(false);
    }
    onSend(data);
  }, [altOn, ctrlOn, onSend]);

  if (!touchDevice || !enabled) return null;

  const bottom = Math.max(0, keyboardHeight);

  return (
    <div
      className="md:hidden flex flex-col gap-1 px-2 py-1.5 bg-[#0d0d0d]/98 border-t border-gray-800 z-40 shadow-[0_-8px_24px_rgba(0,0,0,0.35)]"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: `${bottom}px`,
        transition: 'bottom 200ms cubic-bezier(0.22, 1, 0.36, 1)',
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
                {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
