'use client';

import { useRef, useEffect, useCallback, useState } from 'react';

interface TitleBarProps {
  title: string;
  children?: React.ReactNode;
}

export function TitleBar({ title, children }: TitleBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      ro.disconnect();
    };
  }, [checkScroll]);

  return (
    <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-gray-800 bg-gray-900/30 min-h-[31px]">
      <span className="text-[10px] text-gray-500 font-bold tracking-wider uppercase shrink-0 mr-2">
        {title}
      </span>
      {children && (
        <div className="flex items-center min-w-0 max-w-[70%] relative">
          {/* Left fade */}
          {canScrollLeft && (
            <div className="absolute left-0 top-0 bottom-0 w-3 bg-gradient-to-r from-gray-900/30 to-transparent pointer-events-none z-10" />
          )}
          <div
            ref={scrollRef}
            className="flex items-center gap-1 overflow-x-auto scrollbar-none overscroll-x-contain"
            onWheel={(e) => {
              // Horizontal scroll on wheel
              if (scrollRef.current) {
                scrollRef.current.scrollLeft += e.deltaY > 0 ? 24 : -24;
              }
            }}
          >
            {children}
          </div>
          {/* Right fade */}
          {canScrollRight && (
            <div className="absolute right-0 top-0 bottom-0 w-3 bg-gradient-to-l from-gray-900/30 to-transparent pointer-events-none z-10" />
          )}
        </div>
      )}
      <style>{`.scrollbar-none::-webkit-scrollbar { display: none; }
.scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }`}</style>
    </div>
  );
}
