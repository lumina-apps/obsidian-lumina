/**
 * reasoning-config.ts
 * Cloud 직접 API 3사(OpenAI, Anthropic, Google Gemini)의 모델 세대별
 * Reasoning / Thinking 파라미터 매핑 및 호환성 가드 순수 함수 모음.
 */
import type { ReasoningEffort, ReasoningOptions } from '../../shared/types/llm.types';
import type { ProviderType } from '../../shared/types/settings.types';

/** 강도별 기본 사고 토큰 예산 프리셋 (수동 budget_tokens / thinkingBudget용) */
export const REASONING_BUDGET_PRESETS: Readonly<Record<'low' | 'medium' | 'high', number>> = {
	low: 2048,
	medium: 8192,
	high: 24576,
};

/** Anthropic extended thinking 최소 예산 토큰 */
export const ANTHROPIC_MIN_BUDGET_TOKENS = 1024;

/** Gemini 2.5 Pro 최소 사고 예산 토큰 (0 비활성화 불가) */
export const GEMINI_25_PRO_MIN_BUDGET_TOKENS = 128;

export type ReasoningSupportMode =
	| 'openai_effort'
	| 'anthropic_manual'
	| 'anthropic_adaptive_46'
	| 'anthropic_adaptive_47'
	| 'gemini_budget'
	| 'gemini_level';

export interface ModelReasoningSupport {
	supported: boolean;
	provider?: 'openai' | 'anthropic' | 'google';
	mode?: ReasoningSupportMode;
	/** 사용자가 수동 budgetTokens를 지정했을 때 실제 적용되는 모델인지 여부 */
	supportsCustomBudget: boolean;
}

export type EffectiveReasoningSummaryKey =
	| 'summaryAuto'
	| 'summaryOffOpenAIUnsupported'
	| 'summaryOffOpenAIMinimal'
	| 'summaryOffOpenAINone'
	| 'summaryOffAnthropic'
	| 'summaryOffGeminiZero'
	| 'summaryOffGeminiProMin'
	| 'summaryOffGeminiLevel'
	| 'summaryOpenAIEffort'
	| 'summaryAnthropicManual'
	| 'summaryAnthropicAdaptive'
	| 'summaryGeminiBudget'
	| 'summaryGeminiLevel';

export interface EffectiveReasoningDescription {
	key: EffectiveReasoningSummaryKey;
	params?: Record<string, string | number>;
}

export interface ResolvedAnthropicThinking {
	thinking:
		| { type: 'disabled' }
		| { type: 'enabled'; budget_tokens: number }
		| { type: 'adaptive'; display?: 'summarized' };
	outputConfig?: { effort: 'low' | 'medium' | 'high' };
	/** thinking 활성 시 temperature 파라미터 생략 여부 */
	omitTemperature: boolean;
	/** max_tokens > budget_tokens 제약을 충족하기 위해 보정된 max_tokens */
	adjustedMaxTokens?: number;
}

export interface ResolvedGeminiThinkingConfig {
	thinkingBudget?: number;
	thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
	includeThoughts?: boolean;
}

// ─── OpenAI 모델 분류 및 매핑 ─────────────────────────────────────────────────

const OPENAI_NON_REASONING_REGEX = /embed|audio|realtime|image|tts|whisper|dall-e|transcribe|search/i;

/** OpenAI 추론(reasoning_effort) 지원 모델 여부 (o1/o3/o4, gpt-5+) */
export function isOpenAIReasoningModel(model: string): boolean {
	const trimmed = model.trim();
	if (!trimmed || OPENAI_NON_REASONING_REGEX.test(trimmed)) return false;
	return /(?:^|\/)(o\d|gpt-[5-9])(?:[-._]|$)/i.test(trimmed);
}

/** GPT-5.1 / 5.2+ 등 `reasoning_effort: 'none'`을 지원하는 세대인지 판별 */
function isOpenAIGpt51Plus(model: string): boolean {
	return /(?:^|\/)gpt-5\.[1-9]\d*(?:[-._]|$)/i.test(model) || /(?:^|\/)gpt-[6-9](?:[-._]|$)/i.test(model);
}

