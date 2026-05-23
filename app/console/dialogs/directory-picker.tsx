'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { FloatingWindow } from '../shared/floating-window';
import { Search, ChevronRight, Folder, File, Check, ArrowLeft, ArrowRightFromLine } from 'lucide-react';
import { useCore } from '../core/core-client-provider';

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
  baseUrl?: string;
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
  key: string;
}

/** Full workspace path for the root breadcrumb segment. */
function rootLabel(rootCwd: string): string {
  return rootCwd.replace(/\\/g, '/').replace(/\/$/, '') || '~';
}

/**
 * Build breadcrumb segments from the selected path.
 * Root shows the project folder name (click → workspace root).
 * Child segments show relative path components (click → that level).
 */
function pathSegments(path: string, rootLabelStr: string): BreadcrumbSeg[] {
  const norm = path.replace(/\\/g, '/').replace(/^\.\/?/, '');

  /** Split segments from an absolute Unix/Win path. */
  function fromAbs(abs: string): BreadcrumbSeg[] {
    const parts = abs.split('/').filter(Boolean);
    return parts.map((label, i) => {
      const full = parts.slice(0, i + 1).join('/');
      return { label, path: full === rootLabelStr ? '.' : full, key: `seg-${i}` };
    });
  }

  // At project root → show rootCwd as segments
  if (!norm || norm === '.' || norm === rootLabelStr) {
    return fromAbs(rootLabelStr);
  }

  // Above ROOT_DIR (absolute path) → just those segments, no root context
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) {
    return fromAbs(norm);
  }

  // Relative sub-path → rootCwd + relative segments
  const rootParts = rootLabelStr.split('/').filter(Boolean);
  const rootSegs = rootParts.map((label, i) => ({
    label,
    path: rootParts.slice(0, i + 1).join('/') === rootLabelStr ? '.' : rootParts.slice(0, i + 1).join('/'),
    key: `rs-${i}`,
  }));

  const parts = norm.split('/').filter(Boolean);
  const relSegs = parts.map((label, i) => ({
    label,
    path: '.' + '/' + parts.slice(0, i + 1).join('/'),
    key: `seg-${i}`,
  }));

  return [...rootSegs, ...relSegs];
}

