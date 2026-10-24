import { requestUrl } from 'obsidian';
import type { WebSearchProviderConfig } from '../../../shared/types/settings.types';
import type { IWebSearchProvider, SearchResult } from '../webSearchService';
import { formatSearchError } from './providerErrors';

interface TavilyResult {
	title?: string;
	url?: string;
	content?: string;
}

interface TavilySearchResponse {
	results?: TavilyResult[];
}

export function createTavilyProvider(config: WebSearchProviderConfig): IWebSearchProvider {
	const apiKey = config.apiKey?.trim();
	if (!apiKey) {
		throw new Error('Tavily API key is missing.');
	}

	return {
		async search(query: string, maxResults: number): Promise<SearchResult[]> {
			try {
				const response = await requestUrl({
					url: 'https://api.tavily.com/search',
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						// API 키를 Authorization 헤더로 전송 (body 노출 방지)
						'Authorization': `Bearer ${apiKey}`,
					},
					body: JSON.stringify({
						query: query,
						search_depth: 'basic',
						include_answer: false,
						include_images: false,
						include_raw_content: false,
						max_results: maxResults,
					}),
				});

				const data = response.json as unknown as TavilySearchResponse;
				if (!data || !data.results || !Array.isArray(data.results)) {
					throw new Error('Invalid response from Tavily API');
				}

				return data.results.map((r: TavilyResult) => ({
					title: r.title || '',
					url: r.url || '',
					content: r.content || '',
				}));
			} catch (error) {
				throw new Error(formatSearchError('Tavily search', error));
			}
		}
	};
}
