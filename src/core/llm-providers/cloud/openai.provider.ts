import type { ChatMessage, ChatOptions } from '../../../shared/types/llm.types';
import { requestUrl } from 'obsidian';
import { raiseApiError } from '../provider-helpers';
import { BaseOpenAIProvider } from '../baseOpenAI.provider';
import { resolveOpenAIReasoningEffort } from '../reasoning-config';

export class OpenAIProvider extends BaseOpenAIProvider {
	readonly providerId: string;
	protected readonly type = 'OpenAI';
	protected readonly baseUrl = 'https://api.openai.com';

	constructor(providerId: string, apiKey: string) {
		super(apiKey?.trim() ?? '');
		this.providerId = providerId;
		this.enableReasoning = true;
	}

	/** OpenAI 공식 API Structured Outputs 지원 식별자 반환 */
	protected override getStructuredOutputProvider(): 'openai' {
		return 'openai';
	}

	/** OpenAI 공식 API 프롬프트 캐시 키 및 추론 강도(reasoning_effort)를 주입합니다. */
	protected override buildPayload(
		options: ChatOptions,
		messages: ChatMessage[],
		stream: boolean,
	): Record<string, unknown> {
		const payload = super.buildPayload(options, messages, stream);
		if (options.promptCaching?.enabled && options.promptCaching.cacheKey) {
			payload.prompt_cache_key = options.promptCaching.cacheKey;
		}
		const reasoningEffort = resolveOpenAIReasoningEffort(options.model, options.reasoning);
		if (reasoningEffort) {
			payload.reasoning_effort = reasoningEffort;
		}
		return payload;
	}

	/** 스트리밍 전용 요청에도 prompt_cache_key와 reasoning_effort를 일관되게 주입합니다. */
	protected override buildStreamOnlyPayload(
		options: ChatOptions,
		messages: ChatMessage[],
	): Record<string, unknown> {
		const payload = super.buildStreamOnlyPayload(options, messages);
		if (options.promptCaching?.enabled && options.promptCaching.cacheKey) {
			payload.prompt_cache_key = options.promptCaching.cacheKey;
		}
		const reasoningEffort = resolveOpenAIReasoningEffort(options.model, options.reasoning);
		if (reasoningEffort) {
			payload.reasoning_effort = reasoningEffort;
		}
		return payload;
	}

	async listModels(): Promise<string[]> {
		try {
			const res = await requestUrl({
				url: `${this.baseUrl}/v1/models`,
				method: 'GET',
				headers: { Authorization: `Bearer ${this.apiKey}` },
			});
			const data = res.json as { data?: { id: string; created?: number }[] };
			const list = Array.isArray(data?.data) ? data.data : [];

			return list
				.filter((m) => /^gpt-|^o\d|^chatgpt-|^ft:gpt-/.test(m.id) || m.id.includes('embedding'))
				.sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
				.map((m) => m.id);
		} catch (error) {
			raiseApiError(error, 'OpenAI');
			return []; // should not reach here since raiseApiError throws
		}
	}
}