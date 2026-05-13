'use client';

import { Folder, FileCode, ChevronRight, Download, Bookmark } from 'lucide-react';

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
}: FileExplorerProps) {
  return (
    <div className="space-y-px">
      {entries.map((entry) => {
        const fullPath = entry.path || entry.name;
        const isDir = entry.type === 'dir';
        const isExpanded = expandedDirs.has(fullPath);
        const children = isDir ? fileTree[fullPath] : null;

        if (isDir) {
          return (
            <div key={fullPath}>
              <div className="flex items-center gap-1.5 group">
                <button
                  onClick={() => onToggleDir(fullPath)}
                  className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-900 text-gray-400 hover:text-gray-200 transition-colors text-left min-w-0"
                  title={fullPath}
                >
                  <ChevronRight className={`w-2.5 h-2.5 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  <Folder className="w-3 h-3 shrink-0 text-yellow-600" />
                  <span className="truncate text-[10px]">{entry.name}</span>
                </button>
                {onBookmarkDir && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onBookmarkDir(fullPath); }}
                    className="opacity-0 group-hover:opacity-100 px-1 text-gray-600 hover:text-yellow-400 transition-all shrink-0"
                    title="Toggle bookmark"
                  >
                    <Bookmark className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
              {isExpanded && children?.loaded && (
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
                  />
                </div>
              )}
              {isExpanded && children?.error && (
                <div className="text-gray-700 text-[8px] pl-6 italic">{children.error}</div>
              )}
              {isExpanded && !children?.loaded && !children?.error && (
                <div className="text-gray-700 text-[8px] pl-6 italic">loading...</div>
              )}
            </div>
          );
        }

        return (
          <div key={fullPath} className="flex items-center gap-1.5 group">
            <button
              onClick={() => onOpenFile(fullPath)}
              className="flex-1 flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-900 text-gray-400 hover:text-gray-200 transition-colors text-left min-w-0"
              title={fullPath}
            >
              <FileCode className="w-3 h-3 shrink-0 text-blue-500" />
              <span className="truncate text-[10px]">{entry.name}</span>
            </button>
            {onSendFile && (
              <button
                onClick={() => onSendFile(fullPath)}
                className="opacity-0 group-hover:opacity-100 px-1 text-gray-600 hover:text-purple-400 text-[9px] transition-opacity shrink-0"
                title="Add to message"
              >@</button>
            )}
            <a
              href={`/api/download?path=${encodeURIComponent(fullPath)}`}
              download
              className="opacity-0 group-hover:opacity-100 px-1 text-gray-600 hover:text-blue-400 transition-opacity shrink-0"
              title="Download file"
            >
              <Download className="w-2.5 h-2.5" />
            </a>
          </div>
        );
      })}
    </div>
  );
}
