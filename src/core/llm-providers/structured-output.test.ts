/**
 * structured-output.test.ts
 * 프로바이더별 Structured Outputs 매핑, 모델 가드, 400/422 재시도 판별 및 세션 캐시 검증
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	buildAnthropicOutputFormat,
	buildGeminiResponseFormatConfig,
	buildOpenAIResponseFormat,
	isAnthropicStructuredOutputModel,
	isGeminiStructuredOutputModel,
	isOpenAIStructuredOutputModel,
	isStructuredOutputRetryableError,
	structuredOutputFallbackCache,
	toStructuredOutputProvider,
} from './structured-output';
import type { ResponseFormatOptions } from '../../shared/types/llm.types';

const SAMPLE_SCHEMA: ResponseFormatOptions = {
	type: 'json_schema',
	jsonSchema: {
		name: 'sample_result',
		description: 'Sample schema',
		schema: {
			type: 'object',
			properties: {
				tags: { type: 'array', items: { type: 'string' } },
				description: { type: 'string' },
			},
			required: ['tags', 'description'],
			additionalProperties: false,
		},
		strict: true,
	},
};

describe('structured-output', () => {
	beforeEach(() => {
		structuredOutputFallbackCache.clear();
	});

	it('toStructuredOutputProvider는 1단계 지원 6개 프로바이더만 허용하고 나머지는 제외한다', () => {
		expect(toStructuredOutputProvider('openai')).toBe('openai');
		expect(toStructuredOutputProvider('google')).toBe('google');
		expect(toStructuredOutputProvider('anthropic')).toBe('anthropic');
		expect(toStructuredOutputProvider('xai')).toBe('xai');
		expect(toStructuredOutputProvider('ollama')).toBe('ollama');
		expect(toStructuredOutputProvider('lmstudio')).toBe('lmstudio');

		expect(toStructuredOutputProvider('deepseek')).toBeUndefined();
		expect(toStructuredOutputProvider('groq')).toBeUndefined();
		expect(toStructuredOutputProvider('openrouter')).toBeUndefined();
		expect(toStructuredOutputProvider('custom')).toBeUndefined();
		expect(toStructuredOutputProvider('cli-claude-code')).toBeUndefined();
		expect(toStructuredOutputProvider('cli-codex')).toBeUndefined();
	});

	it('OpenAI 모델 가드는 json_schema 지원/미지원 모델과 비채팅 모델을 정확히 구분한다', () => {
		expect(isOpenAIStructuredOutputModel('gpt-4o-mini', 'json_schema')).toBe(true);
		expect(isOpenAIStructuredOutputModel('gpt-4o-2024-08-06', 'json_schema')).toBe(true);
		expect(isOpenAIStructuredOutputModel('gpt-4.1-mini', 'json_schema')).toBe(true);
		expect(isOpenAIStructuredOutputModel('gpt-5', 'json_schema')).toBe(true);
		expect(isOpenAIStructuredOutputModel('o1-2024-12-17', 'json_schema')).toBe(true);
		expect(isOpenAIStructuredOutputModel('o3-mini', 'json_schema')).toBe(true);
		expect(isOpenAIStructuredOutputModel('o4-mini', 'json_schema')).toBe(true);

		// 레거시 및 비채팅 모델 제외
		expect(isOpenAIStructuredOutputModel('gpt-3.5-turbo', 'json_schema')).toBe(false);
		expect(isOpenAIStructuredOutputModel('gpt-4', 'json_schema')).toBe(false);
		expect(isOpenAIStructuredOutputModel('gpt-4-turbo', 'json_schema')).toBe(false);
		expect(isOpenAIStructuredOutputModel('gpt-4o-2024-05-13', 'json_schema')).toBe(false);
		expect(isOpenAIStructuredOutputModel('o1-preview', 'json_schema')).toBe(false);
		expect(isOpenAIStructuredOutputModel('o1-mini', 'json_schema')).toBe(false);
		expect(isOpenAIStructuredOutputModel('text-embedding-3-small', 'json_schema')).toBe(false);

		// json_object는 gpt-3.5-turbo/gpt-4-turbo에서도 허용
		expect(isOpenAIStructuredOutputModel('gpt-3.5-turbo', 'json_object')).toBe(true);
		expect(isOpenAIStructuredOutputModel('gpt-4-turbo', 'json_object')).toBe(true);
	});

	it('buildOpenAIResponseFormat은 OpenAI·xAI·Ollama·LM Studio용 response_format을 생성한다', () => {
		expect(buildOpenAIResponseFormat('openai', 'gpt-4o-mini', SAMPLE_SCHEMA)).toEqual({
			type: 'json_schema',
			json_schema: {
				name: 'sample_result',
				description: 'Sample schema',
				schema: SAMPLE_SCHEMA.jsonSchema.schema,
				strict: true,
			},
		});
		expect(buildOpenAIResponseFormat('openai', 'gpt-3.5-turbo', SAMPLE_SCHEMA)).toBeUndefined();
		expect(buildOpenAIResponseFormat('openai', 'gpt-3.5-turbo', { type: 'json_object' })).toEqual({
			type: 'json_object',
		});

		expect(buildOpenAIResponseFormat('ollama', 'qwen2.5:7b', SAMPLE_SCHEMA)).toBeDefined();
		expect(buildOpenAIResponseFormat('lmstudio', 'llama-3.2-3b', SAMPLE_SCHEMA)).toBeDefined();
		expect(buildOpenAIResponseFormat('xai', 'grok-4-latest', SAMPLE_SCHEMA)).toBeDefined();
		expect(buildOpenAIResponseFormat('ollama', 'nomic-embed-text', SAMPLE_SCHEMA)).toBeUndefined();
	});

	it('Gemini 모델 가드 및 generationConfig 빌더가 responseMimeType과 responseJsonSchema를 생성한다', () => {
		expect(isGeminiStructuredOutputModel('gemini-2.5-flash')).toBe(true);
		expect(isGeminiStructuredOutputModel('models/gemini-2.0-flash')).toBe(true);
		expect(isGeminiStructuredOutputModel('text-embedding-004')).toBe(false);
		expect(isGeminiStructuredOutputModel('gemini-embedding-001')).toBe(false);

		expect(buildGeminiResponseFormatConfig('gemini-2.5-flash', SAMPLE_SCHEMA)).toEqual({
			responseMimeType: 'application/json',
			responseJsonSchema: SAMPLE_SCHEMA.jsonSchema.schema,
		});
		expect(buildGeminiResponseFormatConfig('gemini-2.5-flash', { type: 'json_object' })).toEqual({
			responseMimeType: 'application/json',
		});
		expect(buildGeminiResponseFormatConfig('text-embedding-004', SAMPLE_SCHEMA)).toBeUndefined();
	});

	it('Anthropic 모델 가드 및 output_config.format 빌더가 Claude 4.1 Opus 및 4.5+만 허용한다', () => {
		expect(isAnthropicStructuredOutputModel('claude-opus-4-1-20250805')).toBe(true);
		expect(isAnthropicStructuredOutputModel('claude-sonnet-4-5')).toBe(true);
		expect(isAnthropicStructuredOutputModel('claude-haiku-4-5-20251001')).toBe(true);
		expect(isAnthropicStructuredOutputModel('claude-opus-4-7')).toBe(true);
		expect(isAnthropicStructuredOutputModel('claude-sonnet-5-5')).toBe(true);

		expect(isAnthropicStructuredOutputModel('claude-3-5-sonnet-latest')).toBe(false);
		expect(isAnthropicStructuredOutputModel('claude-3-7-sonnet-20250219')).toBe(false);
		expect(isAnthropicStructuredOutputModel('claude-sonnet-4-20250514')).toBe(false);

		expect(buildAnthropicOutputFormat('claude-sonnet-4-5', SAMPLE_SCHEMA)).toEqual({
			type: 'json_schema',
			schema: SAMPLE_SCHEMA.jsonSchema.schema,
		});
		expect(buildAnthropicOutputFormat('claude-sonnet-4-5', { type: 'json_object' })).toBeUndefined();
		expect(buildAnthropicOutputFormat('claude-3-5-sonnet-latest', SAMPLE_SCHEMA)).toBeUndefined();
	});

	it('isStructuredOutputRetryableError는 스키마 거부 400/422만 true를 반환하고 Abort·인증·컨텍스트 초과·429·500은 false를 반환한다', () => {
		expect(isStructuredOutputRetryableError({ status: 400, message: 'Invalid response_format json_schema' })).toBe(true);
		expect(isStructuredOutputRetryableError({ status: 422, message: 'Unprocessable entity' })).toBe(true);
		expect(isStructuredOutputRetryableError(new Error('OpenAI Error (HTTP 400): unsupported parameter'))).toBe(true);

		const abortErr = new Error('Aborted');
		abortErr.name = 'AbortError';
		expect(isStructuredOutputRetryableError(abortErr)).toBe(false);

		const idleErr = new Error('Timeout');
		idleErr.name = 'IdleTimeoutError';
		expect(isStructuredOutputRetryableError(idleErr)).toBe(false);

		expect(isStructuredOutputRetryableError({ status: 400, message: 'maximum context length exceeded' })).toBe(false);
		expect(isStructuredOutputRetryableError({ status: 400, message: 'invalid_api_key provided' })).toBe(false);
		expect(isStructuredOutputRetryableError({ status: 401, message: 'Unauthorized' })).toBe(false);
		expect(isStructuredOutputRetryableError({ status: 429, message: 'Rate limit' })).toBe(false);
		expect(isStructuredOutputRetryableError({ status: 500, message: 'Internal Server Error' })).toBe(false);
	});

	it('structuredOutputFallbackCache는 프로바이더 ID와 모델(대소문자 무시) 단위로 미지원 상태를 기록/초기화한다', () => {
		expect(structuredOutputFallbackCache.isUnsupported('p1', 'Qwen2.5')).toBe(false);
		structuredOutputFallbackCache.markUnsupported('p1', 'Qwen2.5');
		expect(structuredOutputFallbackCache.isUnsupported('p1', 'qwen2.5')).toBe(true);
		expect(structuredOutputFallbackCache.isUnsupported('p2', 'qwen2.5')).toBe(false);
		structuredOutputFallbackCache.clear();
		expect(structuredOutputFallbackCache.isUnsupported('p1', 'qwen2.5')).toBe(false);
	});
});
