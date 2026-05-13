// ─── Unit tests: Path Bookmarks Storage ─────────────────────────
// Tests the localStorage-based path bookmarks utility at
// app/lib/path-bookmarks.ts

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPathBookmarks,
  setPathBookmarks,
  addPathBookmark,
  removePathBookmark,
  isPathBookmarked,
  getLastActiveDir,
  setLastActiveDir,
  getRestoreLastPath,
  setRestoreLastPath,
} from '../../app/lib/path-bookmarks';

describe('getPathBookmarks / setPathBookmarks', () => {
  beforeEach(() => localStorage.clear());

  it('returns empty array when no bookmarks saved', () => {
    expect(getPathBookmarks()).toEqual([]);
  });

  it('returns saved bookmarks', () => {
    setPathBookmarks(['/home/user/project', '/var/www']);
    expect(getPathBookmarks()).toEqual(['/home/user/project', '/var/www']);
  });

  it('returns empty array for corrupted JSON', () => {
    localStorage.setItem('sb-path-bookmarks', '{broken');
    expect(getPathBookmarks()).toEqual([]);
  });

  it('filters out non-string entries', () => {
    localStorage.setItem('sb-path-bookmarks', JSON.stringify(['/valid', 42, null, false]));
    expect(getPathBookmarks()).toEqual(['/valid']);
  });

  it('overwrites existing bookmarks on second call', () => {
    setPathBookmarks(['/a', '/b']);
    setPathBookmarks(['/c']);
    expect(getPathBookmarks()).toEqual(['/c']);
  });
});

describe('addPathBookmark', () => {
  beforeEach(() => localStorage.clear());

  it('adds a path to empty bookmarks', () => {
    addPathBookmark('/home/user/project');
    expect(getPathBookmarks()).toEqual(['/home/user/project']);
  });

  it('appends to existing bookmarks', () => {
    setPathBookmarks(['/first']);
    addPathBookmark('/second');
    expect(getPathBookmarks()).toEqual(['/first', '/second']);
  });

  it('does not add duplicate paths', () => {
    setPathBookmarks(['/dup']);
    addPathBookmark('/dup');
    expect(getPathBookmarks()).toEqual(['/dup']);
  });

  it('normalizes backslashes to forward slashes', () => {
    addPathBookmark('D:\\projects\\my-app');
    expect(getPathBookmarks()).toEqual(['D:/projects/my-app']);
  });

  it('normalizes trailing slash', () => {
    addPathBookmark('/home/user/');
    expect(getPathBookmarks()).toEqual(['/home/user']);
  });

  it('handles Windows paths with drive letter', () => {
    addPathBookmark('D:/projects/my-app');
    expect(getPathBookmarks()).toEqual(['D:/projects/my-app']);
  });
});

describe('removePathBookmark', () => {
  beforeEach(() => localStorage.clear());

  it('removes an existing bookmark', () => {
    setPathBookmarks(['/a', '/b', '/c']);
    removePathBookmark('/b');
    expect(getPathBookmarks()).toEqual(['/a', '/c']);
  });

  it('does nothing when path not in bookmarks', () => {
    setPathBookmarks(['/a']);
    removePathBookmark('/b');
    expect(getPathBookmarks()).toEqual(['/a']);
  });

  it('handles normalized paths for removal', () => {
    setPathBookmarks(['D:/projects/app']);
    removePathBookmark('D:\\projects\\app');
    expect(getPathBookmarks()).toEqual([]);
  });

  it('handles trailing slash for removal', () => {
    setPathBookmarks(['/home/user']);
    removePathBookmark('/home/user/');
    expect(getPathBookmarks()).toEqual([]);
  });
});

describe('isPathBookmarked', () => {
  beforeEach(() => localStorage.clear());

  it('returns true for bookmarked path', () => {
    setPathBookmarks(['/bookmarked']);
    expect(isPathBookmarked('/bookmarked')).toBe(true);
  });

  it('returns false for non-bookmarked path', () => {
    setPathBookmarks(['/a']);
    expect(isPathBookmarked('/b')).toBe(false);
  });

  it('returns false when no bookmarks exist', () => {
    expect(isPathBookmarked('/any')).toBe(false);
  });

  it('handles normalized comparison', () => {
    setPathBookmarks(['D:/projects/app']);
    expect(isPathBookmarked('D:\\projects\\app')).toBe(true);
  });
});

