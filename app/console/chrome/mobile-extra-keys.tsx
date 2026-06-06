'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useKeyboard } from '../../../lib/use-keyboard';

interface MobileExtraKeysProps {
  enabled: boolean;
  onSend: (data: string) => void;
}

type KeyDef =
  | { id: string; label: string; send: string }
  | { id: string; label: string; toggle: true; toggleKey: 'ctrl' | 'alt' };

const ROW1: KeyDef[] = [
  { id: 'tab', label: 'Tab', send: '\t' },
  { id: 'ctrl', label: 'Ctrl', toggle: true, toggleKey: 'ctrl' },
  { id: 'alt', label: 'Alt', toggle: true, toggleKey: 'alt' },
  { id: 'esc', label: 'Esc', send: '\x1b' },
  { id: 'slash', label: '/', send: '/' },
];

const ROW2: KeyDef[] = [
  { id: 'left', label: 'Left', send: '\x1b[D' },
  { id: 'down', label: 'Down', send: '\x1b[B' },
  { id: 'up', label: 'Up', send: '\x1b[A' },
  { id: 'right', label: 'Right', send: '\x1b[C' },
];

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

export function MobileExtraKeys({ enabled, onSend }: MobileExtraKeysProps) {
  const [touchDevice, setTouchDevice] = useState(false);
  const [ctrlOn, setCtrlOn] = useState(false);
  const [altOn, setAltOn] = useState(false);
  const ctrlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const altTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { keyboardHeight } = useKeyboard();

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

  const handleKey = useCallback((k: KeyDef) => {
    if ('toggle' in k && k.toggle) {
      if (k.toggleKey === 'ctrl') setCtrlOn(on => !on);
      if (k.toggleKey === 'alt') setAltOn(on => !on);
      return;
    }

    const key = k as Extract<KeyDef, { send: string }>;
    let data = key.send;
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

  const btnBase = 'flex items-center justify-center min-w-11 h-9 px-3 rounded text-xs font-mono border select-none active:scale-95 transition-colors touch-manipulation';
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
      <div className="flex items-center gap-2 justify-center">
        {ROW1.map(k => {
          const isOn = ('toggle' in k && k.toggle && k.toggleKey === 'ctrl' && ctrlOn)
            || ('toggle' in k && k.toggle && k.toggleKey === 'alt' && altOn);
          return (
            <button
              key={k.id}
              type="button"
              aria-pressed={isOn || undefined}
              onPointerDown={(e) => { e.preventDefault(); handleKey(k); }}
              className={`${btnBase} ${
                isOn
                  ? 'bg-blue-600/25 text-blue-300 border-blue-500/40'
                  : 'bg-gray-800/80 text-gray-300 border-gray-700'
              }`}
            >
              {k.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 justify-center">
        {ROW2.map(k => (
          <button
            key={k.id}
            type="button"
            onPointerDown={(e) => { e.preventDefault(); handleKey(k); }}
            className={`${btnBase} bg-gray-800/80 text-gray-300 border-gray-700`}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
