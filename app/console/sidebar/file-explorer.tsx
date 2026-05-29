'use client';

import { Folder, FileCode, ChevronRight, Download, Bookmark } from 'lucide-react';

/** Build breadcrumb segments from an absolute path (Windows / Unix). */
function pathSegments(absPath: string): { label: string; path: string; key: string }[] {
  const norm = absPath.replace(/\\/g, '/');
  if (!norm) return [];
  if (norm === '/') return [{ label: '/', path: '/', key: 'seg-root' }];
  const driveMatch = norm.match(/^([A-Za-z]:)(\/|$)/);
  if (driveMatch) {
    const drive = driveMatch[1];
    const rest = norm.slice(driveMatch[0].length);
    if (!rest) return [{ label: drive, path: drive + '/', key: 'seg-drive' }];
    const parts = rest.split('/').filter(Boolean);
    const segs: { label: string; path: string; key: string }[] = [{ label: drive, path: drive + '/', key: 'seg-drive' }];
    let accumulated = drive + '/';
    for (let i = 0; i < parts.length; i++) {
      accumulated += parts[i];
      segs.push({ label: parts[i], path: accumulated, key: `seg-${i}` });
      if (i < parts.length - 1) accumulated += '/';
    }
    return segs;
  }
  if (norm.startsWith('/')) {
    const parts = norm.split('/').filter(Boolean);
    const segs: { label: string; path: string; key: string }[] = [{ label: '/', path: '/', key: 'seg-root' }];
    let accumulated = '';
    for (let i = 0; i < parts.length; i++) {
      accumulated += '/' + parts[i];
      segs.push({ label: parts[i], path: accumulated, key: `seg-${i}` });
    }
    return segs;
  }
  return [{ label: norm, path: norm, key: 'seg-0' }];
}

interface FileTreeEntry {
  name: string;
  path?: string;
  type: 'dir' | 'file';
}

interface FileTreeData {
  items: FileTreeEntry[];
  loaded: boolean;
  error?: string;
}

interface FileExplorerProps {
  entries: FileTreeEntry[];
  path?: string;
  depth?: number;
  fileTree: Record<string, FileTreeData>;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onOpenFile: (path: string) => void;
  onSendFile?: (path: string) => void;
  onBookmarkDir?: (path: string) => void;
  /** Absolute path of the working directory, shown as a clickable path bar at the top. */
  absoluteCwd?: string;
}

export function FileExplorer({
  entries,
  path: dirPath = '.',
  depth = 0,
  fileTree,
  expandedDirs,
  onToggleDir,
  onOpenFile,
  onSendFile,
  onBookmarkDir,
  absoluteCwd,
}: FileExplorerProps) {
  return (
    <div className="space-y-px">
      {/* Clickable absolute path bar at the top — replaces the old virtual root label */}
      {depth === 0 && absoluteCwd && (
        <div className="flex items-center gap-0.5 px-2 pb-1.5 overflow-x-auto scrollbar-none border-b border-gray-800 mb-1 select-text">
          {pathSegments(absoluteCwd).map((seg, i) => (
            <span key={seg.key} className="flex items-center gap-0.5 shrink-0">
              {i > 0 && <ChevronRight className="w-2 h-2 text-gray-700 shrink-0" />}
              <span
                onClick={() => onToggleDir(seg.path)}
                title={seg.path}
                className="whitespace-nowrap text-[9px] text-gray-600 hover:text-gray-400 cursor-pointer transition-colors px-1 py-0.5 rounded hover:bg-gray-900"
              >
                {seg.label}
              </span>
            </span>
          ))}
        </div>
      )}

      {entries.map((entry) => {
        const fullPath = entry.path || entry.name;
        const isDir = entry.type === 'dir';
        const isExpanded = expandedDirs.has(fullPath);
        const children = isDir ? fileTree[fullPath] : null;

        return (
          <div key={fullPath}>
            <div className="flex items-center gap-1.5 group">
              <button
                onClick={() => isDir ? onToggleDir(fullPath) : onOpenFile(fullPath)}
                className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-900 text-gray-400 hover:text-gray-200 transition-colors text-left min-w-0"
                title={fullPath}
              >
                {/* Chevron spacer — same width for both files and dirs to align icons */}
                <span className="w-2.5 shrink-0 flex items-center justify-center">
                  {isDir ? (
                    <ChevronRight className={`w-2.5 h-2.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  ) : null}
                </span>
                {isDir
                  ? <Folder className="w-3 h-3 shrink-0 text-yellow-600" />
                  : <FileCode className="w-3 h-3 shrink-0 text-blue-500" />
                }
                <span className="truncate text-[10px]">{entry.name}</span>
              </button>
              {isDir && onBookmarkDir && (
                <button
                  onClick={(e) => { e.stopPropagation(); onBookmarkDir(fullPath); }}
                  className="opacity-0 group-hover:opacity-100 px-1 text-gray-600 hover:text-yellow-400 transition-all shrink-0"
                  title="Toggle bookmark"
                >
                  <Bookmark className="w-2.5 h-2.5" />
                </button>
              )}
              {!isDir && onSendFile && (
                <button
                  onClick={() => onSendFile(fullPath)}
                  className="opacity-0 group-hover:opacity-100 px-1 text-gray-600 hover:text-purple-400 text-[9px] transition-opacity shrink-0"
                  title="Add to message"
                >@</button>
              )}
              {!isDir && (
                <a
                  href={`/api/download?path=${encodeURIComponent(fullPath)}`}
                  download
                  className="opacity-0 group-hover:opacity-100 px-1 text-gray-600 hover:text-blue-400 transition-opacity shrink-0"
                  title="Download file"
                >
                  <Download className="w-2.5 h-2.5" />
                </a>
              )}
            </div>
            {isDir && isExpanded && children?.loaded && (
              <div style={{ paddingLeft: '12px' }}>
                <FileExplorer
                  entries={children.items}
                  path={fullPath}
                  depth={depth + 1}
                  fileTree={fileTree}
                  expandedDirs={expandedDirs}
                  onToggleDir={onToggleDir}
                  onOpenFile={onOpenFile}
                  onSendFile={onSendFile}
                  onBookmarkDir={onBookmarkDir}
                  absoluteCwd={absoluteCwd}
                />
              </div>
            )}
            {isDir && isExpanded && children?.error && (
              <div className="text-gray-700 text-[8px] pl-6 italic">{children.error}</div>
            )}
            {isDir && isExpanded && !children?.loaded && !children?.error && (
              <div className="text-gray-700 text-[8px] pl-6 italic">loading...</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
