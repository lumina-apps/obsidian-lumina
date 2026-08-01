/**
 * index.ts — llm-providers 진입점
 *
 * - ILLMProvider 인터페이스 재내보내기
 * - createProvider(): LLMProviderConfig → ILLMProvider 팩토리
 * - isLocalProvider(): 로컬/클라우드 구분 헬퍼
 */

export type { ILLMProvider } from '../../shared/types/llm.types';

import { PROVIDER_CATEGORIES, PROVIDER_BASE_URLS } from '../../shared/types/settings.types';
import type { LLMProviderConfig, ProviderType } from '../../shared/types/settings.types';
import type { ILLMProvider } from '../../shared/types/llm.types';
import { OpenAIProvider } from './cloud/openai.provider';
import { AnthropicProvider } from './cloud/anthropic.provider';
import { GoogleProvider } from './cloud/google.provider';
import { OpenAICompatProvider } from './local/openaiCompat.provider';
import { t } from '../../shared/locales/helpers';

/** 로컬/커스텀 LLM 여부 */
export function isLocalProvider(type: ProviderType): boolean {
	return PROVIDER_CATEGORIES[type] === 'local' || type === 'custom';
}

/**
 * LLMProviderConfig 에서 ILLMProvider 인스턴스를 생성합니다.
 *
 * @throws {Error} credential이 비어있거나 baseUrl이 비어있으면 에러
 */
export function createProvider(config: LLMProviderConfig): ILLMProvider {
	const { id, type, credential, baseUrl } = config;

	const category = PROVIDER_CATEGORIES[type];

	// 로컬이나 커스텀의 경우 URL이 필수
	if (category === 'local' || category === 'custom') {
		if (!baseUrl?.trim()) {
			throw new Error(t('settings.providerErrors.missingUrl'));
		}
	} else {
		// 클라우드/애그리게이터의 경우 API Key가 필수
		if (!credential?.trim()) {
			throw new Error(t('settings.providerErrors.missingKey'));
		}
	}

	switch (type) {
		case 'openai':
			return new OpenAIProvider(id, credential);
		case 'anthropic':
			return new AnthropicProvider(id, credential);
		case 'google':
			return new GoogleProvider(id, credential);

		// OpenAI 호환 고정 URL 클라우드 서비스
		case 'xai':
		case 'deepseek':
		case 'groq':
		case 'openrouter':
		case 'togetherai':
		case 'kimi':
		case 'mistral': {
			const url = PROVIDER_BASE_URLS[type]!;
			return new OpenAICompatProvider(id, type, url, credential);
		}

		// 로컬 및 커스텀
		case 'ollama':
		case 'lmstudio':
		case 'vllm':
		case 'llamacpp':
		case 'custom': {
			return new OpenAICompatProvider(id, type, baseUrl!, credential || 'ollama');
		}

		default:
			throw new Error(t('settings.providerErrors.unknownType', { type: type }));
	}
}
