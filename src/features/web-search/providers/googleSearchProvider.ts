import { requestUrl } from 'obsidian';
import type { WebSearchProviderConfig } from '../../../shared/types/settings.types';
import type { IWebSearchProvider, SearchResult } from '../webSearchService';

export function createGoogleSearchProvider(config: WebSearchProviderConfig): IWebSearchProvider {
	return {
		search: async (query: string, maxResults: number): Promise<SearchResult[]> => {
			if (!config.apiKey || !config.googleSearchEngineId) {
				throw new Error('Google Custom Search requires both an API Key and a Search Engine ID (CX).');
			}

			try {
				const url = new URL('https://www.googleapis.com/customsearch/v1');
				url.searchParams.append('key', config.apiKey);
				url.searchParams.append('cx', config.googleSearchEngineId);
				url.searchParams.append('q', query);
				url.searchParams.append('num', maxResults.toString());

				const response = await requestUrl({
					url: url.toString(),
					method: 'GET',
				});

				const json = response.json;
				if (!json.items || !Array.isArray(json.items)) {
					return [];
				}

				return json.items.map((item: any) => ({
					title: item.title || '',
					url: item.link || '',
					content: item.snippet || '',
				}));
			} catch (error) {
				console.error('Google Custom Search failed:', error);
				throw new Error('Failed to fetch from Google Custom Search API');
			}
		},
	};
}
