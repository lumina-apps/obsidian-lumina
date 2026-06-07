import { writable, derived } from 'svelte/store';
import { en, type Translation, type DeepPartial } from './en';
import { ko } from './ko';
import { ja } from './ja';
import { zh } from './zh';
import { zhTW } from './zh-tw';
import { es } from './es';
import { pt } from './pt';
import { it } from './it';
import { de } from './de';
import { fr } from './fr';
import { ru } from './ru';

export type Language = 'en' | 'ko' | 'ja' | 'zh' | 'zh-tw' | 'es' | 'pt' | 'it' | 'de' | 'fr' | 'ru';

const locales: Record<string, DeepPartial<Translation>> = {
  en,
  ko,
  ja,
  zh,
  'zh-tw': zhTW,
  es,
  pt,
  it,
  de,
  fr,
  ru,
};

let currentLanguage: Language | 'system' = 'en';

export const currentLanguageStore = writable<Language | 'system'>('en');

export const tStore = derived(currentLanguageStore, () => {
  return (path: TranslationKeys, params?: Record<string, string | number>) => {
    return t(path, params);
  };
});

export function addDynamicLocale(lang: string, translation: any) {
  locales[lang] = translation;
}

/**
 * 옵시디언 설정이나 시스템 언어를 기반으로 플러그인 언어를 초기화합니다.
 */
export function setLanguage(lang: string) {
  console.log('[Lumina Localization] setLanguage called with:', lang);
  console.log('[Lumina Localization] available locales:', Object.keys(locales));
  if (locales[lang]) {
    currentLanguage = lang as Language | 'system';
  } else {
    currentLanguage = 'en'; // 지원하지 않는 언어일 경우 영어로 폴백
  }
  console.log('[Lumina Localization] currentLanguage is now:', currentLanguage);
  currentLanguageStore.set(currentLanguage);
}

export function getLanguage(): string {
  return currentLanguage;
}

// Translation 객체에서 점(.) 표기법 경로를 추출하기 위한 타입 유틸리티
type Join<K, P> = K extends string | number ?
    P extends string | number ?
    `${K}${"" extends P ? "" : "."}${P}`
    : never : never;

type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    11, 12, 13, 14, 15, 16, 17, 18, 19, 20, ...0[]]

type Paths<T, D extends number = 10> = [D] extends [never] ? never : T extends object ?
    { [K in keyof T]-?: K extends string | number ?
        `${K}` | Join<K, Paths<T[K], Prev[D]>>
        : never
    }[keyof T] : ""

export type TranslationKeys = Extract<Paths<Translation>, string>;

/**
 * 키 경로(예: 'settings.connections.title')를 기반으로 번역된 텍스트를 가져옵니다.
 * 현재 언어에 해당 번역이 누락된 경우 영어(en)로 폴백합니다.
 * {{key}} 문법을 사용한 템플릿 변수 치환을 지원합니다.
 */
export function t(path: TranslationKeys, params?: Record<string, string | number>): string {
    const keys = path.split('.');
    let value: any = locales[currentLanguage];
    
    // console.log(`[Lumina Localization] t('${path}') using language:`, currentLanguage);

    for (const key of keys) {
        if (value && typeof value === 'object') {
            value = value[key];
        } else {
            value = undefined;
            break;
        }
    }

    if (value === undefined || typeof value === 'object') {
        // 영어로 폴백
        value = locales['en'];
        for (const key of keys) {
            if (value && typeof value === 'object') {
                value = value[key];
            } else {
                value = undefined;
                break;
            }
        }
    }

    // 영어에도 없는 키거나 객체인 경우 경로 자체를 반환
    if (value === undefined || typeof value === 'object') {
        return path;
    }

    let result = String(value);
    
    // 파라미터가 있다면 템플릿 변수 치환
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            result = result.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
        }
    }
    
    return result;
}
