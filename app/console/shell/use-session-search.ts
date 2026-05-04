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
      const res = await fetch(`/api/sessions/search?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      setSearchResults(data.results || []);
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
