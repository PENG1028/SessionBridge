'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { X, GripHorizontal, Minus } from 'lucide-react';

export interface FloatingWindowProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  movable?: boolean;
  resizable?: boolean;
  persistent?: boolean;
  modal?: boolean;
  defaultPos?: { x: number; y: number };
  defaultSize?: { w: number; h: number };
  minSize?: { w: number; h: number };
  actions?: React.ReactNode;
}

function calcCenter(w: number, h: number) {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  return {
    x: Math.max(0, (window.innerWidth - w) / 2),
    y: Math.max(0, (window.innerHeight - h) / 3),
  };
}

export function FloatingWindow({
  title, open, onClose, children,
  movable = true, resizable = false, persistent = true, modal = false,
  defaultPos, defaultSize,
  minSize = { w: 240, h: 180 },
  actions,
}: FloatingWindowProps) {
  const initW = defaultSize?.w ?? 480;
  const initH = defaultSize?.h ?? 360;
  const [pos, setPos] = useState(() => defaultPos ?? calcCenter(initW, initH));
  const [size, setSize] = useState(defaultSize ?? { w: initW, h: initH });
  const dragRef = useRef(false);
  const resizeRef = useRef(false);
  const startMouseRef = useRef({ x: 0, y: 0 });
  const startPosRef = useRef({ x: 0, y: 0 });
  const startSizeRef = useRef({ w: 0, h: 0 });
  const commitPosRef = useRef(pos);
  const commitSizeRef = useRef(size);
  const rafRef = useRef<number | null>(null);

  // Keep refs in sync for drag/resize
  commitPosRef.current = pos;
  commitSizeRef.current = size;

  const scheduleSetPos = useCallback((p: { x: number; y: number }) => {
    commitPosRef.current = p;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setPos(commitPosRef.current);
      });
    }
  }, []);

  const scheduleSetSize = useCallback((s: { w: number; h: number }) => {
    commitSizeRef.current = s;
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setSize(commitSizeRef.current);
      });
    }
  }, []);

  // ── Drag ──
  const onDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!movable) return;
    e.preventDefault();
    dragRef.current = true;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    startMouseRef.current = { x: clientX, y: clientY };
    startPosRef.current = { ...commitPosRef.current };
  }, [movable]);

  // ── Resize ──
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    if (!resizable) return;
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = true;
    startMouseRef.current = { x: e.clientX, y: e.clientY };
    startSizeRef.current = { ...commitSizeRef.current };
  }, [resizable]);

  // ── Global events ──
  useEffect(() => {
    if (!open) return;

    const onMove = (clientX: number, clientY: number) => {
      if (dragRef.current) {
        scheduleSetPos({
          x: startPosRef.current.x + clientX - startMouseRef.current.x,
          y: startPosRef.current.y + clientY - startMouseRef.current.y,
        });
      }
      if (resizeRef.current) {
        const dw = clientX - startMouseRef.current.x;
        const dh = clientY - startMouseRef.current.y;
        scheduleSetSize({
          w: Math.max(minSize.w, startSizeRef.current.w + dw),
          h: Math.max(minSize.h, startSizeRef.current.h + dh),
        });
      }
    };

    const onMouseMove = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) onMove(e.touches[0].clientX, e.touches[0].clientY);
    };
    const onUp = () => {
      dragRef.current = false;
      resizeRef.current = false;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onUp);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [open, minSize, scheduleSetPos, scheduleSetSize]);

  if (!open) return null;

  return (
    <>
      {modal && (
        <div
          className="fixed inset-0 bg-black/40 z-40"
          onClick={() => { if (!persistent) onClose(); }}
        />
      )}

      <div
        className="fixed z-50 bg-[#0d0d0d] border border-gray-700 rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={{
          left: pos.x,
          top: pos.y,
          width: size.w,
          height: size.h,
        }}
      >
        {/* Title bar — drag via mouse or touch */}
        <div
          className={`flex items-center justify-between h-8 px-3 bg-gray-900 border-b border-gray-700 shrink-0 select-none ${movable ? 'cursor-grab active:cursor-grabbing' : ''}`}
          onMouseDown={onDragStart}
          onTouchStart={onDragStart}
        >
          <div className="flex items-center gap-2 min-w-0">
            {movable && <GripHorizontal className="w-3 h-3 text-gray-600 shrink-0" />}
            <span className="text-[10px] font-bold text-gray-400 tracking-wider uppercase truncate">{title}</span>
          </div>
          <div className="flex items-center gap-1">
            {actions}
            {!persistent && (
              <button onMouseDown={(e) => e.stopPropagation()} onClick={onClose} className="p-0.5 text-gray-600 hover:text-gray-300">
                <Minus className="w-3 h-3" />
              </button>
            )}
            <button onMouseDown={(e) => e.stopPropagation()} onClick={onClose} className="p-0.5 text-gray-600 hover:text-red-400">
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col min-h-0">
          {children}
        </div>

        {/* Resize handle */}
        {resizable && (
          <div
            className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize touch-none"
            onMouseDown={onResizeStart}
          >
            <svg viewBox="0 0 16 16" className="w-full h-full text-gray-700">
              <line x1="12" y1="16" x2="16" y2="12" stroke="currentColor" strokeWidth="1.5" />
              <line x1="8" y1="16" x2="16" y2="8" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </div>
        )}
      </div>
    </>
  );
}
