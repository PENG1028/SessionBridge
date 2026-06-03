// ─── Unit tests: i18n ────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { t, setLocale, getLocale, detectLocale } from '../../lib/i18n';

// Mock site-copy.json with test data
vi.mock('../../content/site/site-copy.json', () => ({
  default: {
    app: {
      name: {
        'zh-CN': 'SessionBridge',
        en: 'SessionBridge',
      },
    },
    session: {
      new: {
        'zh-CN': '新会话',
        en: 'New Session',
      },
    },
    common: {
      clear: {
        'zh-CN': '清屏',
        en: 'Clear',
      },
      close: {
        'zh-CN': '关闭',
        en: 'Close',
      },
    },
  },
}));

describe('i18n t()', () => {
  beforeEach(() => {
    setLocale('zh-CN');
  });

  it('returns Chinese translation by default', () => {
    expect(t('session.new')).toBe('新会话');
  });

  it('returns English translation after locale switch', () => {
    setLocale('en');
    expect(t('session.new')).toBe('New Session');
  });

  it('returns key when translation is missing', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('returns path for empty key', () => {
    expect(t('')).toBe('');
  });

  it('returns key when path is too deep', () => {
    expect(t('app.name.missing')).toBe('app.name.missing');
  });

  it('detects locale from navigator.language', () => {
    // Default fallback when navigator is undefined
    const origNav = globalThis.navigator;
    (globalThis as any).navigator = undefined;
    expect(detectLocale()).toBe('zh-CN');
    if (origNav) globalThis.navigator = origNav;
  });

  it('getLocale/setLocale round-trip', () => {
    setLocale('en');
    expect(getLocale()).toBe('en');
    setLocale('zh-CN');
    expect(getLocale()).toBe('zh-CN');
  });
});
