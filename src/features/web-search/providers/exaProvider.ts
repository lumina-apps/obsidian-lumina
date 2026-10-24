import { requestUrl } from 'obsidian';
import type { WebSearchProviderConfig } from '../../../shared/types/settings.types';
import type { IWebSearchProvider, SearchResult } from '../webSearchService';
import { formatSearchError } from './providerErrors';

/** 결과당 요청할 본문 최대 길이 (전문 수신으로 인한 응답/비용 낭비 방지) */
const EXA_MAX_CHARACTERS = 2000;

interface ExaResult {
	title?: string;
	url?: string;
	text?: string;
	summary?: string;
}

interface ExaSearchResponse {
	results?: ExaResult[];
}

export function createExaProvider(config: WebSearchProviderConfig): IWebSearchProvider {
	return {
		search: async (query: string, maxResults: number): Promise<SearchResult[]> => {
			const apiKey = config.apiKey?.trim();
			if (!apiKey) {
				throw new Error('Exa API key is not configured.');
			}

			try {
				const response = await requestUrl({
					url: 'https://api.exa.ai/search',
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-api-key': apiKey,
					},
					body: JSON.stringify({
						query,
						numResults: maxResults,
						contents: {
							text: { maxCharacters: EXA_MAX_CHARACTERS }
						}
					}),
				});

				const json = response.json as unknown as ExaSearchResponse;
				if (!json || !json.results || !Array.isArray(json.results)) {
					return [];
				}

				return json.results.map((item: ExaResult) => ({
					title: item.title || '',
					url: item.url || '',
					content: item.text || item.summary || '',
				}));
			} catch (error) {
				throw new Error(formatSearchError('Exa search', error));
			}
		},
	};
}
