import { requestUrl } from 'obsidian';
import type { WebSearchProviderConfig } from '../../../shared/types/settings.types';
import type { IWebSearchProvider, SearchResult } from '../webSearchService';

interface SerpapiOrganicResult {
	title?: string;
	link?: string;
	snippet?: string;
}

interface SerpapiSearchResponse {
	organic_results?: SerpapiOrganicResult[];
}

export function createSerpapiProvider(config: WebSearchProviderConfig): IWebSearchProvider {
	return {
		search: async (query: string, maxResults: number): Promise<SearchResult[]> => {
			if (!config.apiKey) {
				throw new Error('SerpApi key is not configured.');
			}

			try {
				// SerpAPI는 헤더 인증을 지원하지 않아 api_key가 URL 쿼리 파라미터에 포함됩니다.
				// URL 전체를 외부 로그/프록시에 노출하지 않도록 주의하세요.
				const url = new URL('https://serpapi.com/search');
				url.searchParams.append('engine', 'google');
				url.searchParams.append('api_key', config.apiKey);
				url.searchParams.append('q', query);
				url.searchParams.append('num', maxResults.toString());

				const response = await requestUrl({
					url: url.toString(),
					method: 'GET',
				});

				const json = response.json as unknown as SerpapiSearchResponse;
				if (!json || !json.organic_results || !Array.isArray(json.organic_results)) {
					return [];
				}

				return json.organic_results.map((item: SerpapiOrganicResult) => ({
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
