const BOOKMARKS_KEY = 'sb-path-bookmarks';
const LAST_DIR_KEY = 'sb-last-active-dir';
const RESTORE_KEY = 'sb-restore-last-path';

/** Dispatched on window when bookmarks are modified (so panels can sync). */
const BOOKMARKS_CHANGED_EVENT = 'sb-bookmarks-changed';

function notifyBookmarksChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(BOOKMARKS_CHANGED_EVENT));
  } catch {}
}

export function getPathBookmarks(): string[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

export function setPathBookmarks(bookmarks: string[]): void {
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
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
    return localStorage.getItem(LAST_DIR_KEY);
  } catch {
    return null;
  }
}

export function setLastActiveDir(path: string): void {
  try {
    localStorage.setItem(LAST_DIR_KEY, path.replace(/\\/g, '/').replace(/\/$/, ''));
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
