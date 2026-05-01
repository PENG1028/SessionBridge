// ─── Unit tests: i18n ────────────────────────────────────────

import { describe, it, expect } from 'vitest';

const defaultLocale = 'zh-CN';
const messages: Record<string, Record<string, string>> = {
  'zh-CN': {
    'app.name': 'SessionBridge',
    'session.new': '新会话',
    'session.switch': '切换目录',
    'status.running': '运行中',
    'status.idle': '空闲',
    'status.error': '错误',
    'common.clear': '清屏',
    'common.close': '关闭',
  },
  'en-US': {
    'app.name': 'SessionBridge',
    'session.new': 'New Session',
    'session.switch': 'Switch Directory',
    'status.running': 'Running',
    'status.idle': 'Idle',
    'status.error': 'Error',
    'common.clear': 'Clear',
    'common.close': 'Close',
  },
};

function t(key: string, locale = defaultLocale): string {
  return messages[locale]?.[key] ?? key;
}

describe('i18n t()', () => {
  it('returns Chinese translation by default', () => {
    expect(t('session.new')).toBe('新会话');
  });

  it('returns English translation when locale is en-US', () => {
    expect(t('session.new', 'en-US')).toBe('New Session');
  });

  it('returns key when translation is missing', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('returns key when locale is unknown', () => {
    expect(t('session.new', 'fr-FR')).toBe('session.new');
  });

  it('returns empty string for empty key', () => {
    expect(t('')).toBe('');
  });

  it('returns Chinese for all known keys', () => {
    const keys = Object.keys(messages['zh-CN']);
    for (const key of keys) {
      expect(t(key)).toBe(messages['zh-CN'][key]);
    }
  });

  it('returns English for all known keys', () => {
    const keys = Object.keys(messages['en-US']);
    for (const key of keys) {
      expect(t(key, 'en-US')).toBe(messages['en-US'][key]);
    }
  });

  it('returns different values for same key across locales', () => {
    const cn = t('session.new', 'zh-CN');
    const en = t('session.new', 'en-US');
    expect(cn).not.toBe(en);
  });
});
