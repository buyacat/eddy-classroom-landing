import { withBase } from './url';

import siteUk from '../data/uk/site.json';
import classroomUk from '../data/uk/classroom.json';

import siteEn from '../data/en/site.json';
import classroomEn from '../data/en/classroom.json';

export type Locale = 'uk' | 'en';

const uk = { ...siteUk, ...classroomUk };
const en = { ...siteEn, ...classroomEn };

const locales: Record<Locale, Record<string, unknown>> = { uk, en };

export function getLocaleData(locale: Locale): Record<string, unknown> {
  return locales[locale] ?? uk;
}

export function t(locale: Locale, key: string): string {
  const val = getLocaleData(locale)[key];
  if (val === undefined) return key;
  return String(val);
}

export function tArray<T>(locale: Locale, key: string): T[] {
  const val = getLocaleData(locale)[key];
  return Array.isArray(val) ? (val as T[]) : [];
}

/** Path of the same page in the other locale. */
export function altPath(locale: Locale): string {
  return withBase(locale === 'uk' ? '/en/' : '/');
}
