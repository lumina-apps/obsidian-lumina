import { requestUrl } from 'obsidian';
import type { WebSearchProviderConfig } from '../../../shared/types/settings.types';
import type { IWebSearchProvider, SearchResult } from '../webSearchService';

export function createSerpapiProvider(config: WebSearchProviderConfig): IWebSearchProvider {
	return {
		search: async (query: string, maxResults: number): Promise<SearchResult[]> => {
			if (!config.apiKey) {
				throw new Error('SerpApi key is not configured.');
			}

			try {
				const url = new URL('https://serpapi.com/search');
				url.searchParams.append('engine', 'google');
				url.searchParams.append('api_key', config.apiKey);
				url.searchParams.append('q', query);
				url.searchParams.append('num', maxResults.toString());

				const response = await requestUrl({
					url: url.toString(),
					method: 'GET',
				});

				const json = response.json;
				if (!json.organic_results || !Array.isArray(json.organic_results)) {
					return [];
				}

				return json.organic_results.map((item: any) => ({
					title: item.title || '',
					url: item.link || '',
					content: item.snippet || '',
				}));
			} catch (error) {
				console.error('SerpApi search failed:', error);
				throw new Error('Failed to fetch from SerpApi');
			}
		},
	};
}
