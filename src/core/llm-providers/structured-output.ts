/**
 * structured-output.ts
 * 프로바이더별 네이티브 Structured Outputs(JSON Schema 강제) 매핑,
 * 모델 지원 가드 및 HTTP 400/422 자동 폴백 세션 캐시 모듈.
 */

import type { ResponseFormatOptions } from '../../shared/types/llm.types';
import type { ProviderType } from '../../shared/types/settings.types';

/** Structured Outputs 1단계 지원 프로바이더 타입 */
export type StructuredOutputProvider =
	| 'openai'
	| 'google'
	| 'anthropic'
	| 'xai'
	| 'ollama'
	| 'lmstudio';

const STRUCTURED_OUTPUT_PROVIDERS: ReadonlySet<ProviderType> = new Set<ProviderType>([
	'openai',
	'google',
	'anthropic',
	'xai',
	'ollama',
	'lmstudio',
]);

/**
 * 프로바이더 타입이 Structured Outputs 1단계 지원 대상인지 판별합니다.
 * deepseek, groq, openrouter, custom, cli-*는 undefined를 반환합니다.
 */
export function toStructuredOutputProvider(type: ProviderType): StructuredOutputProvider | undefined {
	if (STRUCTURED_OUTPUT_PROVIDERS.has(type)) {
		return type as StructuredOutputProvider;
	}
	return undefined;
}

// ─── 모델 지원 가드 (순수 함수) ────────────────────────────────────────────────

const OPENAI_NON_CHAT_REGEX = /embed|audio|realtime|image|tts|whisper|dall-e|transcribe|search/i;
const GEMINI_NON_CHAT_REGEX = /embed|imagen|veo|tts|aqa|robotics/i;
const COMPAT_NON_CHAT_REGEX = /embed|rerank|whisper|tts|dall-e|image/i;

/**
 * OpenAI 공식 모델의 Structured Outputs 지원 여부를 판별합니다.
 * - json_object: 최신/구형 채팅 모델 전반 지원
 * - json_schema: gpt-4o*(2024-05-13 제외), gpt-4.1*, gpt-4.5*, gpt-5+, o1(mini/preview 제외), o3*, o4*
 */
export function isOpenAIStructuredOutputModel(
	model: string,
	formatType: ResponseFormatOptions['type'],
): boolean {
	const trimmed = model.trim();
	if (!trimmed || OPENAI_NON_CHAT_REGEX.test(trimmed)) return false;

	if (formatType === 'json_object') {
		return /^(?:gpt-(?:3\.5|4|5|[6-9])|chatgpt-4o|o[134](?:[-._]|$)|ft:gpt-)/i.test(trimmed);
	}

	// json_schema 미지원 레거시 모델 명시적 제외
	if (/^(?:gpt-3\.5|gpt-4o-2024-05-13(?:$|[-._])|o1-(?:mini|preview)(?:$|[-._]))/i.test(trimmed)) {
		return false;
	}
	// 구형 gpt-4 / gpt-4-turbo / gpt-4-0613 / gpt-4-32k 제외 (gpt-4o, gpt-4.1, gpt-4.5와 구분)
	if (/^gpt-4(?:$|-(?:turbo|32k|\d{4}))/i.test(trimmed)) {
		return false;
	}

	return /^(?:gpt-4o|gpt-4\.[15]|gpt-[5-9]|chatgpt-4o|o1(?:$|-pro|-\d{4})|o[34](?:$|[-._]))/i.test(trimmed);
}

/**
 * Google Gemini 모델의 responseMimeType / responseJsonSchema 지원 여부를 판별합니다.
 */
