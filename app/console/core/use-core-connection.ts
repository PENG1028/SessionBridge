'use client';

// ─── useCoreConnection ────────────────────────────────────────────
// Manages Core WebSocket connection configuration and lifecycle.
// Extracted from page.tsx: wsUrl, token, reconnectKey, localStorage.

import { useState, useEffect } from 'react';
import { normalizeWsUrlAndToken, stripTokenFromWsUrl } from './core-url';

export interface CoreConnectionConfig {
  wsUrl: string;
  token: string | undefined;
  reconnectKey: number;
  isLocalPage: boolean;
  browserId: string | undefined;
  setWsUrl: (url: string) => void;
  setToken: React.Dispatch<React.SetStateAction<string | undefined>>;
  triggerReconnect: () => void;
}

export function useCoreConnection(): CoreConnectionConfig {
  // ── Default URL ──
  const defaultUrl = typeof window !== 'undefined'
    ? location.port === '3000'
      ? 'ws://localhost:9090/ws'
      : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
    : 'ws://localhost:9090/ws';

  // ── Parse URL params ──
  const params = typeof window !== 'undefined'
    ? new URL(window.location.href).searchParams
    : new URLSearchParams();
  const urlParam = params.get('url');
  const tokenParam = params.get('token');
  const initNormalized = normalizeWsUrlAndToken(urlParam || defaultUrl, tokenParam || undefined);

  const [wsUrl, setWsUrl] = useState(() => initNormalized.wsUrl);
  const [token, setToken] = useState<string | undefined>(initNormalized.token);
  const [reconnectKey, setReconnectKey] = useState(0);
  const triggerReconnect = () => setReconnectKey(k => k + 1);

  // ── Local page detection (SSR-safe) ──
  const [isLocalPage, setIsLocalPage] = useState(false);
  const [browserId, setBrowserId] = useState<string | undefined>(undefined);
  useEffect(() => {
    setIsLocalPage(
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1' ||
      window.location.hostname === '0.0.0.0',
    );
    if (typeof sessionStorage !== 'undefined') {
      setBrowserId(sessionStorage.getItem('bridge-browser-id') || undefined);
    }
  }, []);

  // ── Restore wsUrl from localStorage (non-localhost only) ──
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URL(window.location.href).searchParams.has('url')) return;
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return;
    try {
      const saved = localStorage.getItem('bridge-ws-url');
      if (saved && saved !== wsUrl) {
        try {
          const savedHost = new URL(saved).hostname;
          if (savedHost === host) {
            const { wsUrl: cleanUrl, token: migratedToken } = normalizeWsUrlAndToken(saved);
            setWsUrl(cleanUrl);
            if (migratedToken) setToken(prev => prev ?? migratedToken);
            localStorage.setItem('bridge-ws-url', cleanUrl);
          }
        } catch (_e) { /* invalid saved URL */ }
      }
    } catch (_e) { /* localStorage unavailable */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persist wsUrl to localStorage ──
  useEffect(() => {
    try {
      const curHost = window.location.hostname;
      const urlHost = new URL(wsUrl).hostname;
      if (urlHost === curHost) {
        localStorage.setItem('bridge-ws-url', stripTokenFromWsUrl(wsUrl));
      }
    } catch (_e) { /* cross-origin or invalid URL */ }
  }, [wsUrl]);

  return {
    wsUrl, setWsUrl,
    token, setToken,
    reconnectKey, triggerReconnect,
    isLocalPage, browserId,
  };
}