export function DirectoryPicker({
  open, onClose, onSelect,
  initialPath = '.',
  title = 'Select Directory',
  baseUrl = '',
}: DirectoryPickerProps) {
  const core = useCore();
  const [tree, setTree] = useState<Record<string, { items: DirEntry[]; loaded: boolean }>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['.']));
  const [selected, setSelected] = useState(initialPath);
  const [search, setSearch] = useState('');
  const [rootCwd, setRootCwd] = useState('');

  const mobile = useIsMobile();

  const fetchDir = useCallback(async (dir: string) => {
    try {
      // Prefer CoreClient fs.list when connected
      if (core?.isConnected) {
        const res = await core.call<{ path: string; entries: Array<{ name: string; isDir: boolean; size: number; mode: string }> }>('fs.list', { path: dir });
        const entries = res?.entries ?? [];
        const items: DirEntry[] = entries.map(e => ({ name: e.name, type: e.isDir ? 'dir' : 'file' }));
        setTree(prev => ({ ...prev, [dir]: { items, loaded: true } }));
        return;
      }
      // Fallback: relay HTTP API
      const r = await fetch(`${baseUrl}/api/list?dir=${encodeURIComponent(dir)}`);
      const d = await r.json();
      if (d.items) {
        setRootCwd(d.cwd || '');
        setTree(prev => ({ ...prev, [dir]: { items: d.items, loaded: true } }));
      }
    } catch {}
  }, [baseUrl, core]);

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

  /** Navigate to a directory: fetches contents and rebases the tree to show them. */
  const navigateTo = useCallback((path: string) => {
    setSelected(path);
    setExpanded(new Set(['.']));
    const q = path.replace(/^([A-Za-z]):$/, '$1:/'); // fix bare drive letter

    if (core?.isConnected) {
      core.call<{ path: string; entries: Array<{ name: string; isDir: boolean; size: number; mode: string }> }>('fs.list', { path: q })
        .then(res => {
          const entries = res?.entries ?? [];
          const items: DirEntry[] = entries.map(e => ({ name: e.name, type: e.isDir ? 'dir' : 'file' }));
          setTree(prev => ({ ...prev, '.': { items, loaded: true } }));
        })
        .catch(() => {});
      return;
    }

    fetch(`${baseUrl}/api/list?dir=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(d => {
        if (d.items) {
          setRootCwd(d.cwd || '');
          setTree(prev => ({ ...prev, '.': { items: d.items, loaded: true } }));
        }
      })
      .catch(() => {});
  }, [baseUrl, core]);

  const rootLabelStr = useMemo(() => rootLabel(rootCwd), [rootCwd]);
  const breadcrumb = useMemo(() => pathSegments(selected, rootLabelStr), [selected, rootLabelStr]);

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
    const py = mobile ? 'py-2.5' : 'py-0.5';
    const textSize = mobile ? 'text-[13px]' : 'text-[11px]';
    const iconSize = mobile ? 'w-3.5 h-3.5' : 'w-3 h-3';
    const chevronSize = mobile ? 'w-3 h-3' : 'w-2.5 h-2.5';

    return (
      <div key={fp}>
        <div
          className={`flex items-center gap-1.5 pl-1 ${py} rounded cursor-pointer ${textSize} ${
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
              className={`rounded shrink-0 hover:bg-gray-800 ${mobile ? 'p-1.5' : 'p-0.5'}`}
            >
              <ChevronRight className={`${chevronSize} transition-transform ${isExp ? 'rotate-90' : ''}`} />
            </button>
          ) : (
            <span className={mobile ? 'w-[26px] shrink-0' : 'w-[18px] shrink-0'} />
          )}
          {isDir
            ? <Folder className={`${iconSize} text-yellow-600 shrink-0`} />
            : <File className={`${iconSize} text-blue-500 shrink-0`} />
          }
          <span className="truncate flex-1 min-w-0">{entry.name}</span>
          {isSel && <Check className={`${mobile ? 'w-3 h-3' : 'w-2.5 h-2.5'} text-purple-400 shrink-0 mr-1`} />}
          {isDir && isSel && (
            <button
              onClick={e => { e.stopPropagation(); navigateTo(fp); }}
              className={`${mobile ? 'p-1' : 'p-0.5'} hover:bg-purple-700/40 rounded shrink-0 text-gray-500 hover:text-purple-300 transition-colors`}
              title="Navigate into directory"
            >
              <ArrowRightFromLine className={`${mobile ? 'w-3.5 h-3.5' : 'w-3 h-3'}`} />
            </button>
          )}
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
          <Search className={`${mobile ? 'w-3.5 h-3.5' : 'w-3 h-3'} text-gray-600 shrink-0`} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter..."
            className={`flex-1 bg-transparent outline-none placeholder:text-gray-700 ${mobile ? 'text-[13px] py-1.5' : 'text-[11px]'}`}
            autoFocus
          />
        </div>
      </div>

      {/* Breadcrumb navigation */}
      <div className="shrink-0 flex items-center gap-0.5 px-2 pb-1.5 overflow-x-auto scrollbar-none select-text">
        {breadcrumb.map((seg, i) => (
          <span key={seg.key} className="flex items-center gap-0.5 shrink-0">
            {i > 0 && <ChevronRight className="w-2.5 h-2.5 text-gray-700 shrink-0" />}
            <span
              onClick={() => navigateTo(seg.path)}
              title={seg.path === '.' ? rootCwd : seg.path}
              className={`whitespace-nowrap rounded transition-colors cursor-pointer ${
                mobile
                  ? 'text-[11px] px-2 py-1'
                  : 'text-[10px] px-1.5 py-0.5'
              } ${
                seg.path === selected
                  ? 'bg-purple-800/30 text-purple-300 font-semibold'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
              }`}
            >
              {seg.label}
            </span>
          </span>
        ))}
      </div>

      {/* Tree / search results */}
      <div className="flex-1 overflow-y-auto px-1 pb-1 min-h-0">
        {!tree['.']?.loaded ? (
          <div className={`text-gray-600 p-3 italic ${mobile ? 'text-[12px]' : 'text-[10px]'}`}>Loading files...</div>
        ) : searchResults !== null && searchResults.length === 0 ? (
          <div className={`text-gray-700 p-3 italic ${mobile ? 'text-[12px]' : 'text-[10px]'}`}>No matches</div>
        ) : searchResults !== null ? (
          /* Flat search results — search always searches from project root */
          <div className="space-y-px">
            {searchResults.map(r => (
              <div
                key={r.path}
                className={`flex items-center gap-1.5 px-2 rounded cursor-pointer ${
                  mobile ? 'py-2.5 text-[13px]' : 'py-1.5 text-[11px]'
                } ${
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
                  ? <Folder className={`${mobile ? 'w-3.5 h-3.5' : 'w-3 h-3'} text-yellow-600 shrink-0`} />
                  : <File className={`${mobile ? 'w-3.5 h-3.5' : 'w-3 h-3'} text-blue-500 shrink-0`} />
                }
                <span className="truncate flex-1 min-w-0">{r.path}</span>
                {selected === r.path && <Check className={`${mobile ? 'w-3 h-3' : 'w-2.5 h-2.5'} text-purple-400 shrink-0`} />}
              </div>
            ))}
          </div>
        ) : (
          /* Normal tree view */
          tree['.'].items.map(e => renderEntry(e, 0))
        )}
      </div>

      {/* Bottom bar */}
      <div className={`shrink-0 flex items-center justify-between px-3 border-t border-gray-800 bg-gray-900/50 ${mobile ? 'py-3' : 'py-2'}`}>
        <span className={`font-mono truncate max-w-[60%] text-gray-600 ${mobile ? 'text-[11px]' : 'text-[9px]'}`} title={selected}>{selected}</span>
        <button
          onClick={() => { onSelect(selected); onClose(); }}
          className={`bg-purple-700 hover:bg-purple-600 text-white rounded border border-purple-600 transition-colors ${
            mobile
              ? 'px-5 py-2 text-[13px]'
              : 'px-3 py-1 text-[10px]'
          }`}
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
