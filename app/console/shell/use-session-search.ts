// ─── Session Search Hook ─────────────────────────────────────
// Extracted from page.tsx. Encapsulates session search state
// and search panel logic.

import { useState, useRef, useCallback } from 'react';

export function useSessionSearch() {
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchPanelRef = useRef<HTMLDivElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string) => {
    setSearchLoading(true);
    try {
      const query = q.trim().toLowerCase();
      if (!query) {
        setSearchResults([]);
        setSearchLoading(false);
        return;
      }
      // Local search across localStorage — no remote API call
      const results: any[] = [];
      const keys = ['sessionbridge-messages', 'bridge-messages'];
      for (const key of keys) {
        try {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          const parsed = JSON.parse(raw);
          for (const messages of Object.values(parsed)) {
            if (!Array.isArray(messages)) continue;
            for (const msg of messages as any[]) {
              if (msg.content && typeof msg.content === 'string' && msg.content.toLowerCase().includes(query)) {
                results.push({
                  id: msg.id || `${key}:${results.length}`,
                  snippet: (msg.content as string).slice(0, 200),
                  timestamp: msg.timestamp || '',
                  role: msg.role || '',
                });
                if (results.length >= 50) break;
              }
            }
            if (results.length >= 50) break;
          }
        } catch {}
        if (results.length >= 50) break;
      }
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    }
    setSearchLoading(false);
  }, []);

  const handleSearchInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => doSearch(val), 300);
  }, [doSearch]);

  const openSearchPanel = useCallback(() => {
    setShowSearch(true);
    setSearchQuery('');
    setSearchResults([]);
    doSearch('');
    setTimeout(() => searchInputRef.current?.focus(), 100);
  }, [doSearch]);

  return {
    showSearch, setShowSearch, searchQuery, setSearchQuery,
    searchResults, setSearchResults, searchLoading, setSearchLoading,
    searchInputRef, searchPanelRef,
    handleSearchInput, openSearchPanel, doSearch,
  };
}
