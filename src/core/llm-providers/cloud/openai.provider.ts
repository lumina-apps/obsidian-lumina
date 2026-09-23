import { requestUrl } from 'obsidian';
import { raiseApiError } from '../provider-helpers';
import { BaseOpenAIProvider } from '../baseOpenAI.provider';

export class OpenAIProvider extends BaseOpenAIProvider {
	readonly providerId: string;
	protected readonly type = 'OpenAI';
	protected readonly baseUrl = 'https://api.openai.com';

	constructor(providerId: string, apiKey: string) {
		super(apiKey?.trim() ?? '');
		this.providerId = providerId;
		this.enableReasoning = true;
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