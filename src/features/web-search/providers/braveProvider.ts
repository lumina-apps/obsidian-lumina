import { requestUrl } from 'obsidian';
import type { WebSearchProviderConfig } from '../../../shared/types/settings.types';
import type { IWebSearchProvider, SearchResult } from '../webSearchService';
import { formatSearchError } from './providerErrors';

interface BraveWebResult {
	title?: string;
	url?: string;
	description?: string;
}

interface BraveSearchResponse {
	web?: {
		results?: BraveWebResult[];
	};
}

export function createBraveProvider(config: WebSearchProviderConfig): IWebSearchProvider {
	const apiKey = config.apiKey?.trim();
	if (!apiKey) {
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
						'X-Subscription-Token': apiKey,
					},
				});

				const data = response.json as unknown as BraveSearchResponse;
				if (!data || typeof data !== 'object') {
					throw new Error('Invalid response from Brave API');
				}

				// 결과가 없으면 web 키 또는 results 키가 생략될 수 있음
				const results = data.web?.results;
				if (!Array.isArray(results)) return [];

				return results.map((r: BraveWebResult) => ({
					title: r.title || '',
					url: r.url || '',
					content: r.description || '',
				})).slice(0, maxResults);
			} catch (error) {
				throw new Error(formatSearchError('Brave search', error));
			}
		}
	};
}