/** GPT-5.0 계열(`minimal` 지원, `none` 미지원)인지 판별 */
function isOpenAIGpt50(model: string): boolean {
	return !isOpenAIGpt51Plus(model) && /(?:^|\/)gpt-5(?:[-._]|$)/i.test(model);
}

/**
 * OpenAI Chat Completions API용 `reasoning_effort` 값을 결정합니다.
 * 미지원 모델이거나 `'auto'`, 또는 o-시리즈의 `'off'` 요청 시 `undefined`를 반환합니다.
 */
export function resolveOpenAIReasoningEffort(
	model: string,
	reasoning?: ReasoningOptions,
): 'none' | 'minimal' | 'low' | 'medium' | 'high' | undefined {
	if (!reasoning || reasoning.effort === 'auto') return undefined;
	if (!isOpenAIReasoningModel(model)) return undefined;

	if (reasoning.effort === 'off') {
		if (isOpenAIGpt51Plus(model)) return 'none';
		if (isOpenAIGpt50(model)) return 'minimal';
		// o1/o3/o4 시리즈는 off(none/minimal) 미지원 → 생략하여 HTTP 400 방지
		return undefined;
	}

	return reasoning.effort;
}

// ─── Anthropic 모델 분류 및 매핑 ──────────────────────────────────────────────

/** Claude 4.7+ 및 5+ 세대 (adaptive + display: 'summarized' 전용, enabled/budget_tokens 전송 시 400) */
export function isAnthropicAdaptiveOnlyModel(model: string): boolean {
	return /^claude-(?:(?:opus|sonnet|haiku)-)?(?:4[-.](?:[7-9]|\d{2})(?:[-._]|$)|[5-9](?:[-._]|$))/i.test(
		model.trim(),
	);
}

/** Claude 4.6 전환 세대 (adaptive + output_config.effort 권장, 수동 budget_tokens도 호환) */
export function isAnthropicClaude46Model(model: string): boolean {
	return /^claude-(?:(?:opus|sonnet|haiku)-)?4[-.]6(?:[-._]|$)/i.test(model.trim());
}

/** Claude 3.7 ~ 4.5 세대 (수동 enabled + budget_tokens 전용) */
export function isAnthropicManualThinkingModel(model: string): boolean {
	const trimmed = model.trim();
	if (isAnthropicAdaptiveOnlyModel(trimmed) || isAnthropicClaude46Model(trimmed)) {
		return false;
	}
	return /^claude-(?:(?:opus|sonnet|haiku)-)?(?:3[-.]7|4)(?:[-._]|$)/i.test(trimmed);
}

/** Anthropic thinking 지원 모델 여부 */
export function isAnthropicThinkingModel(model: string): boolean {
	return (
		isAnthropicAdaptiveOnlyModel(model) ||
		isAnthropicClaude46Model(model) ||
		isAnthropicManualThinkingModel(model)
	);
}

/** 유효한 수동 budget_tokens 값을 최소치(1024) 이상 정수로 정규화 */
function resolveAnthropicManualBudget(effort: 'low' | 'medium' | 'high', budgetTokens?: number): number {
	if (typeof budgetTokens === 'number' && budgetTokens > 0) {
		return Math.max(ANTHROPIC_MIN_BUDGET_TOKENS, Math.floor(budgetTokens));
	}
	return REASONING_BUDGET_PRESETS[effort];
}

/** budget_tokens보다 max_tokens가 작거나 같으면 HTTP 400이 발생하므로 안전하게 상향 보정 */
function adjustMaxTokensForBudget(requestedMaxTokens: number, budgetTokens: number): number {
	if (requestedMaxTokens > budgetTokens) {
		return requestedMaxTokens;
	}
	const answerReserve = Math.max(ANTHROPIC_MIN_BUDGET_TOKENS, Math.min(requestedMaxTokens, 4096));
	return budgetTokens + answerReserve;
}

