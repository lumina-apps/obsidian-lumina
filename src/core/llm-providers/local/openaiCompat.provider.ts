import type { ProviderType } from '../../../shared/types/settings.types';
import type { ChatOptions } from '../../../shared/types/llm.types';
import { t } from '../../../shared/locales/helpers';
import { requestUrl } from 'obsidian';
import { raiseApiError } from '../provider-helpers';
import { BaseOpenAIProvider } from '../baseOpenAI.provider';

/** 로컬 모델에서 사용하는 기본 stop 시퀀스 */
const LOCAL_STOP_SEQUENCES: string[] = [
	'<|im_end|>',
	'<|endoftext|>',
	'<|eot_id|>',
	'<|end_of_text|>',
];

export class OpenAICompatProvider extends BaseOpenAIProvider {
	readonly providerId: string;
	protected readonly type: ProviderType;
	protected readonly baseUrl: string;

	constructor(providerId: string, type: ProviderType, baseUrl: string, apiKey = 'ollama') {
		super(apiKey || 'ollama');
		this.providerId = providerId;
		this.type = type;
		// 후행 슬래시 제거
		this.baseUrl = baseUrl.replace(/\/$/, '');
		this.enableReasoning = true;
	}

	protected getStopSequences(options: ChatOptions): string[] | undefined {
		const stopSeq = options.stop ?? LOCAL_STOP_SEQUENCES;
		if (stopSeq.length > 0) {
			return stopSeq;
		}
		return undefined;
	}

	async listModels(): Promise<string[]> {
		if (this.type === 'ollama') {
			return this.listOllamaModels();
		}
		return this.listOpenAICompatModels();
	}

	private async listOllamaModels(): Promise<string[]> {
		try {
			const res = await requestUrl({
				url: `${this.baseUrl}/api/tags`,
				method: 'GET',
			});
			const data = res.json as { models: { name: string }[] };
			if (!data.models?.length) throw new Error(t('settings.providerErrors.ollamaNoModel'));
			return data.models.map((m) => m.name);
		} catch (error) {
			raiseApiError(error, 'Ollama');
			return []; // should not reach here since raiseApiError throws
		}
	}

	private async listOpenAICompatModels(): Promise<string[]> {
		try {
			const res = await requestUrl({
				url: `${this.baseUrl}/v1/models`,
				method: 'GET',
				headers: { Authorization: `Bearer ${this.apiKey}` },
			});
			const data = res.json as { data: { id: string }[] };
			return data.data.map((m) => m.id);
		} catch (error) {
			raiseApiError(error, this.type);
			return []; // should not reach here since raiseApiError throws
		}
	}

	async rerank(
		query: string,
		documents: string[],
		options: { model: string; topN?: number }
	): Promise<{ index: number; score: number }[]> {
		try {
			const res = await requestUrl({
				url: `${this.baseUrl}/v1/rerank`,
				method: 'POST',
				headers: this.buildHeaders(),
				body: JSON.stringify({
					model: options.model,
					query,
					documents,
					top_n: options.topN,
				}),
			});

			if (res.status >= 400) {
				throw new Error(`Rerank API Error: ${res.text}`);
			}

			const data = res.json as { results: { index: number; relevance_score: number }[] };
			if (!data.results) {
				throw new Error('Invalid response from rerank API');
			}

			return data.results.map((r) => ({
				index: r.index,
				score: r.relevance_score,
			}));
		} catch (error) {
			throw new Error(`${this.type} Reranking Error: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}