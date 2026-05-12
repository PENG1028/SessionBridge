'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface MobileExtraKeysProps {
  activeInstanceId: string | null;
  statusBarHidden?: boolean;
  /** Reuses the main app's WebSocket connection instead of creating a new one. */
  sendShellInput?: (data: string, instanceId: string) => void;
}

type KeyDef =
  | { id: string; label: string; send: string; wide?: boolean }
  | { id: string; label: string; toggle: true; toggleKey: 'ctrl' | 'alt' };

const ROW1: KeyDef[] = [
  { id: 'tab', label: 'Tab', send: '\t' },
  { id: 'ctrl', label: 'Ctrl', toggle: true, toggleKey: 'ctrl' },
  { id: 'alt', label: 'Alt', toggle: true, toggleKey: 'alt' },
  { id: 'esc', label: 'Esc', send: '\x1b' },
  { id: 'slash', label: '/', send: '/' },
];

const ROW2: KeyDef[] = [
  { id: 'left', label: '←', send: '\x1b[D' },
  { id: 'down', label: '↓', send: '\x1b[B' },
  { id: 'up', label: '↑', send: '\x1b[A' },
  { id: 'right', label: '→', send: '\x1b[C' },
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

export function MobileExtraKeys({ activeInstanceId, statusBarHidden, sendShellInput }: MobileExtraKeysProps) {
  const [shown, setShown] = useState(false);
  const [ctrlOn, setCtrlOn] = useState(false);
  const [altOn, setAltOn] = useState(false);
  const [kbOffset, setKbOffset] = useState(0);
  const ctrlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const altTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Touchscreen detection
  useEffect(() => {
    setShown(isTouchDevice());
  }, []);

  // visualViewport tracking for iOS keyboard
  useEffect(() => {
    const vp = window.visualViewport;
    if (!vp) return;

    const sync = () => {
      setKbOffset(Math.max(0, window.innerHeight - vp.height));
    };

    sync();
    vp.addEventListener('resize', sync);
    vp.addEventListener('scroll', sync);
    return () => {
      vp.removeEventListener('resize', sync);
      vp.removeEventListener('scroll', sync);
    };
  }, []);

  // Auto-release toggles after 5s
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

  const send = useCallback((data: string) => {
    if (!activeInstanceId || !sendShellInput) return;
    sendShellInput(data, activeInstanceId);
  }, [activeInstanceId, sendShellInput]);

  const handleKey = useCallback((k: KeyDef) => {
    if ('toggle' in k && k.toggle) {
      if (k.toggleKey === 'ctrl') setCtrlOn(on => !on);
      if (k.toggleKey === 'alt') setAltOn(on => !on);
      return;
    }

    const key = k as KeyDef & { send: string };
    let data = key.send;

    if (ctrlOn && data.length === 1) {
      data = ctrlSeq(data);
      setCtrlOn(false);
    }

    if (altOn) {
      data = '\x1b' + data;
      setAltOn(false);
    }

    send(data);
  }, [ctrlOn, altOn, send]);

  if (!shown) return null;

  const btnBase = 'flex items-center justify-center min-w-[2.5rem] h-8 px-2.5 rounded text-xs font-mono border select-none active:scale-95 transition-colors';

  return (
    <div
      className="md:hidden flex flex-col gap-0.5 px-1.5 py-1 bg-[#0d0d0d]/98 border-t border-gray-800 z-40"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: kbOffset > 0 ? `${kbOffset}px` : statusBarHidden ? '0px' : '28px',
      }}
    >
      {/* Row 1: Tab Ctrl Alt Esc / */}
      <div className="flex items-center gap-1.5 justify-center">
        {ROW1.map(k => {
          const isOn = ('toggle' in k && k.toggle && k.toggleKey === 'ctrl' && ctrlOn)
            || ('toggle' in k && k.toggle && k.toggleKey === 'alt' && altOn);
          return (
            <button
              key={k.id}
              onTouchStart={(e) => { e.preventDefault(); handleKey(k); }}
              onMouseDown={(e) => { e.preventDefault(); handleKey(k); }}
              className={`${btnBase} ${
                isOn
                  ? 'bg-blue-600/25 text-blue-300 border-blue-500/40'
                  : 'bg-gray-800/80 text-gray-300 border-gray-700 hover:bg-gray-700/80'
              }`}
            >
              {k.label}
            </button>
          );
        })}
      </div>

      {/* Row 2: Arrow keys */}
      <div className="flex items-center gap-1.5 justify-center">
        {ROW2.map(k => (
          <button
            key={k.id}
            onTouchStart={(e) => { e.preventDefault(); handleKey(k); }}
            onMouseDown={(e) => { e.preventDefault(); handleKey(k); }}
            className={`${btnBase} bg-gray-800/80 text-gray-300 border-gray-700 hover:bg-gray-700/80`}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
