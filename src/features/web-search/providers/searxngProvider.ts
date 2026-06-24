import { requestUrl } from 'obsidian';
import type { WebSearchProviderConfig } from '../../../shared/types/settings.types';
import type { IWebSearchProvider, SearchResult } from '../webSearchService';

export function createSearxngProvider(config: WebSearchProviderConfig): IWebSearchProvider {
	if (!config.baseUrl?.trim()) {
		throw new Error('SearXNG base URL is missing.');
	}

	const baseUrl = config.baseUrl.replace(/\/$/, ''); // remove trailing slash

	return {
		async search(query: string, maxResults: number): Promise<SearchResult[]> {
			try {
				const url = new URL(`${baseUrl}/search`);
				url.searchParams.append('q', query);
				url.searchParams.append('format', 'json');

				const response = await requestUrl({
					url: url.toString(),
					method: 'GET',
				});

				const data = response.json;
				if (!data || !data.results || !Array.isArray(data.results)) {
					throw new Error('Invalid response from SearXNG API');
				}

				return data.results.map((r: any) => ({
					title: r.title || '',
					url: r.url || '',
					content: r.content || r.snippet || '',
				})).slice(0, maxResults);
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				throw new Error(`SearXNG search failed: ${errorMsg}`);
			}
		}
	};
}
