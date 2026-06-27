import { requestUrl } from 'obsidian';
import { raiseApiError } from '../provider-helpers';
import { BaseOpenAIProvider } from '../baseOpenAI.provider';

export class OpenAIProvider extends BaseOpenAIProvider {
	readonly providerId: string;
	protected readonly type = 'OpenAI';
	protected readonly baseUrl = 'https://api.openai.com';

	constructor(providerId: string, apiKey: string) {
		super(apiKey);
		this.providerId = providerId;
	}

	async listModels(): Promise<string[]> {
		try {
			const res = await requestUrl({
				url: `${this.baseUrl}/v1/models`,
				method: 'GET',
				headers: { Authorization: `Bearer ${this.apiKey}` },
			});
			const data = res.json as { data: { id: string; created: number }[] };

			return data.data
				.filter((m) => /^gpt-|^o\d|^chatgpt-/.test(m.id) || m.id.includes('embedding'))
				.sort((a, b) => b.created - a.created)
				.map((m) => m.id);
		} catch (error) {
			raiseApiError(error, 'OpenAI');
			return []; // should not reach here since raiseApiError throws
		}
	}
}