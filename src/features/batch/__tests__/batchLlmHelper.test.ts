/**
 * batchLlmHelper.test.ts
 *
 * Batch Studio 공용 LLM 헬퍼의 프로바이더 우선순위 선택, 프론트매터 분리,
 * Rate limit(429) 판별, JSON 추출, <think> 제거 및 로깅 처리를 검증합니다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type LuminaPlugin from '../../../main';
import { DEFAULT_SETTINGS } from '../../../core/settings/defaultSettings';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';

vi.mock('../../../core/llm-providers', () => ({
	createProvider: vi.fn(),
}));

import { createProvider } from '../../../core/llm-providers';
import {
	callBatchLlm,
	extractJsonObject,
	getBatchEligibleProviders,
	isRateLimitError,
	resolveBatchProviderAndModel,
	splitFrontmatterAndBody,
} from '../recipes/batchLlmHelper';

function makeProvider(overrides: Partial<LLMProviderConfig>): LLMProviderConfig {
	return {
		id: 'prov-1',
		type: 'openai',
		credential: 'sk-test',
		availableModels: ['gpt-4o-mini'],
		isVerified: true,
		...overrides,
	};
}

function makePlugin(providers: LLMProviderConfig[]): LuminaPlugin {
	const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS;
	settings.connections.providers = providers;
	return { settings } as unknown as LuminaPlugin;
}

describe('batchLlmHelper', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('getBatchEligibleProviders는 CLI·미인증·빈 모델 프로바이더를 제외하고 임베딩 모델을 필터링한다', () => {
		const cliProv = makeProvider({ id: 'cli', type: 'cli-claude-code', availableModels: ['claude-sonnet'] });
		const unverified = makeProvider({ id: 'unv', isVerified: false });
		const noModels = makeProvider({ id: 'empty', availableModels: [] });
		const mixed = makeProvider({
			id: 'mixed',
			type: 'openai',
			availableModels: ['text-embedding-3-small', 'gpt-4o'],
		});

		const eligible = getBatchEligibleProviders([cliProv, unverified, noModels, mixed]);
		expect(eligible.map((p) => p.id)).toEqual(['mixed']);
		expect(eligible[0].availableModels).toEqual(['gpt-4o']);
	});

	it('resolveBatchProviderAndModel은 explicit > task > quickAction > 첫 번째 검증 모델 순으로 선택한다', () => {
		const p1 = makeProvider({ id: 'p1', availableModels: ['m1'] });
		const p2 = makeProvider({ id: 'p2', availableModels: ['m2'] });
		const p3 = makeProvider({ id: 'p3', availableModels: ['m3'] });
		const plugin = makePlugin([p1, p2, p3]);
		plugin.settings.connections.taskProviderId = 'p2';
		plugin.settings.connections.taskModelId = 'task-model';
		plugin.settings.connections.quickActionProviderId = 'p3';
		plugin.settings.connections.quickActionModelId = 'qa-model';

		// 1) 명시 옵션 우선
		const r1 = resolveBatchProviderAndModel(plugin, { providerId: 'p1', modelId: 'explicit-m' });
		expect(r1.providerConfig.id).toBe('p1');
		expect(r1.modelId).toBe('explicit-m');

		// 2) Task 모델 폴백
		const r2 = resolveBatchProviderAndModel(plugin, { providerId: '', modelId: '' });
		expect(r2.providerConfig.id).toBe('p2');
		expect(r2.modelId).toBe('task-model');

		// 3) Quick Action 모델 폴백
		plugin.settings.connections.taskProviderId = '';
		const r3 = resolveBatchProviderAndModel(plugin, { providerId: '', modelId: '' });
		expect(r3.providerConfig.id).toBe('p3');
		expect(r3.modelId).toBe('qa-model');

		// 4) 첫 번째 활성 프로바이더 폴백
		plugin.settings.connections.quickActionProviderId = '';
		const r4 = resolveBatchProviderAndModel(plugin, { providerId: '', modelId: '' });
		expect(r4.providerConfig.id).toBe('p1');
		expect(r4.modelId).toBe('m1');
	});

	it('사용 가능한 검증된 프로바이더가 없으면 에러를 던진다', () => {
		const plugin = makePlugin([]);
		expect(() => resolveBatchProviderAndModel(plugin, { providerId: '', modelId: '' })).toThrow();
	});

	it('splitFrontmatterAndBody는 LF, CRLF, 프론트매터 없음 케이스를 정확히 분리한다', () => {
		const lf = splitFrontmatterAndBody('---\ntitle: Test\n---\n본문 내용');
		expect(lf).toEqual({ frontmatterBlock: '---\ntitle: Test\n---\n', body: '본문 내용' });

		const crlf = splitFrontmatterAndBody('---\r\ntitle: Win\r\n---\r\n윈도우 본문');
		expect(crlf).toEqual({ frontmatterBlock: '---\r\ntitle: Win\r\n---\r\n', body: '윈도우 본문' });

		const plain = splitFrontmatterAndBody('# 제목만 있는 노트');
		expect(plain).toEqual({ frontmatterBlock: '', body: '# 제목만 있는 노트' });
	});

	it('isRateLimitError는 429 상태/메시지와 일반 오류를 정확히 구분한다', () => {
		expect(isRateLimitError(Object.assign(new Error('Too fast'), { status: 429 }))).toBe(true);
		expect(isRateLimitError(new Error('HTTP 429 from upstream'))).toBe(true);
		expect(isRateLimitError(new Error('Rate limit exceeded'))).toBe(true);
		expect(isRateLimitError(new Error('HTTP 500 internal error'))).toBe(false);
		expect(isRateLimitError(Object.assign(new Error('Forbidden'), { status: 403 }))).toBe(false);
	});

	it('extractJsonObject는 코드펜스와 주변 텍스트가 있어도 JSON 객체를 파싱하며 실패 시 throw한다', () => {
		expect(extractJsonObject('```json\n{"tags":["a","b"]}\n```')).toEqual({ tags: ['a', 'b'] });
		expect(extractJsonObject('설명 문구입니다.\n{"ok": true}\n끝')).toEqual({ ok: true });
		expect(() => extractJsonObject('JSON이 전혀 없는 응답')).toThrow('LLM did not return a valid JSON object.');
		expect(() => extractJsonObject('{broken json')).toThrow();
	});

	it('callBatchLlm은 <think> 및 이스케이프 태그를 제거하고 토큰 사용량을 반환한다', async () => {
		const plugin = makePlugin([makeProvider({ id: 'p1', availableModels: ['gpt-4o-mini'] })]);
		vi.mocked(createProvider).mockReturnValue({
			chat: vi.fn().mockResolvedValue({
				content: '<think>내부 추론</think>&lt;think&gt;추가 추론&lt;/think&gt;\n{"result":"ok"}',
				usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
				finishReason: 'stop',
			}),
		} as unknown as ReturnType<typeof createProvider>);

		const res = await callBatchLlm(plugin, { providerId: 'p1', modelId: 'gpt-4o-mini' }, 'a.md', 'Test', 'prompt');
		expect(res).toEqual({
			text: '{"result":"ok"}',
			tokensUsed: 150,
		});
	});

	it('callBatchLlm은 provider.chat 실패 시 에러를 그대로 다시 던진다', async () => {
		const plugin = makePlugin([makeProvider({ id: 'p1', availableModels: ['gpt-4o-mini'] })]);
		vi.mocked(createProvider).mockReturnValue({
			chat: vi.fn().mockRejectedValue(new Error('API timeout')),
		} as unknown as ReturnType<typeof createProvider>);

		await expect(
			callBatchLlm(plugin, { providerId: 'p1', modelId: 'gpt-4o-mini' }, 'a.md', 'Test', 'prompt'),
		).rejects.toThrow('API timeout');
	});

	it('callBatchLlm은 extraOptions의 responseFormat과 reasoning을 provider.chat 옵션으로 전달한다', async () => {
		const plugin = makePlugin([makeProvider({ id: 'p1', availableModels: ['gpt-4o-mini'] })]);
		const chatSpy = vi.fn().mockResolvedValue({
			content: '{"ok":true}',
			usage: { totalTokens: 10 },
		});
		vi.mocked(createProvider).mockReturnValue({ chat: chatSpy } as unknown as ReturnType<typeof createProvider>);

		const responseFormat = {
			type: 'json_schema' as const,
			jsonSchema: {
				name: 'test_schema',
				schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
				strict: true,
			},
		};

		await callBatchLlm(
			plugin,
			{ providerId: 'p1', modelId: 'gpt-4o-mini' },
			'a.md',
			'Test',
			'prompt',
			undefined,
			500,
			{ responseFormat, reasoning: { effort: 'off' } },
		);

		expect(chatSpy).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({
				maxOutputTokens: 500,
				responseFormat,
				reasoning: { effort: 'off' },
			}),
		);
	});
});
