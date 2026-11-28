import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	optimizeSearchQueries,
	generateBroadFallbackQuery,
	sanitizeRewrittenQueries,
	resetQueryOptimizerCircuitBreaker,
} from './queryOptimizer';
import type { LLMProviderConfig } from '../../shared/types/settings.types';
import { createProvider } from '../../core/llm-providers';

vi.mock('../../core/llm-providers', () => ({
	createProvider: vi.fn(),
}));

describe('queryOptimizer (Fail-Safe Guardrails)', () => {
	const mockConfig: LLMProviderConfig = {
		id: 'task-provider-1',
		type: 'openai',
		credential: 'test-key',
		availableModels: ['small-local-model'],
		isVerified: true,
	};

	beforeEach(() => {
		vi.clearAllMocks();
		resetQueryOptimizerCircuitBreaker();
	});

	describe('sanitizeRewrittenQueries', () => {
		it('추론 모델의 <think> 블록과 코드펜스·번호를 제거하고 유효한 쿼리만 추출한다', () => {
			const raw = `<think>
사용자의 질문에서 핵심 개념을 생각해 봅시다...
</think>
\`\`\`
1. "Obsidian Lumina RAG architecture"
2. 'Lumina vector indexing pipeline'
\`\`\``;
			const result = sanitizeRewrittenQueries(raw, '아키텍처 알려줘', 2);
			expect(result).toEqual([
				'Obsidian Lumina RAG architecture',
				'Lumina vector indexing pipeline',
			]);
		});

		it('거절 문구, 사족, 과도하게 긴 문자열, 원문과 동일한 문자열을 걸러낸다', () => {
			const raw = [
				'I am sorry, I cannot assist with that request.',
				'Here are the search queries:',
				'물론입니다. 다음은 검색어입니다.',
				'기존 질문',
				'A'.repeat(300),
				'유효한 확장 검색어',
			].join('\n');
			const result = sanitizeRewrittenQueries(raw, '기존 질문', 2);
			expect(result).toEqual(['유효한 확장 검색어']);
		});

		it('닫히지 않은 <think> 태그만 출력한 경우 빈 배열을 반환한다', () => {
			const raw = '<think>생각만 하다가 토큰 한도에 걸려 끊김';
			expect(sanitizeRewrittenQueries(raw, '질문', 2)).toEqual([]);
		});
	});

	describe('optimizeSearchQueries', () => {
		it('대화 맥락과 짧은 후속 질문을 반영해 높은 가중치(0.85)의 확장 쿼리를 반환한다', async () => {
			const mockProvider = {
				chat: vi.fn().mockResolvedValue({
					content: 'Lumina v2 출시 일정\nLumina v2 로드맵',
				}),
			};
			vi.mocked(createProvider).mockReturnValue(mockProvider as unknown as ReturnType<typeof createProvider>);

			const result = await optimizeSearchQueries({
				userText: '그거 일정 알려줘',
				recentHistory: [{ role: 'user', content: 'Lumina v2 프로젝트 현황 정리해줘' }],
				providerConfig: mockConfig,
				modelId: 'gpt-4o-mini',
			});

			expect(result.status).toBe('ok');
			expect(result.extraQueries).toEqual([
				{ query: 'Lumina v2 출시 일정', weight: 0.85 },
				{ query: 'Lumina v2 로드맵', weight: 0.85 },
			]);
		});

		it('타임아웃 발생 시 예외를 던지지 않고 빈 배열로 안전 폴백한다', async () => {
			const mockProvider = {
				chat: vi.fn().mockImplementation(
					(_msgs: unknown, opts?: { signal?: AbortSignal }) =>
						new Promise((_resolve, reject) => {
							opts?.signal?.addEventListener('abort', () => {
								reject(new DOMException('Aborted', 'AbortError'));
							});
						}),
				),
			};
			vi.mocked(createProvider).mockReturnValue(mockProvider as unknown as ReturnType<typeof createProvider>);

			const result = await optimizeSearchQueries({
				userText: '느린 모델 테스트',
				providerConfig: mockConfig,
				modelId: 'slow-model',
				timeoutMs: 25,
			});

			expect(result.status).toBe('timeout');
			expect(result.extraQueries).toEqual([]);
		});

		it('연속 3회 실패 시 서킷 브레이커가 열려 4번째 호출부터 LLM을 호출하지 않고 0ms 바이패스한다', async () => {
			const mockProvider = {
				chat: vi.fn().mockResolvedValue({
					content: 'Sorry, I cannot help with that.',
				}),
			};
			vi.mocked(createProvider).mockReturnValue(mockProvider as unknown as ReturnType<typeof createProvider>);

			for (let i = 0; i < 3; i++) {
				const res = await optimizeSearchQueries({
					userText: `질문 ${i}`,
					providerConfig: mockConfig,
					modelId: 'broken-1b',
				});
				expect(res.status).toBe('invalid_output');
			}
			expect(mockProvider.chat).toHaveBeenCalledTimes(3);

			// 4번째 호출은 서킷 오픈으로 즉시 바이패스
			const fourth = await optimizeSearchQueries({
				userText: '질문 4',
				providerConfig: mockConfig,
				modelId: 'broken-1b',
			});
			expect(fourth.status).toBe('circuit_open');
			expect(fourth.extraQueries).toEqual([]);
			expect(mockProvider.chat).toHaveBeenCalledTimes(3);

			// 다른 모델로 전환하면 즉시 정상 동작
			mockProvider.chat.mockResolvedValueOnce({ content: '정상 재작성 쿼리' });
			const switched = await optimizeSearchQueries({
				userText: '질문 5',
				providerConfig: mockConfig,
				modelId: 'healthy-model',
			});
			expect(switched.status).toBe('ok');
			expect(switched.extraQueries).toHaveLength(1);
		});

		it('모델이 원문과 동일한 쿼리를 반환하면 unchanged로 처리하고 서킷 브레이커를 열지 않는다', async () => {
			const mockProvider = {
				chat: vi.fn().mockResolvedValue({
					content: '연차 이월 규정',
				}),
			};
			vi.mocked(createProvider).mockReturnValue(mockProvider as unknown as ReturnType<typeof createProvider>);

			for (let i = 0; i < 4; i++) {
				const res = await optimizeSearchQueries({
					userText: '연차 이월 규정',
					providerConfig: mockConfig,
					modelId: 'literal-model',
				});
				expect(res.status).toBe('unchanged');
				expect(res.extraQueries).toEqual([]);
			}
			expect(mockProvider.chat).toHaveBeenCalledTimes(4);
		});

		it('이전 대화 이력의 <think> 블록을 제거한 뒤 본문 맥락을 프롬프트에 포함한다', async () => {
			const mockProvider = {
				chat: vi.fn().mockResolvedValue({
					content: '알파 프로젝트 보관 주기',
				}),
			};
			vi.mocked(createProvider).mockReturnValue(mockProvider as unknown as ReturnType<typeof createProvider>);

			const longThink = '<think>' + '생각중 '.repeat(80) + '</think>\n알파 프로젝트는 18개월 보관입니다.';
			await optimizeSearchQueries({
				userText: '그거 몇 개월?',
				recentHistory: [{ role: 'assistant', content: longThink }],
				providerConfig: mockConfig,
				modelId: 'gpt-4o-mini',
			});

			const sentPrompt = mockProvider.chat.mock.calls[0][0][0].content as string;
			expect(sentPrompt).not.toContain('<think>');
			expect(sentPrompt).toContain('알파 프로젝트는 18개월 보관입니다.');
		});
	});

	describe('generateBroadFallbackQuery', () => {
		it('CRAG 1회 재검색용 넓은 키워드 쿼리를 반환하고 실패 시 null을 반환한다', async () => {
			const mockProvider = {
				chat: vi.fn()
					.mockResolvedValueOnce({ content: '벡터 검색 임베딩 오라마' })
					.mockRejectedValueOnce(new Error('Network down')),
			};
			vi.mocked(createProvider).mockReturnValue(mockProvider as unknown as ReturnType<typeof createProvider>);

			const okQuery = await generateBroadFallbackQuery({
				userText: 'Orama에서 코사인 유사도 계산은 어떻게 되나요?',
				providerConfig: mockConfig,
				modelId: 'gpt-4o-mini',
			});
			expect(okQuery).toBe('벡터 검색 임베딩 오라마');

			const failQuery = await generateBroadFallbackQuery({
				userText: 'Orama에서 코사인 유사도 계산은 어떻게 되나요?',
				providerConfig: mockConfig,
				modelId: 'gpt-4o-mini',
			});
			expect(failQuery).toBeNull();
		});
	});
});
