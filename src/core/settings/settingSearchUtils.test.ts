import { describe, it, expect } from 'vitest';
import {
	expandQueryTerms,
	buildTranslationIndex,
	isSettingItemMatchBilingual,
	BILINGUAL_KEYWORDS,
	LOCALE_SYNONYMS,
	COMMON_SYNONYMS,
} from './settingSearchUtils';

describe('settingSearchUtils', () => {
	describe('expandQueryTerms', () => {
		it('returns empty array for empty query', () => {
			expect(expandQueryTerms('')).toEqual([]);
			expect(expandQueryTerms('   ')).toEqual([]);
		});

		it('expands "model" to include "모델"', () => {
			const terms = expandQueryTerms('model');
			expect(terms).toContain('model');
			expect(terms).toContain('모델');
		});

		it('expands "모델" to include "model"', () => {
			const terms = expandQueryTerms('모델');
			expect(terms).toContain('모델');
			expect(terms).toContain('model');
		});

		it('expands "temperature" to include "온도"', () => {
			const terms = expandQueryTerms('temperature');
			expect(terms).toContain('temperature');
			expect(terms).toContain('온도');
		});

		it('expands "chat" to include "채팅"', () => {
			const terms = expandQueryTerms('chat');
			expect(terms).toContain('chat');
			expect(terms).toContain('채팅');
		});

		it('expands multi-word query', () => {
			const terms = expandQueryTerms('chat model');
			expect(terms).toContain('chat model');
			expect(terms).toContain('chat');
			expect(terms).toContain('채팅');
			expect(terms).toContain('model');
			expect(terms).toContain('모델');
		});

		it('expands Japanese query when ja locale is specified', () => {
			const terms = expandQueryTerms('chat', 'ja');
			expect(terms).toContain('chat');
			expect(terms).toContain('チャット');
			expect(terms).not.toContain('채팅');
		});

		it('expands Simplified Chinese query when zh locale is specified', () => {
			const terms = expandQueryTerms('model', 'zh');
			expect(terms).toContain('model');
			expect(terms).toContain('模型');
			expect(terms).not.toContain('モデル');
		});

		it('expands Traditional Chinese query when zh-tw locale is specified', () => {
			const terms = expandQueryTerms('search', 'zh-tw');
			expect(terms).toContain('search');
			expect(terms).toContain('搜尋');
		});

		it('expands common technical synonyms across all languages', () => {
			const terms = expandQueryTerms('temp');
			expect(terms).toContain('temp');
			expect(terms).toContain('temperature');
		});
	});

	describe('buildTranslationIndex', () => {
		it('builds bidirectional mapping between current and en locales', () => {
			const current = {
				settings: {
					connections: {
						defaultChatModel: {
							name: '기본 채팅 모델',
							desc: '대화에 사용할 모델',
						},
					},
				},
			};
			const en = {
				settings: {
					connections: {
						defaultChatModel: {
							name: 'Default Chat Model',
							desc: 'Model to use for conversations',
						},
					},
				},
			};

			const map = buildTranslationIndex(current, en);

			expect(map.get('기본 채팅 모델')).toBe('default chat model');
			expect(map.get('default chat model')).toBe('기본 채팅 모델');
			expect(map.get('대화에 사용할 모델')).toBe('model to use for conversations');
			expect(map.get('model to use for conversations')).toBe('대화에 사용할 모델');
		});
	});

	describe('isSettingItemMatchBilingual', () => {
		const translationMap = new Map<string, string>([
			['기본 채팅 모델', 'default chat model'],
			['default chat model', '기본 채팅 모델'],
			['리랭커 모델 (선택)', 'reranker model (optional)'],
			['reranker model (optional)', '리랭커 모델 (선택)'],
			['온도 (temperature)', 'temperature'],
			['temperature', '온도 (temperature)'],
			['대화에 기본으로 사용할 채팅 모델을 선택합니다.', 'select the default chat model for conversations.'],
		]);

		it('matches Korean setting name when searching with English "model"', () => {
			const queryTerms = expandQueryTerms('model');
			const matched = isSettingItemMatchBilingual(
				'기본 채팅 모델',
				'설정 설명입니다.',
				'',
				queryTerms,
				translationMap
			);
			expect(matched).toBe(true);
		});

		it('matches Korean setting name when searching with Korean "모델"', () => {
			const queryTerms = expandQueryTerms('모델');
			const matched = isSettingItemMatchBilingual(
				'기본 채팅 모델',
				'설정 설명입니다.',
				'',
				queryTerms,
				translationMap
			);
			expect(matched).toBe(true);
		});

		it('matches Korean setting name when searching with English "temperature"', () => {
			const queryTerms = expandQueryTerms('temperature');
			const matched = isSettingItemMatchBilingual(
				'온도 (Temperature)',
				'창의성 조절',
				'',
				queryTerms,
				translationMap
			);
			expect(matched).toBe(true);
		});

		it('matches Korean setting name when searching with Korean "온도"', () => {
			const queryTerms = expandQueryTerms('온도');
			const matched = isSettingItemMatchBilingual(
				'온도 (Temperature)',
				'창의성 조절',
				'',
				queryTerms,
				translationMap
			);
			expect(matched).toBe(true);
		});

		it('matches when query is in description in English', () => {
			const queryTerms = expandQueryTerms('conversations');
			const matched = isSettingItemMatchBilingual(
				'기본 설정',
				'대화에 기본으로 사용할 채팅 모델을 선택합니다.',
				'',
				queryTerms,
				translationMap
			);
			expect(matched).toBe(true);
		});

		it('matches Japanese setting with English search term', () => {
			const jaMap = new Map<string, string>([
				['デフォルトチャットモデル', 'default chat model'],
				['default chat model', 'デフォルトチャットモデル'],
			]);
			const queryTerms = expandQueryTerms('chat', 'ja');
			const matched = isSettingItemMatchBilingual(
				'デフォルトチャットモデル',
				'モデルの設定です。',
				'',
				queryTerms,
				jaMap
			);
			expect(matched).toBe(true);
		});

		it('does not match unrelated query', () => {
			const queryTerms = expandQueryTerms('xyzcompletelyunrelated');
			const matched = isSettingItemMatchBilingual(
				'기본 채팅 모델',
				'설정 설명입니다.',
				'',
				queryTerms,
				translationMap
			);
			expect(matched).toBe(false);
		});
	});
});
