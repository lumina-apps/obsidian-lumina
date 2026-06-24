import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	addDynamicLocale,
	setLanguage,
	getLanguage,
	t,
	getSystemLocale,
	getLangSuffix,
	currentLanguageStore,
} from './helpers';

describe('Locale Helpers', () => {
	beforeEach(() => {
		// 기본 로케일 주입
		addDynamicLocale('en', {
			settings: {
				chat: {
					memoryMethod: "Memory Method",
				}
			},
			greeting: "Hello {{name}}"
		} as any);

		addDynamicLocale('ko', {
			settings: {
				chat: {
					memoryMethod: "메모리 방식",
				}
			},
			greeting: "안녕하세요 {{name}}"
		} as any);

		vi.stubGlobal('navigator', { language: 'ko-KR' });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	describe('setLanguage & getLanguage', () => {
		it('언어를 설정하고 가져올 수 있다', async () => {
			await setLanguage('ko');
			expect(getLanguage()).toBe('ko');
		});

		it('지원되지 않는 언어는 en으로 폴백된다', async () => {
			// 테스트 환경에서는 localeLoaders가 동작하지 않아 catch 블록으로 빠지면서 en으로 fallback됨.
			await setLanguage('unknown_lang');
			expect(getLanguage()).toBe('en');
		});

		it('system 언어를 설정할 수 있다', async () => {
			await setLanguage('system');
			expect(getLanguage()).toBe('system');
		});
	});

	describe('t (번역)', () => {
		it('현재 언어의 번역을 반환한다', async () => {
			await setLanguage('ko');
			expect(t('settings.chat.memoryMethod' as any)).toBe('메모리 방식');
		});

		it('템플릿 변수를 치환한다', async () => {
			await setLanguage('en');
			expect(t('greeting' as any, { name: 'Alice' })).toBe('Hello Alice');
			
			await setLanguage('ko');
			expect(t('greeting' as any, { name: 'Alice' })).toBe('안녕하세요 Alice');
		});

		it('해당 키가 없으면 en으로 폴백한다', async () => {
			addDynamicLocale('ko', {
				settings: {}
			} as any);
			await setLanguage('ko');
			expect(t('settings.chat.memoryMethod' as any)).toBe('Memory Method');
		});

		it('en에도 키가 없으면 키 경로 자체를 반환한다', async () => {
			await setLanguage('en');
			expect(t('non.existent.key' as any)).toBe('non.existent.key');
		});

		it('system 언어일 때 fallback이 올바르게 동작한다', async () => {
			await setLanguage('system');
			// system 로케일 데이터가 로드되어 있지 않으므로 en으로 fallback되어야 함
			expect(t('settings.chat.memoryMethod' as any)).toBe('Memory Method');
		});
	});

	describe('getSystemLocale', () => {
		it('navigator.language를 반환한다', () => {
			expect(getSystemLocale()).toBe('ko-KR');
		});

		it('navigator.language가 없으면 Unknown을 반환한다', () => {
			vi.stubGlobal('navigator', {});
			expect(getSystemLocale()).toBe('Unknown');
		});
	});

	describe('getLangSuffix', () => {
		it('system이 아닐 때 언어 코드를 대문자로 반환한다', () => {
			expect(getLangSuffix('ko')).toBe('KO');
			expect(getLangSuffix('zh-tw')).toBe('ZH_TW');
		});

		it('system일 때 navigator 언어에 맞춰 반환한다', () => {
			vi.stubGlobal('navigator', { language: 'ko-KR' });
			expect(getLangSuffix('system')).toBe('KO');

			vi.stubGlobal('navigator', { language: 'zh-tw' });
			expect(getLangSuffix('system')).toBe('ZH_TW');

			vi.stubGlobal('navigator', { language: 'zh-CN' });
			expect(getLangSuffix('system')).toBe('ZH');
		});
	});
});
