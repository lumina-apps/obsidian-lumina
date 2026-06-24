import { requestUrl } from 'obsidian';
import type { WebSearchProviderConfig } from '../../../shared/types/settings.types';
import type { IWebSearchProvider, SearchResult } from '../webSearchService';

export function createExaProvider(config: WebSearchProviderConfig): IWebSearchProvider {
	return {
		search: async (query: string, maxResults: number): Promise<SearchResult[]> => {
			if (!config.apiKey) {
				throw new Error('Exa API key is not configured.');
			}

			try {
				const response = await requestUrl({
					url: 'https://api.exa.ai/search',
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-api-key': config.apiKey,
					},
					body: JSON.stringify({
						query,
						numResults: maxResults,
						contents: {
							text: true
						}
					}),
				});

				const json = response.json;
				if (!json.results || !Array.isArray(json.results)) {
					return [];
				}

				return json.results.map((item: any) => ({
					title: item.title || '',
					url: item.url || '',
					content: item.text || item.summary || '',
				}));
			} catch (error) {
				console.error('Exa search failed:', error);
				throw new Error('Failed to fetch from Exa API');
			}
		},
	};
}
