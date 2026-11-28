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

		it('Gemma 4 채널/사고 태그(<|channel>thought, <|thought|>, <thought>)와 마크다운 굵게/백틱을 제거한다', () => {
			const raw = `<|channel>thought
Thinking about the user's follow-up query...
<channel|>
1. **프로젝트A 비상연락망**
2. \`김철수 연락처\``;
			expect(sanitizeRewrittenQueries(raw, '그거 번호 뭐야', 2)).toEqual([
				'프로젝트A 비상연락망',
				'김철수 연락처',
			]);

			const rawThoughtTag = '<thought>내부 추론 중</thought>\n사내 서버 이전 계획';
			expect(sanitizeRewrittenQueries(rawThoughtTag, '이전 계획 알려줘', 2)).toEqual([
				'사내 서버 이전 계획',
			]);
		});

		it('Tier 1(<q>...</q>): 장황한 사족이나 같은 줄 나열에서도 태그 내부 검색어만 정확히 추출한다', () => {
			const raw = `물론입니다! 대화 문맥을 바탕으로 검색어를 정리해 드릴게요.
아래 태그를 참고하세요:
<q>프로젝트A 비상연락망</q> <q>김철수 내선번호</q>
도움이 되셨길 바랍니다.`;
			expect(sanitizeRewrittenQueries(raw, '그거 번호?', 2)).toEqual([
				'프로젝트A 비상연락망',
				'김철수 내선번호',
			]);
		});

		it('Tier 2(JSON): 사족 뒤에 붙은 JSON queries 객체 또는 문자열 배열에서 검색어를 추출한다', () => {
			const rawObj = '검색 쿼리는 다음과 같습니다:\n{"queries": ["알파 프로젝트 일정", "알파 로드맵"]}';
			expect(sanitizeRewrittenQueries(rawObj, '그거 언제야', 2)).toEqual([
				'알파 프로젝트 일정',
				'알파 로드맵',
			]);

			const rawArr = '["서버 이전 계획", "담당자 연락처"]';
			expect(sanitizeRewrittenQueries(rawArr, '어디야', 2)).toEqual([
				'서버 이전 계획',
				'담당자 연락처',
			]);
		});

		it('프롬프트의 1-shot 예시를 그대로 따라 출력(echo)한 경우 필터링한다', () => {
			const raw = '<q>Q3 launch plan deadline</q>\n<q>실제 사용자 검색어</q>';
			expect(sanitizeRewrittenQueries(raw, '질문', 2)).toEqual(['실제 사용자 검색어']);
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

		it('사고 블록만 출력되고 본문 없이 잘린 경우 reason을 thinking_only_truncated로 기록한다', async () => {
			const mockProvider = {
				chat: vi.fn().mockResolvedValue({
					content: '<|channel>thought\n계속 생각 중...',
				}),
			};
			vi.mocked(createProvider).mockReturnValue(mockProvider as unknown as ReturnType<typeof createProvider>);

			const res = await optimizeSearchQueries({
				userText: '그거 뭐야',
				providerConfig: mockConfig,
				modelId: 'gemma4:e2b-mlx',
			});

			expect(res.status).toBe('invalid_output');
			expect(res.reason).toBe('thinking_only_truncated');
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
