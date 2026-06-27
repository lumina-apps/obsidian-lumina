import { writable, derived } from 'svelte/store';
import type { Translation, DeepPartial, TranslationKeys } from './locale.types';

// 동적 JSON import 로더. esbuild에서 코드 스플리팅으로 별도 청크 분리
const localeLoaders: Record<string, () => Promise<{ default: DeepPartial<Translation> }>> = {
  ko: () => import('./ko.json'),
  ja: () => import('./ja.json'),
  zh: () => import('./zh.json'),
  'zh-tw': () => import('./zh-tw.json'),
  es: () => import('./es.json'),
  pt: () => import('./pt.json'),
  it: () => import('./it.json'),
  de: () => import('./de.json'),
  fr: () => import('./fr.json'),
  ru: () => import('./ru.json'),
};

import enJson from './en.json';

export type Language = 'en' | 'ko' | 'ja' | 'zh' | 'zh-tw' | 'es' | 'pt' | 'it' | 'de' | 'fr' | 'ru';

// 로드된 로캘 캐시
const loadedLocales: Record<string, DeepPartial<Translation>> = {
  en: enJson
};

let currentLanguage: Language | 'system' = 'en';

export const currentLanguageStore = writable<Language | 'system'>('en');

export const tStore = derived(currentLanguageStore, () => {
  return (path: TranslationKeys, params?: Record<string, string | number>) => {
    return t(path, params);
  };
});

/** 런타임에 동적 로캘 추가 */
export function addDynamicLocale(lang: string, translation: DeepPartial<Translation>) {
  loadedLocales[lang] = translation;
}

/** 언어 설정 및 해당 locale JSON 로드. 실패 시 en 폴백 */
export async function setLanguage(lang: string): Promise<void> {
  console.log('[Lumina Localization] setLanguage called with:', lang);

  if (lang === 'system') {
    currentLanguage = 'system';
    currentLanguageStore.set('system');
    return;
  }

  // 이미 캐시되어 있으면 즉시 설정
  if (loadedLocales[lang]) {
    currentLanguage = lang as Language;
    currentLanguageStore.set(currentLanguage);
    return;
  }

  // 동적 로드
  const loader = localeLoaders[lang];
  if (loader) {
    try {
      const mod = await loader();
      loadedLocales[lang] = mod.default || mod;
      currentLanguage = lang as Language;
      console.log('[Lumina Localization] Loaded locale:', lang);
    } catch (e) {
      console.warn(`[Lumina Localization] Failed to load locale "${lang}", falling back to en:`, e);
      currentLanguage = 'en';
    }
  } else {
    // 지원되지 않는 언어 → en 폴백
    console.warn(`[Lumina Localization] Unsupported language: "${lang}", falling back to en`);
    currentLanguage = 'en';
  }

  currentLanguageStore.set(currentLanguage);
}

export function getLanguage(): string {
  return currentLanguage;
}

/** en locale 프리로드 (앱 시작 시 필수) */
export async function preloadDefaultLocale(): Promise<void> {
  // en is now statically imported, so no action is needed here.
  return Promise.resolve();
}

/** 점 경로 키로 번역 텍스트 조회. 누락 시 en 폴백, {{key}} 치환 지원 */
export function t(path: TranslationKeys, params?: Record<string, string | number>): string {
  const keys = path.split('.') as string[];

  // 현재 언어로 먼저 시도
  const lang = currentLanguage;
  if (lang !== 'en' && lang !== 'system') {
    const locale = loadedLocales[lang];
    if (locale) {
      const val = resolvePath(locale, keys);
      if (typeof val === 'string') {
        return interpolate(val, params);
      }
    }
  }

  // system 언어 fallback
  if (lang === 'system') {
    const systemLocale = loadedLocales['system'];
    if (systemLocale) {
      const val = resolvePath(systemLocale, keys);
      if (typeof val === 'string') {
        return interpolate(val, params);
      }
    }
  }

  // en 폴백
  const enLocale = loadedLocales['en'];
  if (enLocale) {
    const val = resolvePath(enLocale, keys);
    if (typeof val === 'string') {
      return interpolate(val, params);
    }
  }

  // 어떤 로캘에도 없으면 키 경로 자체 반환
  return path;
}

/** 중첩 객체에서 점 경로로 값 조회 */
function resolvePath(obj: Record<string, unknown>, keys: string[]): unknown {
  let value: unknown = obj;
  for (const key of keys) {
    if (value && typeof value === 'object') {
      value = (value as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return value;
}

/** {{key}} 템플릿 변수 치환 */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  let result = template;
  for (const [k, v] of Object.entries(params)) {
    result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
  }
  return result;
}

/** 브라우저 시스템 로케일 반환 */
export function getSystemLocale(): string {
	return navigator.language ?? 'Unknown';
}

/** README URL 언어 suffix 반환 */
export function getLangSuffix(language: string): string {
	if (language === 'system') {
		const navLang = (window.navigator.language || 'en').toLowerCase();
		if (navLang.startsWith('zh')) {
			return navLang === 'zh-tw' || navLang === 'zh-hk' ? 'ZH_TW' : 'ZH';
		}
		return navLang.split('-')[0].toUpperCase();
	}
	return language.toUpperCase().replace('-', '_');
}