'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { FloatingWindow } from '../shared/floating-window';
import { Search, ChevronRight, Folder, File, Check, ArrowLeft } from 'lucide-react';

interface DirEntry {
  name: string;
  path?: string;
  type: 'dir' | 'file';
}

interface DirectoryPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  title?: string;
}

/** Reactive hook: true when viewport is at most 767px wide. */
function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    setMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return mobile;
}

interface BreadcrumbSeg {
  label: string;
  path: string;
  /** Stable key for React to avoid duplicates when root segments share `path: '.'`. */
  key: string;
}

/** Split a (possibly absolute) `rootCwd` into display segments for breadcrumb. */
function splitRoot(rootCwd: string): BreadcrumbSeg[] {
  const normalized = rootCwd.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return [{ label: '~', path: '.', key: 'root' }];
  return parts.map((label, i) => ({ label, path: '.', key: `root-${i}` }));
}

/**
 * Build breadcrumb segments from the selected (relative) path.
 * When at root (`.`), show the absolute workspace path decomposed.
 * When in a subdirectory, show root segments + relative child segments.
 */
function pathSegments(path: string, rootCwd: string): BreadcrumbSeg[] {
  const normalized = path.replace(/\\/g, '/');
  if (normalized === '.' || normalized === '') {
    return splitRoot(rootCwd);
  }
  const relative = normalized.replace(/^\.\/?/, '');
  const parts = relative.split('/').filter(Boolean);
  const root = splitRoot(rootCwd);
  const children = parts.map((label, i) => ({
    label,
    path: '.' + '/' + parts.slice(0, i + 1).join('/'),
    key: `child-${i}`,
  }));
  return [...root, ...children];
}

