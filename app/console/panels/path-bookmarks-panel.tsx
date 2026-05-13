'use client';

import { useState, useCallback, useEffect } from 'react';
import { Bookmark, BookmarkX, Folder, Pin, PinOff, RotateCcw } from 'lucide-react';
import {
  getPathBookmarks,
  addPathBookmark,
  removePathBookmark,
  getRestoreLastPath,
  setRestoreLastPath,
} from '../../lib/path-bookmarks';

interface PathBookmarksPanelProps {
  onNavigatePath?: (path: string) => void;
  currentActiveDir?: string;
}

export function PathBookmarksPanel({ onNavigatePath, currentActiveDir }: PathBookmarksPanelProps) {
  const [bookmarks, setBookmarks] = useState<string[]>(getPathBookmarks);
  const [restoreLastPath, setRestore] = useState<boolean>(getRestoreLastPath);

  // Re-read bookmarks when they change (e.g. bookmarked from FileExplorer on the left)
  useEffect(() => {
    const handler = () => setBookmarks(getPathBookmarks());
    window.addEventListener('sb-bookmarks-changed', handler);
    return () => window.removeEventListener('sb-bookmarks-changed', handler);
  }, []);

  const handleToggleRestore = useCallback(() => {
    setRestore(prev => {
      const next = !prev;
      setRestoreLastPath(next);
      return next;
    });
  }, []);

  const handleRemove = useCallback((path: string) => {
    removePathBookmark(path);
    setBookmarks(getPathBookmarks());
  }, []);

  const handleRefresh = useCallback(() => {
    setBookmarks(getPathBookmarks());
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header / Toggle */}
      <div className="shrink-0 flex items-center justify-between px-2 py-1.5 border-b border-gray-800">
        <button
          onClick={handleToggleRestore}
          className={`flex items-center gap-1.5 text-[10px] transition-colors ${
            restoreLastPath ? 'text-purple-400' : 'text-gray-600 hover:text-gray-400'
          }`}
          title={restoreLastPath ? 'Auto-restore last path (ON)' : 'Auto-restore last path (OFF)'}
        >
          {restoreLastPath ? <Pin className="w-3 h-3" /> : <PinOff className="w-3 h-3" />}
          <span className="tracking-wider font-bold">RESTORE</span>
        </button>
        <button
          onClick={handleRefresh}
          className="text-gray-700 hover:text-gray-400 transition-colors"
          title="Refresh bookmarks"
        >
          <RotateCcw className="w-2.5 h-2.5" />
        </button>
      </div>

      {/* Bookmark list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {bookmarks.length === 0 ? (
          <div className="text-gray-700 text-[9px] p-3 italic leading-relaxed">
            No bookmarked paths yet.<br />
            Right-click or long-press a directory in the file tree to bookmark it.
          </div>
        ) : (
          <div className="space-y-px px-1 py-1">
            {bookmarks.map((path) => (
              <div
                key={path}
                className="group flex items-center gap-1.5 px-2 py-1 rounded hover:bg-gray-900 text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
                onClick={() => onNavigatePath?.(path)}
                title={path}
              >
                <Folder className="w-3 h-3 shrink-0 text-yellow-600" />
                <span className="flex-1 truncate text-[10px] min-w-0">{path}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemove(path); }}
                  className="opacity-0 group-hover:opacity-100 text-gray-700 hover:text-red-400 transition-all shrink-0"
                  title="Remove bookmark"
                >
                  <BookmarkX className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Current path quick-add */}
      {currentActiveDir && currentActiveDir !== '.' && !bookmarks.includes(currentActiveDir.replace(/\\/g, '/').replace(/\/$/, '')) && (
        <div className="shrink-0 px-2 py-1.5 border-t border-gray-800">
          <button
            onClick={() => {
              addPathBookmark(currentActiveDir);
              setBookmarks(getPathBookmarks());
            }}
            className="flex items-center gap-1.5 w-full px-2 py-1 rounded text-[10px] text-gray-600 hover:text-purple-400 hover:bg-gray-900 transition-colors"
            title="Bookmark current directory"
          >
            <Bookmark className="w-2.5 h-2.5" />
            <span className="truncate">{currentActiveDir}</span>
          </button>
        </div>
      )}
    </div>
  );
}