/**
 * Anthropic Messages API용 `thinking`, `output_config`, `max_tokens` 보정값을 결정합니다.
 */
export function resolveAnthropicThinking(
	model: string,
	reasoning?: ReasoningOptions,
	requestedMaxTokens = 4096,
): ResolvedAnthropicThinking | undefined {
	if (!reasoning || reasoning.effort === 'auto') return undefined;
	if (!isAnthropicThinkingModel(model)) return undefined;

	if (reasoning.effort === 'off') {
		return {
			thinking: { type: 'disabled' },
			omitTemperature: false,
		};
	}

	const effort = reasoning.effort;

	if (isAnthropicAdaptiveOnlyModel(model)) {
		// Claude 4.7+ 기본 display는 omitted이므로 UI 표시를 위해 summarized를 명시
		return {
			thinking: { type: 'adaptive', display: 'summarized' },
			outputConfig: { effort },
			omitTemperature: true,
		};
	}

	if (isAnthropicClaude46Model(model)) {
		if (typeof reasoning.budgetTokens === 'number' && reasoning.budgetTokens > 0) {
			const budget = resolveAnthropicManualBudget(effort, reasoning.budgetTokens);
			return {
				thinking: { type: 'enabled', budget_tokens: budget },
				omitTemperature: true,
				adjustedMaxTokens: adjustMaxTokensForBudget(requestedMaxTokens, budget),
			};
		}
		return {
			thinking: { type: 'adaptive' },
			outputConfig: { effort },
			omitTemperature: true,
		};
	}

	// Claude 3.7 ~ 4.5 수동 모드
	const budget = resolveAnthropicManualBudget(effort, reasoning.budgetTokens);
	return {
		thinking: { type: 'enabled', budget_tokens: budget },
		omitTemperature: true,
		adjustedMaxTokens: adjustMaxTokensForBudget(requestedMaxTokens, budget),
	};
}

// ─── Google Gemini 모델 분류 및 매핑 ───────────────────────────────────────────

const GEMINI_NON_CHAT_REGEX = /embed|imagen|veo|tts|aqa|robotics/i;

