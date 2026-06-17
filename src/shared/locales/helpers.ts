import { writable, derived } from 'svelte/store';
import type { Translation, DeepPartial, TranslationKeys } from './locale.types';

// 동적 JSON import를 위한 로더 함수들
// esbuild는 import()를 코드 스플리팅하여 별도 청크로 분리함
const localeLoaders: Record<string, () => Promise<{ default: DeepPartial<Translation> }>> = {
  en: () => import('./en.json'),
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

export type Language = 'en' | 'ko' | 'ja' | 'zh' | 'zh-tw' | 'es' | 'pt' | 'it' | 'de' | 'fr' | 'ru';

// 로드된 로캘 캐시
const loadedLocales: Record<string, DeepPartial<Translation>> = {};

let currentLanguage: Language | 'system' = 'en';

export const currentLanguageStore = writable<Language | 'system'>('en');

export const tStore = derived(currentLanguageStore, () => {
  return (path: TranslationKeys, params?: Record<string, string | number>) => {
    return t(path, params);
  };
});

/**
 * 동적 로캘을 런타임에 추가 (system 언어 번역 등)
 */
export function addDynamicLocale(lang: string, translation: DeepPartial<Translation>) {
  loadedLocales[lang] = translation;
}

/**
 * setLanguage: 언어를 설정하고 필요한 JSON을 미리 로드합니다.
 * 로드가 완료되면 currentLanguageStore를 업데이트합니다.
 */
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
      // en 로드 보장
      if (!loadedLocales['en']) {
        try {
          const enMod = await localeLoaders['en']();
          loadedLocales['en'] = enMod.default || enMod;
        } catch {
          // 최후의 fallback
        }
      }
    }
  } else {
    // 지원되지 않는 언어 → en 폴백
    console.warn(`[Lumina Localization] Unsupported language: "${lang}", falling back to en`);
    currentLanguage = 'en';
    if (!loadedLocales['en']) {
      try {
        const enMod = await localeLoaders['en']();
        loadedLocales['en'] = enMod.default || enMod;
      } catch {
        // 최후의 fallback
      }
    }
  }

  currentLanguageStore.set(currentLanguage);
}

export function getLanguage(): string {
  return currentLanguage;
}

/**
 * en 로캘을 동기적으로 프리로드 (앱 시작 시 필수)
 */
export async function preloadDefaultLocale(): Promise<void> {
  if (!loadedLocales['en']) {
    try {
      const enMod = await localeLoaders['en']();
      loadedLocales['en'] = enMod.default || enMod;
    } catch (e) {
      console.error('[Lumina Localization] CRITICAL: Failed to load en locale', e);
    }
  }
}

/**
 * 키 경로(예: 'settings.connections.title')를 기반으로 번역된 텍스트를 가져옵니다.
 * 현재 언어에 해당 번역이 누락된 경우 영어(en)로 폴백합니다.
 * {{key}} 문법을 사용한 템플릿 변수 치환을 지원합니다.
 */
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

/**
 * 중첩 객체에서 점 경로로 값을 찾습니다.
 */
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

/**
 * {{key}} 템플릿 변수 치환
 */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  let result = template;
  for (const [k, v] of Object.entries(params)) {
    result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
  }
  return result;
}