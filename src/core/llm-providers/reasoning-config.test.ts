import { describe, it, expect } from 'vitest';
import {
	resolveOpenAIReasoningEffort,
	resolveAnthropicThinking,
	resolveGeminiThinkingConfig,
	getModelReasoningSupport,
	isAnyModelReasoningSupported,
	describeEffectiveReasoning,
	formatReasoningForDebugLog,
} from './reasoning-config';

describe('reasoning-config', () => {
	describe('OpenAI reasoning_effort mapping', () => {
		it('auto 이거나 비추론 모델이면 undefined를 반환한다', () => {
			expect(resolveOpenAIReasoningEffort('o3', { effort: 'auto' })).toBeUndefined();
			expect(resolveOpenAIReasoningEffort('gpt-4o', { effort: 'high' })).toBeUndefined();
			expect(resolveOpenAIReasoningEffort('gpt-4.1', { effort: 'medium' })).toBeUndefined();
			expect(resolveOpenAIReasoningEffort('gpt-5-search-api', { effort: 'low' })).toBeUndefined();
		});

		it('o1/o3/o4 시리즈는 low/medium/high만 전달하고 off는 생략한다', () => {
			expect(resolveOpenAIReasoningEffort('o3-mini', { effort: 'low' })).toBe('low');
			expect(resolveOpenAIReasoningEffort('o4-mini', { effort: 'high' })).toBe('high');
			expect(resolveOpenAIReasoningEffort('o3', { effort: 'off' })).toBeUndefined();
		});

		it('gpt-5.0 계열은 off를 minimal로, gpt-5.1+는 off를 none으로 매핑한다', () => {
			expect(resolveOpenAIReasoningEffort('gpt-5', { effort: 'off' })).toBe('minimal');
			expect(resolveOpenAIReasoningEffort('gpt-5-mini', { effort: 'off' })).toBe('minimal');
			expect(resolveOpenAIReasoningEffort('gpt-5.1', { effort: 'off' })).toBe('none');
			expect(resolveOpenAIReasoningEffort('gpt-5.2-pro', { effort: 'off' })).toBe('none');
			expect(resolveOpenAIReasoningEffort('gpt-5.2', { effort: 'high' })).toBe('high');
		});
	});

	describe('Anthropic thinking mapping', () => {
		it('auto 이거나 Claude 3.5 이하 비지원 모델이면 undefined를 반환한다', () => {
			expect(resolveAnthropicThinking('claude-sonnet-4-5', { effort: 'auto' })).toBeUndefined();
			expect(resolveAnthropicThinking('claude-3-5-sonnet-latest', { effort: 'high' })).toBeUndefined();
			expect(resolveAnthropicThinking('claude-3-haiku-20240307', { effort: 'low' })).toBeUndefined();
		});

		it('off 요청 시 지원 모델에 대해 thinking.type=disabled를 반환한다', () => {
			expect(resolveAnthropicThinking('claude-opus-4-5', { effort: 'off' })).toEqual({
				thinking: { type: 'disabled' },
				omitTemperature: false,
			});
			expect(resolveAnthropicThinking('claude-opus-4-7', { effort: 'off' })).toEqual({
				thinking: { type: 'disabled' },
				omitTemperature: false,
			});
		});

		it('Claude 3.7~4.5는 enabled+budget_tokens를 사용하고 max_tokens를 안전 보정한다', () => {
			const res = resolveAnthropicThinking('claude-sonnet-4-20250514', { effort: 'medium' }, 4000);
			expect(res).toEqual({
				thinking: { type: 'enabled', budget_tokens: 8192 },
				omitTemperature: true,
				adjustedMaxTokens: 12192,
			});

			const custom = resolveAnthropicThinking(
				'claude-3-7-sonnet-20250219',
				{ effort: 'low', budgetTokens: 500 },
				10000,
			);
			expect(custom).toEqual({
				thinking: { type: 'enabled', budget_tokens: 1024 },
				omitTemperature: true,
				adjustedMaxTokens: 10000,
			});
		});

		it('Claude 4.6은 기본 adaptive이며 수동 budget 지정 시 enabled로 전환한다', () => {
			expect(resolveAnthropicThinking('claude-sonnet-4-6', { effort: 'high' }, 4000)).toEqual({
				thinking: { type: 'adaptive' },
				outputConfig: { effort: 'high' },
				omitTemperature: true,
			});

			expect(
				resolveAnthropicThinking('claude-opus-4-6', { effort: 'medium', budgetTokens: 6000 }, 4000),
			).toEqual({
				thinking: { type: 'enabled', budget_tokens: 6000 },
				omitTemperature: true,
				adjustedMaxTokens: 10000,
			});
		});

		it('Claude 4.7+ 및 5+는 adaptive+summarized와 output_config.effort를 사용하며 수동 budget은 무시한다', () => {
			expect(
				resolveAnthropicThinking('claude-opus-4-7', { effort: 'high', budgetTokens: 16000 }, 4000),
			).toEqual({
				thinking: { type: 'adaptive', display: 'summarized' },
				outputConfig: { effort: 'high' },
				omitTemperature: true,
			});

			expect(resolveAnthropicThinking('claude-sonnet-5-5', { effort: 'low' }, 4000)).toEqual({
				thinking: { type: 'adaptive', display: 'summarized' },
				outputConfig: { effort: 'low' },
				omitTemperature: true,
			});
		});
	});

	describe('Google Gemini thinkingConfig mapping', () => {
		it('auto 이거나 Gemini 2.0/1.5 비추론 모델이면 undefined를 반환한다', () => {
			expect(resolveGeminiThinkingConfig('gemini-2.5-flash', { effort: 'auto' })).toBeUndefined();
			expect(resolveGeminiThinkingConfig('gemini-2.0-flash', { effort: 'high' })).toBeUndefined();
			expect(resolveGeminiThinkingConfig('gemini-1.5-pro', { effort: 'medium' })).toBeUndefined();
			expect(resolveGeminiThinkingConfig('gemini-embedding-001', { effort: 'high' })).toBeUndefined();
		});

		it('Gemini 2.5 Flash는 thinkingBudget=0으로 off가 가능하고 Pro는 최소 128로 클램핑한다', () => {
			expect(resolveGeminiThinkingConfig('gemini-2.5-flash', { effort: 'off' })).toEqual({
				thinkingBudget: 0,
			});
			expect(resolveGeminiThinkingConfig('models/gemini-2.5-pro', { effort: 'off' })).toEqual({
				thinkingBudget: 128,
			});
			expect(
				resolveGeminiThinkingConfig('gemini-2.5-flash', { effort: 'medium', budgetTokens: 4096 }),
			).toEqual({
				thinkingBudget: 4096,
				includeThoughts: true,
			});
		});

		it('Gemini 3+는 thinkingLevel만 사용하고 thinkingBudget을 절대 포함하지 않는다', () => {
			const flashOff = resolveGeminiThinkingConfig('gemini-3-flash-preview', { effort: 'off' });
			expect(flashOff).toEqual({ thinkingLevel: 'minimal' });
			expect(flashOff?.thinkingBudget).toBeUndefined();

			const proOff = resolveGeminiThinkingConfig('gemini-3-pro-preview', { effort: 'off' });
			expect(proOff).toEqual({ thinkingLevel: 'low' });

			// 초기 gemini-3-pro의 medium은 high로 안전 폴백
			expect(resolveGeminiThinkingConfig('gemini-3-pro-preview', { effort: 'medium' })).toEqual({
				thinkingLevel: 'high',
				includeThoughts: true,
			});

			expect(
				resolveGeminiThinkingConfig('gemini-3.1-pro-preview', { effort: 'medium', budgetTokens: 12000 }),
			).toEqual({
				thinkingLevel: 'medium',
				includeThoughts: true,
			});
		});
	});

	describe('UI support & summary helpers', () => {
		it('직접 Cloud API 지원 모델만 supported=true를 반환한다', () => {
			expect(getModelReasoningSupport('openai', 'gpt-5.2').supported).toBe(true);
			expect(getModelReasoningSupport('openai', 'gpt-4o').supported).toBe(false);
			expect(getModelReasoningSupport('openrouter', 'openai/o3').supported).toBe(false);
			expect(getModelReasoningSupport('anthropic', 'claude-opus-4-7')).toEqual({
				supported: true,
				provider: 'anthropic',
				mode: 'anthropic_adaptive_47',
				supportsCustomBudget: false,
			});
			expect(getModelReasoningSupport('google', 'gemini-2.5-flash')).toEqual({
				supported: true,
				provider: 'google',
				mode: 'gemini_budget',
				supportsCustomBudget: true,
			});

			expect(
				isAnyModelReasoningSupported([
					{ providerType: 'openai', modelId: 'gpt-4o' },
					{ providerType: 'google', modelId: 'gemini-3-flash' },
				]),
			).toBe(true);
			expect(
				isAnyModelReasoningSupported([
					{ providerType: 'openai', modelId: 'gpt-4o' },
					{ providerType: 'ollama', modelId: 'deepseek-r1' },
				]),
			).toBe(false);
		});

		it('describeEffectiveReasoning이 모델별 실효 요약 키를 반환한다', () => {
			expect(describeEffectiveReasoning('openai', 'o3', 'off')).toEqual({
				key: 'summaryOffOpenAIUnsupported',
			});
			expect(describeEffectiveReasoning('anthropic', 'claude-opus-4-7', 'high')).toEqual({
				key: 'summaryAnthropicAdaptive',
				params: { effort: 'high' },
			});
			expect(describeEffectiveReasoning('google', 'gemini-2.5-pro', 'off')).toEqual({
				key: 'summaryOffGeminiProMin',
			});
		});

		it('formatReasoningForDebugLog가 프로바이더별 실효 파라미터 요약 또는 undefined를 반환한다', () => {
			expect(formatReasoningForDebugLog('openai', 'o3', { effort: 'auto' })).toBeUndefined();
			expect(formatReasoningForDebugLog('openai', 'gpt-4o', { effort: 'high' })).toBeUndefined();
			expect(formatReasoningForDebugLog('openrouter', 'openai/o3', { effort: 'high' })).toBeUndefined();

			expect(formatReasoningForDebugLog('openai', 'o3', { effort: 'off' })).toBe('off (omitted)');
			expect(formatReasoningForDebugLog('openai', 'gpt-5.2', { effort: 'high' })).toBe('reasoning_effort=high');

			expect(
				formatReasoningForDebugLog('anthropic', 'claude-sonnet-4-5', { effort: 'medium' }, 4000),
			).toBe('thinking={"type":"enabled","budget_tokens":8192}, max_tokens=12192');

			expect(
				formatReasoningForDebugLog('anthropic', 'claude-opus-4-7', { effort: 'high' }, 4000),
			).toBe('thinking={"type":"adaptive","display":"summarized"}, output_config={"effort":"high"}');

			expect(
				formatReasoningForDebugLog('google', 'gemini-3-flash-preview', { effort: 'low' }),
			).toBe('thinkingConfig={"thinkingLevel":"low","includeThoughts":true}');
		});
	});
});