function cleanGeminiModelName(model: string): string {
	return model.replace(/^models\//i, '').trim();
}

/** Gemini 3.x / 4.x+ 세대 (`thinkingLevel` 사용) 판별 */
export function isGemini3PlusModel(model: string): boolean {
	const clean = cleanGeminiModelName(model);
	if (!clean || GEMINI_NON_CHAT_REGEX.test(clean)) return false;
	return /^gemini-(?:[3-9]|\d{2})(?:[-._]|$)/i.test(clean);
}

/** Gemini 2.5 세대 (`thinkingBudget` 사용) 판별 */
export function isGemini25Model(model: string): boolean {
	const clean = cleanGeminiModelName(model);
	if (!clean || GEMINI_NON_CHAT_REGEX.test(clean)) return false;
	return /^gemini-2\.5(?:[-._]|$)/i.test(clean);
}

function isGeminiProVariant(cleanModel: string): boolean {
	return /(?:^|[-._])pro(?:[-._]|$)/i.test(cleanModel);
}

function isGemini30ProOnly(cleanModel: string): boolean {
	return /^gemini-3(?:[-._]0)?[-._]pro(?:[-._]|$)/i.test(cleanModel);
}

/**
 * Google Gemini REST API용 `generationConfig.thinkingConfig`를 결정합니다.
 * 세대에 따라 `thinkingBudget`(2.5)과 `thinkingLevel`(3+)을 배타적으로 생성합니다.
 */
export function resolveGeminiThinkingConfig(
	model: string,
	reasoning?: ReasoningOptions,
): ResolvedGeminiThinkingConfig | undefined {
	if (!reasoning || reasoning.effort === 'auto') return undefined;
	const clean = cleanGeminiModelName(model);
	const isPro = isGeminiProVariant(clean);

	if (isGemini3PlusModel(clean)) {
		if (reasoning.effort === 'off') {
			return {
				thinkingLevel: isPro ? 'low' : 'minimal',
			};
		}
		// 초기 gemini-3-pro는 medium 미지원 가능성 → high로 안전 매핑
		const level =
			isGemini30ProOnly(clean) && reasoning.effort === 'medium'
				? 'high'
				: reasoning.effort;
		return {
			thinkingLevel: level,
			includeThoughts: true,
		};
	}

	if (isGemini25Model(clean)) {
		if (reasoning.effort === 'off') {
			return {
				thinkingBudget: isPro ? GEMINI_25_PRO_MIN_BUDGET_TOKENS : 0,
			};
		}
		const rawBudget =
			typeof reasoning.budgetTokens === 'number' && reasoning.budgetTokens > 0
				? Math.floor(reasoning.budgetTokens)
				: REASONING_BUDGET_PRESETS[reasoning.effort];
		const budget = isPro ? Math.max(GEMINI_25_PRO_MIN_BUDGET_TOKENS, rawBudget) : rawBudget;
		return {
			thinkingBudget: budget,
			includeThoughts: true,
		};
	}

	return undefined;
}

// ─── UI 지원 여부 판별 & 요약 설명 ────────────────────────────────────────────

/**
 * 선택된 프로바이더 타입과 모델 ID가 Cloud 직접 API 추론 제어를 지원하는지 반환합니다.
 * OpenAICompat(OpenRouter/xAI/DeepSeek 등), 로컬, CLI 프로바이더는 false를 반환합니다.
 */
export function getModelReasoningSupport(
	providerType: ProviderType | undefined,
	modelId: string | undefined,
): ModelReasoningSupport {
	if (!providerType || !modelId) {
		return { supported: false, supportsCustomBudget: false };
	}

	if (providerType === 'openai') {
		if (!isOpenAIReasoningModel(modelId)) {
			return { supported: false, supportsCustomBudget: false };
		}
		return {
			supported: true,
			provider: 'openai',
			mode: 'openai_effort',
			supportsCustomBudget: false,
		};
	}

	if (providerType === 'anthropic') {
		if (isAnthropicAdaptiveOnlyModel(modelId)) {
			return {
				supported: true,
				provider: 'anthropic',
				mode: 'anthropic_adaptive_47',
				supportsCustomBudget: false,
			};
		}
		if (isAnthropicClaude46Model(modelId)) {
			return {
				supported: true,
				provider: 'anthropic',
				mode: 'anthropic_adaptive_46',
				supportsCustomBudget: true,
			};
		}
		if (isAnthropicManualThinkingModel(modelId)) {
			return {
				supported: true,
				provider: 'anthropic',
				mode: 'anthropic_manual',
				supportsCustomBudget: true,
			};
		}
		return { supported: false, supportsCustomBudget: false };
	}

	if (providerType === 'google') {
		if (isGemini3PlusModel(modelId)) {
			return {
				supported: true,
				provider: 'google',
				mode: 'gemini_level',
				supportsCustomBudget: false,
			};
		}
		if (isGemini25Model(modelId)) {
			return {
				supported: true,
				provider: 'google',
				mode: 'gemini_budget',
				supportsCustomBudget: true,
			};
		}
		return { supported: false, supportsCustomBudget: false };
	}

	return { supported: false, supportsCustomBudget: false };
}

/** 주어진 모델 목록(예: Split Chat 슬롯) 중 추론 제어를 지원하는 모델이 하나라도 있는지 확인 */
export function isAnyModelReasoningSupported(
	targets: ReadonlyArray<{ providerType?: ProviderType; modelId?: string }>,
): boolean {
	return targets.some((t) => getModelReasoningSupport(t.providerType, t.modelId).supported);
}

/** 팝오버 하단 안내용: 현재 모델에 실제로 전송될 추론 파라미터 요약을 반환 */
export function describeEffectiveReasoning(
	providerType: ProviderType | undefined,
	modelId: string | undefined,
	effort: ReasoningEffort,
	budgetTokens = 0,
): EffectiveReasoningDescription {
	if (effort === 'auto') {
		return { key: 'summaryAuto' };
	}

	const support = getModelReasoningSupport(providerType, modelId);
	if (!support.supported || !modelId) {
		return { key: 'summaryAuto' };
	}

	const reasoning: ReasoningOptions = {
		effort,
		...(budgetTokens > 0 ? { budgetTokens } : {}),
	};

	if (support.provider === 'openai') {
		const resolved = resolveOpenAIReasoningEffort(modelId, reasoning);
		if (!resolved) {
			return { key: 'summaryOffOpenAIUnsupported' };
		}
		if (resolved === 'minimal') return { key: 'summaryOffOpenAIMinimal' };
		if (resolved === 'none') return { key: 'summaryOffOpenAINone' };
		return { key: 'summaryOpenAIEffort', params: { effort: resolved } };
	}

	if (support.provider === 'anthropic') {
		const resolved = resolveAnthropicThinking(modelId, reasoning);
		if (!resolved || resolved.thinking.type === 'disabled') {
			return { key: 'summaryOffAnthropic' };
		}
		if (resolved.thinking.type === 'enabled') {
			return {
				key: 'summaryAnthropicManual',
				params: { budget: resolved.thinking.budget_tokens.toLocaleString() },
			};
		}
		return {
			key: 'summaryAnthropicAdaptive',
			params: { effort: resolved.outputConfig?.effort ?? effort },
		};
	}

	if (support.provider === 'google') {
		const resolved = resolveGeminiThinkingConfig(modelId, reasoning);
		if (!resolved) return { key: 'summaryAuto' };
		if (resolved.thinkingLevel !== undefined) {
			if (effort === 'off') {
				return { key: 'summaryOffGeminiLevel', params: { level: resolved.thinkingLevel } };
			}
			return { key: 'summaryGeminiLevel', params: { level: resolved.thinkingLevel } };
		}
		if (resolved.thinkingBudget !== undefined) {
			if (effort === 'off') {
				return resolved.thinkingBudget === 0
					? { key: 'summaryOffGeminiZero' }
					: { key: 'summaryOffGeminiProMin' };
			}
			return {
				key: 'summaryGeminiBudget',
				params: { budget: resolved.thinkingBudget.toLocaleString() },
			};
		}
	}

	return { key: 'summaryAuto' };
}

/**
 * 디버그 로그(`LLMRequestLog.reasoning`)에 기록할 실효 추론/사고 파라미터 요약을 생성합니다.
 * `'auto'`이거나 추론 제어가 적용되지 않는 모델/프로바이더이면 `undefined`를 반환합니다.
 */
export function formatReasoningForDebugLog(
	providerType: string | undefined,
	modelId: string,
	reasoning?: ReasoningOptions,
	requestedMaxTokens = 4096,
): string | undefined {
	if (!reasoning || reasoning.effort === 'auto') return undefined;

	if (providerType === 'openai') {
		if (!isOpenAIReasoningModel(modelId)) return undefined;
		const resolved = resolveOpenAIReasoningEffort(modelId, reasoning);
		if (!resolved) return 'off (omitted)';
		return `reasoning_effort=${resolved}`;
	}

	if (providerType === 'anthropic') {
		const resolved = resolveAnthropicThinking(modelId, reasoning, requestedMaxTokens);
		if (!resolved) return undefined;
		const parts = [`thinking=${JSON.stringify(resolved.thinking)}`];
		if (resolved.outputConfig) {
			parts.push(`output_config=${JSON.stringify(resolved.outputConfig)}`);
		}
		if (resolved.adjustedMaxTokens && resolved.adjustedMaxTokens !== requestedMaxTokens) {
			parts.push(`max_tokens=${resolved.adjustedMaxTokens}`);
		}
		return parts.join(', ');
	}

	if (providerType === 'google') {
		const resolved = resolveGeminiThinkingConfig(modelId, reasoning);
		if (!resolved) return undefined;
		return `thinkingConfig=${JSON.stringify(resolved)}`;
	}

	return undefined;
}