export function isGeminiStructuredOutputModel(model: string): boolean {
	const clean = model.replace(/^models\//i, '').trim();
	if (!clean || GEMINI_NON_CHAT_REGEX.test(clean)) return false;
	return /^gemini-/i.test(clean);
}

/**
 * Anthropic Claude 모델의 output_config.format(json_schema) 지원 여부를 판별합니다.
 * Claude 4.1 Opus, Claude 4.5+, Claude 5+ 세대에서 지원됩니다.
 */
export function isAnthropicStructuredOutputModel(model: string): boolean {
	const trimmed = model.trim();
	if (!trimmed) return false;
	return (
		/^claude-opus-4[-.]1(?:[-._]|$)/i.test(trimmed) ||
		/^claude-(?:(?:opus|sonnet|haiku)-)?4[-.](?:[5-9]|\d{2})(?:[-._]|$)/i.test(trimmed) ||
		/^claude-(?:(?:opus|sonnet|haiku)-)?[5-9](?:[-._]|$)/i.test(trimmed)
	);
}

/**
 * OpenAI 호환 프로바이더(xai, ollama, lmstudio) 모델의 기본 허용 여부를 판별합니다.
 */
export function isOpenAICompatStructuredOutputModel(
	_provider: 'xai' | 'ollama' | 'lmstudio',
	model: string,
): boolean {
	const trimmed = model.trim();
	if (!trimmed || COMPAT_NON_CHAT_REGEX.test(trimmed)) return false;
	return true;
}

// ─── 페이로드 빌더 (순수 함수) ────────────────────────────────────────────────

/**
 * OpenAI 및 호환 프로바이더용 response_format 페이로드 객체를 생성합니다.
 */
export function buildOpenAIResponseFormat(
	provider: 'openai' | 'xai' | 'ollama' | 'lmstudio',
	model: string,
	responseFormat?: ResponseFormatOptions,
): Record<string, unknown> | undefined {
	if (!responseFormat) return undefined;

	const supported =
		provider === 'openai'
			? isOpenAIStructuredOutputModel(model, responseFormat.type)
			: isOpenAICompatStructuredOutputModel(provider, model);

	if (!supported) return undefined;

	if (responseFormat.type === 'json_object') {
		return { type: 'json_object' };
	}

	return {
		type: 'json_schema',
		json_schema: {
			name: responseFormat.jsonSchema.name,
			...(responseFormat.jsonSchema.description ? { description: responseFormat.jsonSchema.description } : {}),
			schema: responseFormat.jsonSchema.schema,
			strict: responseFormat.jsonSchema.strict ?? true,
		},
	};
}

/**
 * Google Gemini generationConfig용 responseMimeType / responseJsonSchema 조각을 생성합니다.
 */
export function buildGeminiResponseFormatConfig(
	model: string,
	responseFormat?: ResponseFormatOptions,
): { responseMimeType: 'application/json'; responseJsonSchema?: Record<string, unknown> } | undefined {
	if (!responseFormat || !isGeminiStructuredOutputModel(model)) return undefined;

	if (responseFormat.type === 'json_object') {
		return { responseMimeType: 'application/json' };
	}

	return {
		responseMimeType: 'application/json',
		responseJsonSchema: responseFormat.jsonSchema.schema,
	};
}

/**
 * Anthropic Messages API용 output_config.format 객체를 생성합니다.
 * Anthropic은 json_object 단독 모드를 지원하지 않으므로 json_schema일 때만 반환합니다.
 */
export function buildAnthropicOutputFormat(
	model: string,
	responseFormat?: ResponseFormatOptions,
): { type: 'json_schema'; schema: Record<string, unknown> } | undefined {
	if (!responseFormat || responseFormat.type !== 'json_schema') return undefined;
	if (!isAnthropicStructuredOutputModel(model)) return undefined;

	return {
		type: 'json_schema',
		schema: responseFormat.jsonSchema.schema,
	};
}

// ─── 세션 폴백 캐시 & 재시도 가능 오류 판별 ────────────────────────────────────

class StructuredOutputFallbackCache {
	private unsupportedKeys = new Set<string>();

	private makeKey(providerId: string, model: string): string {
		return `${providerId}::${model.trim().toLowerCase()}`;
	}

	/** 현재 세션에서 해당 프로바이더/모델이 스키마 미지원으로 판명되었는지 확인 */
	isUnsupported(providerId: string, model: string): boolean {
		return this.unsupportedKeys.has(this.makeKey(providerId, model));
	}

	/** HTTP 400/422 거부 시 세션 동안 네이티브 스키마 전송을 생략하도록 기록 */
	markUnsupported(providerId: string, model: string): void {
		this.unsupportedKeys.add(this.makeKey(providerId, model));
	}

	/** 테스트용 캐시 초기화 */
	clear(): void {
		this.unsupportedKeys.clear();
	}
}

/** 프로바이더/모델별 Structured Outputs 400 폴백 세션 캐시 싱글턴 */
export const structuredOutputFallbackCache = new StructuredOutputFallbackCache();

const NON_SCHEMA_400_REGEX =
	/context_length|maximum context|too many tokens|token limit|invalid_api_key|invalid x-api-key|authentication|unauthorized|billing|credit balance|quota|rate_limit|content_filter/i;

/**
 * 오류가 Structured Outputs 스키마/파라미터 거부(HTTP 400/422)로 인해
 * responseFormat 제거 후 재시도가 가능한 오류인지 판별합니다.
 */
export function isStructuredOutputRetryableError(err: unknown): boolean {
	if (!err) return false;
	if (err instanceof Error && (err.name === 'AbortError' || err.name === 'IdleTimeoutError')) {
		return false;
	}

	const errObj = typeof err === 'object' ? (err as Record<string, unknown>) : null;
	const status = typeof errObj?.status === 'number' ? errObj.status : undefined;
	const message = err instanceof Error ? err.message : typeof errObj?.message === 'string' ? errObj.message : String(err);
	const text = typeof errObj?.text === 'string' ? errObj.text : '';
	let jsonStr = '';
	if (errObj?.json !== undefined) {
		try {
			jsonStr = JSON.stringify(errObj.json);
		} catch {
			jsonStr = '';
		}
	}

	const blob = `${message} ${text} ${jsonStr}`;
	const isClientSchemaStatus =
		status === 400 ||
		status === 422 ||
		/\b(?:HTTP|status)\s*(?:400|422)\b/i.test(blob);

	if (!isClientSchemaStatus) return false;
	if (NON_SCHEMA_400_REGEX.test(blob)) return false;

	return true;
}