export function DirectoryPicker({
  open, onClose, onSelect,
  initialPath = '.',
  title = 'Select Directory',
}: DirectoryPickerProps) {
  const [tree, setTree] = useState<Record<string, { items: DirEntry[]; loaded: boolean }>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['.']));
  const [selected, setSelected] = useState(initialPath);
  const [search, setSearch] = useState('');
  const [rootCwd, setRootCwd] = useState('');

  const mobile = useIsMobile();

  const fetchDir = useCallback(async (dir: string) => {
    try {
      const r = await fetch(`/api/list?dir=${encodeURIComponent(dir)}`);
      const d = await r.json();
      if (d.items) {
        setRootCwd(d.cwd || '');
        setTree(prev => ({ ...prev, [dir]: { items: d.items, loaded: true } }));
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (open) {
      setSelected(initialPath);
      setTree({});
      setExpanded(new Set(['.']));
      setSearch('');
      fetchDir('.');
    }
  }, [open, fetchDir, initialPath]);

  const toggleDir = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!tree[path]?.loaded) fetchDir(path);
  }, [tree, fetchDir]);

  const breadcrumb = useMemo(() => pathSegments(selected, rootCwd), [selected, rootCwd]);

  // Collect all paths matching search across loaded tree
  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();

    function collect(items: DirEntry[], depth: number): { path: string; name: string; isDir: boolean }[] {
      const res: { path: string; name: string; isDir: boolean }[] = [];
      for (const e of items) {
        const fp = e.path || e.name;
        if (e.name.toLowerCase().includes(q)) {
          res.push({ path: fp, name: e.name, isDir: e.type === 'dir' });
        }
        if (e.type === 'dir' && expanded.has(fp)) {
          const children = tree[fp]?.items;
          if (children) res.push(...collect(children, depth + 1));
        }
      }
      return res;
    }

    const root = tree['.']?.items || [];
    return collect(root, 0);
  }, [search, tree, expanded]);

  const renderEntry = (entry: DirEntry, depth: number): React.ReactNode => {
    const fp = entry.path || entry.name;
    const isDir = entry.type === 'dir';
    const isExp = expanded.has(fp);
    const isSel = selected === fp;
    const children = isDir ? tree[fp] : null;
    // Larger tap targets on mobile
    const py = mobile ? 'py-2' : 'py-0.5';

    return (
      <div key={fp}>
        <div
          className={`flex items-center gap-1.5 pl-1 ${py} rounded cursor-pointer text-[11px] ${
            isSel
              ? 'bg-purple-800/30 text-gray-200'
              : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
          }`}
          onClick={() => { if (isDir) setSelected(fp); }}
          onDoubleClick={() => { if (isDir) toggleDir(fp); }}
        >
          {isDir ? (
            <button
              onClick={e => { e.stopPropagation(); toggleDir(fp); }}
              className={`p-0.5 hover:bg-gray-800 rounded shrink-0 ${mobile ? 'p-1' : ''}`}
            >
              <ChevronRight className={`w-2.5 h-2.5 transition-transform ${isExp ? 'rotate-90' : ''}`} />
            </button>
          ) : (
            <span className="w-[18px] shrink-0" />
          )}
          {isDir
            ? <Folder className="w-3 h-3 text-yellow-600 shrink-0" />
            : <File className="w-3 h-3 text-blue-500 shrink-0" />
          }
          <span className="truncate flex-1 min-w-0">{entry.name}</span>
          {isSel && <Check className="w-2.5 h-2.5 text-purple-400 shrink-0 mr-1" />}
        </div>
        {isDir && isExp && children?.loaded && (
          <div style={{ paddingLeft: `${14}px` }}>
            {children.items.map(c => renderEntry(c, depth + 1))}
          </div>
        )}
        {isDir && isExp && !children?.loaded && (
          <div className="text-gray-700 text-[8px] pl-7 italic">loading...</div>
        )}
      </div>
    );
  };

  // ── Shared content (used by both desktop and mobile) ──
  const content = (
    <>
      {/* Search bar */}
      <div className="shrink-0 px-2 pt-2 pb-1">
        <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-900 border border-gray-700 rounded">
          <Search className="w-3 h-3 text-gray-600 shrink-0" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter..."
            className="flex-1 bg-transparent text-[11px] text-gray-200 outline-none placeholder:text-gray-700"
            autoFocus
          />
        </div>
      </div>

      {/* Breadcrumb navigation */}
      <div className="shrink-0 flex items-center gap-0.5 px-2 pb-1.5 overflow-x-auto scrollbar-none">
        {breadcrumb.map((seg, i) => (
          <span key={seg.key} className="flex items-center gap-0.5 shrink-0">
            {i > 0 && <ChevronRight className="w-2.5 h-2.5 text-gray-700 shrink-0" />}
            <button
              onClick={() => {
                setSelected(seg.path);
                if (!expanded.has(seg.path)) toggleDir(seg.path);
              }}
              className={`text-[10px] px-1.5 py-0.5 rounded whitespace-nowrap transition-colors ${
                seg.path === selected
                  ? 'bg-purple-800/30 text-purple-300 font-semibold'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
              }`}
            >
              {seg.label}
            </button>
          </span>
        ))}
      </div>

      {/* Tree / search results */}
      <div className="flex-1 overflow-y-auto px-1 pb-1 min-h-0">
        {!tree['.']?.loaded ? (
          <div className="text-gray-600 text-[10px] p-3 italic">Loading files...</div>
        ) : searchResults !== null && searchResults.length === 0 ? (
          <div className="text-gray-700 text-[10px] p-3 italic">No matches</div>
        ) : searchResults !== null ? (
          /* Flat search results */
          <div className="space-y-px">
            {searchResults.map(r => (
              <div
                key={r.path}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-[11px] ${
                  selected === r.path
                    ? 'bg-purple-800/30 text-gray-200'
                    : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
                }`}
                onClick={() => {
                  setSelected(r.path);
                  if (r.isDir && !expanded.has(r.path)) {
                    toggleDir(r.path);
                  }
                }}
              >
                {r.isDir
                  ? <Folder className="w-3 h-3 text-yellow-600 shrink-0" />
                  : <File className="w-3 h-3 text-blue-500 shrink-0" />
                }
                <span className="truncate flex-1 min-w-0">{r.path}</span>
                {selected === r.path && <Check className="w-2.5 h-2.5 text-purple-400 shrink-0" />}
              </div>
            ))}
          </div>
        ) : (
          /* Normal tree view */
          tree['.'].items.map(e => renderEntry(e, 0))
        )}
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-t border-gray-800 bg-gray-900/50">
        <span className="text-[9px] text-gray-600 font-mono truncate max-w-[60%]">{selected}</span>
        <button
          onClick={() => { onSelect(selected); onClose(); }}
          className="px-3 py-1 bg-purple-700 hover:bg-purple-600 text-white text-[10px] rounded border border-purple-600 transition-colors"
        >
          Select
        </button>
      </div>
    </>
  );

  // ── Mobile: fullscreen overlay ──
  if (mobile) {
    if (!open) return null;
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-[#0d0d0d]">
        {/* Mobile header */}
        <div className="flex items-center justify-between h-10 px-3 border-b border-gray-800 bg-gray-900 shrink-0">
          <button onClick={onClose} className="flex items-center gap-1 text-gray-400 hover:text-gray-200">
            <ArrowLeft className="w-4 h-4" />
            <span className="text-xs">Back</span>
          </button>
          <span className="text-[10px] font-bold text-gray-500 tracking-wider">{title}</span>
          <div className="w-12" />
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col min-h-0">
          {content}
        </div>
      </div>
    );
  }

  // ── Desktop: FloatingWindow ──
  return (
    <FloatingWindow
      title={title}
      open={open}
      onClose={onClose}
      resizable
      defaultSize={{ w: 440, h: 480 }}
      minSize={{ w: 280, h: 220 }}
    >
      {content}
    </FloatingWindow>
  );
}
