import { requestUrl } from 'obsidian';
import type { WebSearchProviderConfig } from '../../../shared/types/settings.types';
import type { IWebSearchProvider, SearchResult } from '../webSearchService';

export function createBraveProvider(config: WebSearchProviderConfig): IWebSearchProvider {
	if (!config.apiKey?.trim()) {
		throw new Error('Brave API key is missing.');
	}

	return {
		async search(query: string, maxResults: number): Promise<SearchResult[]> {
			try {
				const url = new URL('https://api.search.brave.com/res/v1/web/search');
				url.searchParams.append('q', query);
				url.searchParams.append('count', Math.min(maxResults, 20).toString());

				const response = await requestUrl({
					url: url.toString(),
					method: 'GET',
					headers: {
						'Accept': 'application/json',
						'Accept-Encoding': 'gzip',
						'X-Subscription-Token': config.apiKey || '',
					},
				});

				const data = response.json;
				if (!data || !data.web || !data.web.results || !Array.isArray(data.web.results)) {
					// Results may be empty
					if (data && !data.web) return [];
					throw new Error('Invalid response from Brave API');
				}

				return data.web.results.map((r: any) => ({
					title: r.title || '',
					url: r.url || '',
					content: r.description || '',
				})).slice(0, maxResults);
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				throw new Error(`Brave search failed: ${errorMsg}`);
			}
		}
	};
}
