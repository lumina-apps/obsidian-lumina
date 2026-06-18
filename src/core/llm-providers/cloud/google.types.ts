/**
 * google.types.ts
 * Google Gemini API 전용 타입과 상수
 */
import type { TokenUsage } from '../../../shared/types/llm.types';

export interface GeminiToolCallInfo {
	name: string;
	args: Record<string, unknown>;
	thoughtSignature?: string;
}

export interface GeminiStreamChunk {
	candidates?: Array<{
		content?: {
			parts?: Array<{
				text?: string;
				functionCall?: {
					name: string;
					args?: Record<string, unknown>;
				};
				thoughtSignature?: string;
			}>;
		};
		finishReason?: string;
	}>;
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
		totalTokenCount?: number;
	};
}

export interface GeminiResponse {
	candidates?: Array<{
		content?: {
			parts?: Array<{
				text?: string;
				functionCall?: {
					name: string;
					args?: Record<string, unknown>;
				};
				thoughtSignature?: string;
			}>;
		};
		finishReason?: string;
	}>;
	usageMetadata?: {
		promptTokenCount?: number;
		candidatesTokenCount?: number;
		totalTokenCount?: number;
	};
}

/** Google Gemini 지원 모델 목록 (최신순) */
export const GOOGLE_MODELS = [
	'gemini-2.0-flash',
	'gemini-2.0-flash-lite',
	'gemini-2.5-pro-preview-06-05',
	'gemini-2.5-flash-preview-05-20',
	'gemini-1.5-pro',
	'gemini-1.5-flash',
	'gemini-1.5-flash-8b',
	'text-embedding-004',
];

/** Gemini usageMetadata → TokenUsage 매핑 */
export function mapUsageMetadata(meta: GeminiStreamChunk['usageMetadata']): TokenUsage {
	return {
		inputTokens: meta?.promptTokenCount ?? 0,
		outputTokens: meta?.candidatesTokenCount ?? 0,
		totalTokens: meta?.totalTokenCount ?? 0,
	};
}