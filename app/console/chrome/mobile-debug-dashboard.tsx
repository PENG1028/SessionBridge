'use client';

// ─── Mobile Debug Dashboard ───────────────────────────────────────
//
// Self-contained. Mount <MobileDebug /> once at the app root.
// Triple-tap the header title to toggle. Persists to sessionStorage.
// Panel sits at TOP of visual viewport, pointer-events:none — never blocks interaction.
//
// xterm v6 diagnostic notes:
//   - v6 uses a CUSTOM scrollbar (not native!) — our CSS `::-webkit-scrollbar` won't affect it
//   - v6 has internal gesture handling (Touch/Gesture) that calls preventDefault() on touchmove
//   - v6 may use Canvas renderer or DOM renderer depending on browser support
//   - No .xterm-scroll-area in v6 — scrollHeight from rendered content

import { useEffect, useRef, useState } from 'react';

function isTouch(): boolean {
  if (typeof window === 'undefined') return false;
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

interface Snap {
  // Viewport
  vpCount: number;
  vpTag: string;        // tagName of found scrollable element
  vpCls: string;        // className of found scrollable element
  vpOvY: string;
  scrTop: number; scrMax: number; scrSH: number; scrCH: number;
  scrBottom: boolean;
  // xterm API
  xBaseY: number;       // terminal buffer baseY (total scroll pos)
  xViewY: number;       // terminal viewportY
  xBufLen: number;      // buffer length
  // Canvas/DOM renderer
  cvCount: number;      // how many canvas elements found
  domRows: number;      // if DOM renderer: .xterm-rows children count
  // Keyboard + VisualViewport
  kbH: number; vpH: number; vpOffsetTop: number; innerH: number; screenH: number;
  // Toolbar
  barDom: boolean; barDisp: string; barTop: string;
  // CSS
  taXterm: string; taVp: string; taCv: string;
  // Touch
  tStart: number; tMove: number; tEnd: number; tScroll: number;
}

const INIT: Snap = {
  vpCount: 0, vpTag: '-', vpCls: '-', vpOvY: '-',
  scrTop: 0, scrMax: 0, scrSH: 0, scrCH: 0, scrBottom: true,
  xBaseY: 0, xViewY: 0, xBufLen: 0,
  cvCount: 0, domRows: 0,
  kbH: 0, vpH: 0, vpOffsetTop: 0, innerH: 0, screenH: 0,
  barDom: false, barDisp: '-', barTop: '-',
  taXterm: '-', taVp: '-', taCv: '-',
  tStart: 0, tMove: 0, tEnd: 0, tScroll: 0,
};

export function MobileDebug() {
  const [visible, setVisible] = useState(false);
  const [snap, setSnap] = useState<Snap>(INIT);
  const [panelTop, setPanelTop] = useState(0);
  const mountedRef = useRef(false);

  // ── Init ────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    mountedRef.current = true;
    if (new URL(window.location.href).searchParams.has('debug')) {
      setVisible(true); return;
    }
    try { if (sessionStorage.getItem('sb-debug') === '1') setVisible(true); } catch {}
  }, []);

  // ── Triple-tap toggle ───────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined' || !isTouch()) return;
    let taps = 0; let timer: ReturnType<typeof setTimeout> | null = null;
    const handler = (e: Event) => {
      const el = e.target as HTMLElement;
      const isTitle = el.closest('header') !== null &&
        (el.classList.contains('tracking-widest') ||
         el.closest('[class*="tracking-widest"]') !== null);
      if (!isTitle) return;
      taps++;
      if (taps >= 3) { taps = 0; if (timer) { clearTimeout(timer); timer = null; }
        setVisible(v => { const n = !v;
          try { sessionStorage.setItem('sb-debug', n ? '1' : '0'); } catch {}
          return n; });
        return; }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { taps = 0; timer = null; }, 600);
    };
    document.addEventListener('pointerdown', handler, { passive: true });
    return () => { document.removeEventListener('pointerdown', handler); if (timer) clearTimeout(timer); };
  }, []);

  // ── Panel follows visualViewport ────────────────────────────
  useEffect(() => {
    if (!visible) return;
    const update = () => {
      setPanelTop(window.visualViewport?.offsetTop ?? 0);
    };
    update();
    window.visualViewport?.addEventListener('scroll', update, { passive: true });
    window.visualViewport?.addEventListener('resize', update, { passive: true });
    return () => {
      window.visualViewport?.removeEventListener('scroll', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, [visible]);

  // ── Metrics polling ─────────────────────────────────────────
  useEffect(() => {
    if (!visible || typeof window === 'undefined') return;

    const c = { start: 0, move: 0, end: 0, scroll: 0 };
    let touchActive = false;
    let scrollByTouch = false;

    const onTS = () => { c.start++; touchActive = true; };
    const onTM = () => { c.move++; };
    const onTE = () => { c.end++; touchActive = false; if (scrollByTouch) { c.scroll++; scrollByTouch = false; } };
    document.addEventListener('touchstart', onTS, { capture: true, passive: true });
    document.addEventListener('touchmove', onTM, { capture: true, passive: true });
    document.addEventListener('touchend', onTE, { capture: true, passive: true });

    let rafId = 0;
    let lastScrollTop = 0;

    const poll = () => {
      const xtermEl = document.querySelector('.xterm') as HTMLElement | null;

      // ── Find the scrollable element inside .xterm ──
      // xterm v6: viewport and screen are SIBLINGS inside .xterm.
      // The viewport has overflow: scroll; xterm-screen is absolute positioned.
      let vp: HTMLElement | null = null;
      let vpCount = 0;
      let vpTag = '-', vpCls = '-';

      if (xtermEl) {
        const allChildren = xtermEl.querySelectorAll('*');
        for (const el of allChildren) {
          const style = getComputedStyle(el as HTMLElement);
          if (style.overflowY === 'scroll' || style.overflowY === 'auto') {
            vpCount++;
            if (!vp) {
              vp = el as HTMLElement;
              vpTag = vp.tagName.toLowerCase();
              vpCls = (vp.className && typeof vp.className === 'string')
                ? vp.className.replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ')
                : '(none)';
            }
          }
        }
      }

      // ── Canvas count ──
      let cvCount = 0;
      if (xtermEl) {
        cvCount = xtermEl.querySelectorAll('canvas').length;
      }

      // ── DOM renderer rows ──
      let domRows = 0;
      if (xtermEl) {
        const rowsEl = xtermEl.querySelector('.xterm-rows');
        if (rowsEl) domRows = rowsEl.children.length;
      }

      // ── xterm API via terminal object on the DOM ──
      // xterm stores itself: _core is accessible if we can find the Terminal instance.
      // Try to read buffer info from the DOM structure.
      let xBaseY = 0, xViewY = 0, xBufLen = 0;
      try {
        // Access xterm's internal buffer through the viewport element
        // xterm v6 stores __terminal on the element, or we can use the global
        const anyEl = xtermEl as any;
        if (anyEl?.__terminal) {
          const t = anyEl.__terminal;
          xBaseY = t.buffer?.active?.baseY ?? t._core?.bufferService?.buffer?.baseY ?? 0;
          xViewY = t.buffer?.active?.viewportY ?? t._core?.bufferService?.buffer?.viewportY ?? 0;
          xBufLen = t.buffer?.active?.length ?? t._core?.bufferService?.buffer?.lines?.length ?? 0;
        }
      } catch {
        // Internal access is best-effort
      }

      const scTop = vp?.scrollTop ?? 0;
      const scSH = vp?.scrollHeight ?? 0;
      const scCH = vp?.clientHeight ?? 0;
      const scMax = Math.max(0, scSH - scCH);

      // Detect xterm scrolling (programmatic scrollTop changes)
      if (Math.abs(scTop - lastScrollTop) > 1) {
        if (touchActive) { scrollByTouch = true; }
      }
      lastScrollTop = scTop;

      // Toolbar
      let barDom = false, barDisp = '-', barTop = '-';
      const allFixed = document.querySelectorAll('[style*="position: fixed"]');
      for (const el of allFixed) {
        const h = el as HTMLElement;
        if (h.style.position === 'fixed' && h.classList.contains('md\\:hidden') && h.querySelector('button')) {
          barDom = true; barDisp = h.style.display || getComputedStyle(h).display; barTop = h.style.top || '-'; break;
        }
      }

      // v6 keyboard height: screen.height - visualViewport.height minus baseline
      const raw = window.screen.height - (window.visualViewport?.height ?? window.innerHeight);
      // (using static baseline for this diagnostic, the hook handles dynamic)
      const kbH = Math.round(Math.max(0, raw - 50)); // rough estimate for debug display

      setSnap({
        tStart: c.start, tMove: c.move, tEnd: c.end, tScroll: c.scroll,
        vpCount, vpTag, vpCls,
        vpOvY: vp ? getComputedStyle(vp).overflowY : '-',
        scrTop: Math.round(scTop), scrMax: Math.round(scMax),
        scrSH: Math.round(scSH), scrCH: Math.round(scCH),
        scrBottom: scMax > 0 ? scTop >= scMax - 2 : true,
        xBaseY, xViewY, xBufLen,
        cvCount, domRows,
        kbH,
        vpH: Math.round(window.visualViewport?.height ?? 0),
        vpOffsetTop: Math.round(window.visualViewport?.offsetTop ?? 0),
        innerH: Math.round(window.innerHeight),
        screenH: Math.round(window.screen?.height ?? 0),
        barDom, barDisp, barTop,
        taXterm: xtermEl ? getComputedStyle(xtermEl).touchAction : '-',
        taVp: vp ? getComputedStyle(vp).touchAction : '-',
        taCv: cvCount > 0 && xtermEl
          ? getComputedStyle(xtermEl.querySelector('canvas')!).touchAction
          : '-',
      });

      rafId = requestAnimationFrame(poll);
    };
    rafId = requestAnimationFrame(poll);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('touchstart', onTS, { capture: true });
      document.removeEventListener('touchmove', onTM, { capture: true });
      document.removeEventListener('touchend', onTE, { capture: true });
    };
  }, [visible]);

  if (!visible || !mountedRef.current) return null;

  const L = ({ n, v, c }: { n: string; v: string | number; c?: string }) => (
    <span className="flex gap-0.5 items-baseline">
      <span className="text-[9px] text-gray-500">{n}</span>
      <span className={`text-[10px] font-bold ${c || 'text-gray-200'}`}>{v}</span>
    </span>
  );
  const S = () => <span className="text-gray-700 mx-0.5">│</span>;

  const scrColor = () => {
    if (snap.scrMax === 0) return 'text-yellow-400';
    if (snap.scrBottom) return 'text-green-400';
    return 'text-yellow-400';
  };

  return (
    <div
      className="fixed left-0 right-0 z-[9999] px-2 py-1.5 font-mono bg-black/70 backdrop-blur-sm border-b border-yellow-600/60 text-gray-300"
      style={{ top: panelTop, pointerEvents: 'none' }}
    >
      {/* Row 1: Viewport identity */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="text-[9px] text-yellow-500 font-bold w-8 shrink-0">VP</span>
        <L n="tag" v={snap.vpTag} c="text-blue-300" />
        <L n="cls" v={snap.vpCls || '(none)'} c="text-blue-300" />
        <L n="cnt" v={snap.vpCount} />
        <L n="ov" v={snap.vpOvY} c={snap.vpOvY === 'scroll' || snap.vpOvY === 'auto' ? 'text-green-400' : 'text-red-400'} />
        <S />
        <L n="sh" v={snap.scrSH} />
        <L n="ch" v={snap.scrCH} />
        <L n="scrl" v={`${snap.scrTop}/${snap.scrMax}`} c={scrColor()} />
        <L n="@end" v={snap.scrBottom ? 'Y' : 'N'} c={snap.scrBottom ? 'text-green-400' : 'text-yellow-400'} />
      </div>

      {/* Row 2: Renderer + xterm buffer */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="text-[9px] text-yellow-500 font-bold w-8 shrink-0">RND</span>
        <L n="cv" v={snap.cvCount} c={snap.cvCount > 0 ? 'text-green-400' : 'text-red-400'} />
        <L n="rows" v={snap.domRows} c={snap.domRows > 0 ? 'text-green-400' : 'text-gray-500'} />
        <S />
        <L n="buf" v={snap.xBufLen} />
        <L n="baseY" v={snap.xBaseY} />
        <L n="viewY" v={snap.xViewY} />
        <S />
        <L n="ta:x" v={snap.taXterm} c={snap.taXterm === 'pan-y' ? 'text-green-400' : 'text-red-400'} />
        <L n="ta:vp" v={snap.taVp} c={snap.taVp === 'pan-y' ? 'text-green-400' : 'text-red-400'} />
        <L n="ta:cv" v={snap.taCv} c={snap.taCv === 'pan-y' ? 'text-green-400' : 'text-red-400'} />
      </div>

      {/* Row 3: KBD + Touch */}
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="text-[9px] text-yellow-500 font-bold w-8 shrink-0">KBD</span>
        <L n="kbH" v={snap.kbH + 'px'} c={snap.kbH > 30 ? 'text-green-400' : 'text-gray-500'} />
        <L n="vp" v={snap.vpH + 'px'} />
        <L n="vpT" v={snap.vpOffsetTop + 'px'} />
        <L n="in" v={snap.innerH + 'px'} />
        <L n="sc" v={snap.screenH + 'px'} />
        <S />
        <span className="text-[9px] text-yellow-500 font-bold">TCH</span>
        <L n="S" v={snap.tStart} c="text-blue-300" />
        <L n="M" v={snap.tMove} />
        <L n="E" v={snap.tEnd} />
        <L n="scrl" v={snap.tScroll} c={snap.tScroll > 0 ? 'text-green-400' : 'text-red-400'} />
        <S />
        <span className="text-[9px] text-yellow-500 font-bold">BAR</span>
        <L n="DOM" v={snap.barDom ? 'Y' : 'N'} c={snap.barDom ? 'text-green-400' : 'text-red-400'} />
        <L n="dsp" v={snap.barDisp} c={snap.barDisp === 'flex' ? 'text-green-400' : 'text-gray-500'} />
        <L n="top" v={snap.barTop} />
      </div>
    </div>
  );
}
