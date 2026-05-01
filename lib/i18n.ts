import siteCopy from '../content/site/site-copy.json';

type Locale = 'zh-CN' | 'en';

let _locale: Locale = 'zh-CN';

export function setLocale(l: Locale) { _locale = l; }
export function getLocale(): Locale { return _locale; }

export function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh-CN';
  const lang = navigator.language;
  if (lang?.startsWith('zh')) return 'zh-CN';
  return 'en';
}

export function t(path: string): string {
  const keys = path.split('.');
  let obj: any = siteCopy;
  for (const key of keys) {
    if (obj == null) return path;
    obj = obj[key];
  }
  if (typeof obj === 'string') return obj;
  if (obj && typeof obj === 'object') {
    return (obj as Record<Locale, string>)[_locale] ?? (obj as Record<Locale, string>)['en'] ?? path;
  }
  return path;
}
