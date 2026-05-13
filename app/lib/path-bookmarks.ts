const BOOKMARKS_KEY = 'sb-path-bookmarks';
const LAST_DIR_KEY = 'sb-last-active-dir';
const RESTORE_KEY = 'sb-restore-last-path';

/** Active scope (hostname) for multi-node bookmark isolation. */
let _bookmarkScope: string | null = null;

/** Set the active scope so all bookmark operations target a node-specific key. */
export function setBookmarkScope(hostname: string | null): void {
  _bookmarkScope = hostname;
}

function storageKey(): string {
  return _bookmarkScope ? `${BOOKMARKS_KEY}-${_bookmarkScope}` : BOOKMARKS_KEY;
}

/** Dispatched on window when bookmarks are modified (so panels can sync). */
const BOOKMARKS_CHANGED_EVENT = 'sb-bookmarks-changed';

function notifyBookmarksChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(BOOKMARKS_CHANGED_EVENT));
  } catch {}
}

export function getPathBookmarks(): string[] {
  try {
    const raw = localStorage.getItem(storageKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export function setPathBookmarks(bookmarks: string[]): void {
  try {
    localStorage.setItem(storageKey(), JSON.stringify(bookmarks));
    notifyBookmarksChanged();
  } catch {}
}

export function addPathBookmark(path: string): void {
  const bookmarks = getPathBookmarks();
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  if (normalized && !bookmarks.includes(normalized)) {
    setPathBookmarks([...bookmarks, normalized]);
  }
}

export function removePathBookmark(path: string): void {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  setPathBookmarks(getPathBookmarks().filter(p => p !== normalized));
}

export function isPathBookmarked(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/\/$/, '');
  return getPathBookmarks().includes(normalized);
}

export function getLastActiveDir(): string | null {
  try {
    return localStorage.getItem(_bookmarkScope ? `${LAST_DIR_KEY}-${_bookmarkScope}` : LAST_DIR_KEY);
  } catch {
    return null;
  }
}

export function setLastActiveDir(path: string): void {
  try {
    const key = _bookmarkScope ? `${LAST_DIR_KEY}-${_bookmarkScope}` : LAST_DIR_KEY;
    localStorage.setItem(key, path.replace(/\\/g, '/').replace(/\/$/, ''));
  } catch {}
}

export function getRestoreLastPath(): boolean {
  try {
    const raw = localStorage.getItem(RESTORE_KEY);
    if (raw === null) return true; // default ON
    return raw === 'true';
  } catch {
    return true;
  }
}

export function setRestoreLastPath(v: boolean): void {
  try {
    localStorage.setItem(RESTORE_KEY, String(v));
  } catch {}
}