describe('lastActiveDir', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when no last dir saved', () => {
    expect(getLastActiveDir()).toBeNull();
  });

  it('saves and retrieves last active dir', () => {
    setLastActiveDir('/home/user/work');
    expect(getLastActiveDir()).toBe('/home/user/work');
  });

  it('normalizes backslashes on save', () => {
    setLastActiveDir('D:\\projects\\app');
    expect(getLastActiveDir()).toBe('D:/projects/app');
  });

  it('normalizes trailing slash on save', () => {
    setLastActiveDir('/home/user/');
    expect(getLastActiveDir()).toBe('/home/user');
  });

  it('overwrites previous value', () => {
    setLastActiveDir('/old');
    setLastActiveDir('/new');
    expect(getLastActiveDir()).toBe('/new');
  });

  it('stores path with spaces', () => {
    setLastActiveDir('/home/user/my projects');
    expect(getLastActiveDir()).toBe('/home/user/my projects');
  });
});

describe('restore toggle', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to true when no value saved', () => {
    expect(getRestoreLastPath()).toBe(true);
  });

  it('returns false after being set to false', () => {
    setRestoreLastPath(false);
    expect(getRestoreLastPath()).toBe(false);
  });

  it('returns true after being set back to true', () => {
    setRestoreLastPath(false);
    setRestoreLastPath(true);
    expect(getRestoreLastPath()).toBe(true);
  });

  it('toggles from true to false', () => {
    expect(getRestoreLastPath()).toBe(true);
    setRestoreLastPath(false);
    expect(getRestoreLastPath()).toBe(false);
  });

  it('saves string "false" correctly (not truthy)', () => {
    setRestoreLastPath(false);
    expect(localStorage.getItem('sb-restore-last-path')).toBe('false');
  });
});

describe('integration: bookmark lifecycle', () => {
  beforeEach(() => localStorage.clear());

  it('full add -> check -> remove -> check cycle', () => {
    const testPath = '/home/user/project';

    expect(isPathBookmarked(testPath)).toBe(false);

    addPathBookmark(testPath);
    expect(isPathBookmarked(testPath)).toBe(true);
    expect(getPathBookmarks()).toEqual([testPath]);

    removePathBookmark(testPath);
    expect(isPathBookmarked(testPath)).toBe(false);
    expect(getPathBookmarks()).toEqual([]);
  });

  it('multiple bookmarks survive across write cycles', () => {
    addPathBookmark('/a');
    addPathBookmark('/b');
    addPathBookmark('/c');

    removePathBookmark('/b');

    expect(getPathBookmarks()).toEqual(['/a', '/c']);
  });

  it('lastActiveDir + bookmarks are independent storage keys', () => {
    setLastActiveDir('/current/dir');
    addPathBookmark('/saved/bookmark');

    expect(getLastActiveDir()).toBe('/current/dir');
    expect(getPathBookmarks()).toEqual(['/saved/bookmark']);

    // Clearing one should not affect the other
    localStorage.removeItem('sb-last-active-dir');
    expect(getPathBookmarks()).toEqual(['/saved/bookmark']);
  });

  it('restore toggle and lastActiveDir work together', () => {
    setLastActiveDir('/last/dir');
    setRestoreLastPath(true);

    const shouldRestore = getRestoreLastPath() && getLastActiveDir() !== null;
    expect(shouldRestore).toBe(true);

    setRestoreLastPath(false);
    const shouldNotRestore = getRestoreLastPath() && getLastActiveDir() !== null;
    expect(shouldNotRestore).toBe(false);
  });
});

describe('edge cases', () => {
  beforeEach(() => localStorage.clear());

  it('ignores empty string path', () => {
    addPathBookmark('');
    expect(getPathBookmarks()).toEqual([]);
  });

  it('ignores root path /', () => {
    addPathBookmark('/');
    expect(getPathBookmarks()).toEqual([]);
  });

  it('handles current directory .', () => {
    addPathBookmark('.');
    expect(getPathBookmarks()).toEqual(['.']);
  });

  it('deduplicates bookmarks with same normalized form', () => {
    addPathBookmark('/path/');
    addPathBookmark('/path');
    addPathBookmark('\\path');
    expect(getPathBookmarks()).toEqual(['/path']);
  });

  it('copes with localStorage quota error', () => {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('quota exceeded'); };
    try {
      expect(() => addPathBookmark('/some/path')).not.toThrow();
      expect(() => setLastActiveDir('/some/path')).not.toThrow();
      expect(() => setRestoreLastPath(false)).not.toThrow();
      expect(() => setPathBookmarks(['/a', '/b'])).not.toThrow();
    } finally {
      Storage.prototype.setItem = orig;
    }
  });
});
