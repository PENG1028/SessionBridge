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
  // xterm scroll position
  xBaseY: number;       // buffer baseY
  dxBaseY: number;      // ΔbaseY since last sample (jump detection)
  xBufLen: number;      // buffer length
  // scrollToBottom calls (monkey-patched)
  s2bCount: number;     // how many times scrollToBottom was called
  // DA response diagnostics
  daHits: number;       // CSI handler invocations
  filterHits: number;   // write filter matches
  lastFiltered: any;    // last filtered data snapshot
  // Keyboard diagnostics
  kbRaw: number;        // screen.height - vp.height
  kbHCalc: number;      // h = raw - baseline
  kbOffsetTop: number;  // vp.offsetTop
  kbBaseline: number;   // captured baseline
  kbTransitions: number; // state flip count
  // xterm position shift on keyboard open
  preVY: number; postVY: number; preCY: number; postCY: number;
  kbdS1: string; kbdS2: string; kbdS3: string; kbdAbs: string;
  firstChunk: string;
  // Touch
  tMove: number;
  // Keyboard
  kbH: number; vpT: number;
  // Toolbar
  barDisp: string;
}

const INIT: Snap = {
  xBaseY: 0, dxBaseY: 0, xBufLen: 0,
  s2bCount: 0,
  daHits: 0, filterHits: 0, lastFiltered: null,
  kbRaw: 0, kbHCalc: 0, kbOffsetTop: 0, kbBaseline: 0, kbTransitions: 0,
  preVY: 0, postVY: 0, preCY: 0, postCY: 0,
  kbdS1: '-', kbdS2: '-', kbdS3: '-', kbdAbs: '-',
  firstChunk: '-',
  tMove: 0,
  kbH: 0, vpT: 0,
  barDisp: '-',
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

    // Touch move counter
    let tMove = 0;
    const onTM = () => { tMove++; };
    document.addEventListener('touchmove', onTM, { capture: true, passive: true });

    let rafId = 0;
    let lastBaseY = -1;

    const poll = () => {
      const xBaseY = (window as any).__baseY ?? 0;
      const xBufLen = (window as any).__bufLen ?? 0;
      const s2bCount = (window as any).__s2b || 0;
      const daHits = (window as any).__daHits?.count ?? 0;
      const filterHits = (window as any).__filterHits || 0;
      const lastFiltered = (window as any).__lastFiltered || null;
      const kbDiag = (window as any).__kbDiag || null;
      const kbd = (window as any).__keyboardDiag || null;
      const firstChunk = (window as any).__firstChunkDiag || null;

      const dxBaseY = lastBaseY >= 0 ? xBaseY - lastBaseY : 0;
      lastBaseY = xBaseY;

      // Keyboard height (rough, for diagnostic)
      const raw = window.screen.height - (window.visualViewport?.height ?? window.innerHeight);
      const kbH = Math.round(Math.max(0, raw - 50));

      // Toolbar
      let barDisp = '-';
      const bar = document.querySelector('[data-mobile-keyboard-toolbar]') as HTMLElement | null;
      if (bar) barDisp = bar.style.display || getComputedStyle(bar).display;

      setSnap({
        xBaseY, dxBaseY, xBufLen,
        s2bCount, daHits, filterHits,
        lastFiltered,
        kbRaw: kbDiag?.raw ?? 0,
        kbHCalc: kbDiag?.h ?? 0,
        kbOffsetTop: kbDiag?.offsetTop ?? 0,
        kbBaseline: kbDiag?.baseline ?? 0,
        kbTransitions: kbDiag?.transitions?.length ?? 0,
        preVY: kbd?.s1?.viewportY ?? 0,
        postVY: kbd?.s3?.viewportY ?? 0,
        preCY: kbd?.s1?.cursorY ?? 0,
        postCY: kbd?.s3?.cursorY ?? 0,
        kbdS1: kbd?.s1 ? `r${kbd.s1.rows}v${kbd.s1.viewportY}c${kbd.s1.cursorY}` : '-',
        kbdS2: kbd?.s2 ? `r${kbd.s2.rows}v${kbd.s2.viewportY}c${kbd.s2.cursorY}` : '-',
        kbdS3: kbd?.s3 ? `r${kbd.s3.rows}v${kbd.s3.viewportY}c${kbd.s3.cursorY}` : '-',
        kbdAbs: kbd?.s1 && kbd?.s3 ? `${kbd.s1.absCursor}→${kbd.s3.absCursor}` : '-',
        firstChunk: firstChunk?.cupSuppressed
          ? `CUP→${firstChunk.targetRow}:${firstChunk.targetCol} (was cY=${firstChunk.currentCursorY} rows=${firstChunk.rows})`
          : (firstChunk ? JSON.stringify(firstChunk).slice(0, 50) : '-'),
        tMove,
        kbH,
        vpT: Math.round(window.visualViewport?.offsetTop ?? 0),
        barDisp,
      });

      rafId = requestAnimationFrame(poll);
    };
    rafId = requestAnimationFrame(poll);

    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('touchmove', onTM, { capture: true });
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

  // Color for ΔbaseY: large positive = jump toward bottom (red), negative = scroll up (green)
  const dxColor = () => {
    if (snap.dxBaseY > 20) return 'text-red-400';
    if (snap.dxBaseY < -1) return 'text-green-400';
    return 'text-gray-400';
  };

  return (
    <div
      className="fixed left-0 right-0 z-[9999] px-2 py-1 font-mono bg-black/70 backdrop-blur-sm border-b border-yellow-600/60 text-gray-300"
      style={{ top: panelTop, pointerEvents: 'none' }}
    >
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <span className="text-[9px] text-yellow-500 font-bold">DBG</span>
        <L n="baseY" v={snap.xBaseY} />
        <L n="Δ" v={snap.dxBaseY > 0 ? `+${snap.dxBaseY}` : snap.dxBaseY} c={dxColor()} />
        <L n="buf" v={snap.xBufLen} />
        <S />
        <L n="s2b" v={snap.s2bCount} c={snap.s2bCount > 0 ? 'text-red-400' : 'text-green-400'} />
        <L n="da" v={snap.daHits} c={snap.daHits > 0 ? 'text-green-400' : 'text-red-400'} />
        <L n="flt" v={snap.filterHits} c={snap.filterHits > 0 ? 'text-green-400' : 'text-gray-500'} />
        <S />
        <L n="tM" v={snap.tMove} />
        <L n="kbH" v={snap.kbH} c={snap.kbH > 30 ? 'text-green-400' : 'text-gray-500'} />
        <L n="raw" v={snap.kbRaw} />
        <L n="h" v={snap.kbHCalc} c={snap.kbHCalc > 60 ? 'text-red-400' : 'text-gray-400'} />
        <L n="oS" v={snap.kbOffsetTop} c={snap.kbOffsetTop > 3 ? 'text-red-400' : 'text-gray-400'} />
        <L n="bl" v={snap.kbBaseline} />
        <L n="tx" v={snap.kbTransitions} c={snap.kbTransitions > 0 ? 'text-yellow-400' : 'text-gray-500'} />
        <S />
        <L n="1st" v={typeof snap.firstChunk === 'string' && snap.firstChunk !== '-' ? snap.firstChunk.slice(0, 50) : '-'} c={snap.firstChunk !== '-' ? 'text-yellow-400' : 'text-gray-500'} />
        <L n="vpT" v={snap.vpT} />
        <L n="bar" v={snap.barDisp} c={snap.barDisp === 'flex' ? 'text-green-400' : 'text-gray-500'} />
      </div>
    </div>
  );
}
