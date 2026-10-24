import { requestUrl } from 'obsidian';
import type { WebSearchProviderConfig } from '../../../shared/types/settings.types';
import type { IWebSearchProvider, SearchResult } from '../webSearchService';
import { formatSearchError } from './providerErrors';

interface GoogleSearchResultItem {
	title?: string;
	link?: string;
	snippet?: string;
}

interface GoogleSearchResponse {
	items?: GoogleSearchResultItem[];
}

export function createGoogleSearchProvider(config: WebSearchProviderConfig): IWebSearchProvider {
	return {
		search: async (query: string, maxResults: number): Promise<SearchResult[]> => {
			const apiKey = config.apiKey?.trim();
			const cx = config.googleSearchEngineId?.trim();
			if (!apiKey || !cx) {
				throw new Error('Google Custom Search requires both an API Key and a Search Engine ID (CX).');
			}

			try {
				// Google Custom Search API는 헤더 인증을 지원하지 않아 key/cx가 URL 쿼리 파라미터에 포함됩니다.
				// URL 전체를 외부 로그/프록시에 노출하지 않도록 주의하세요.
				const url = new URL('https://www.googleapis.com/customsearch/v1');
				url.searchParams.append('key', apiKey);
				url.searchParams.append('cx', cx);
				url.searchParams.append('q', query);
				url.searchParams.append('num', maxResults.toString());

				const response = await requestUrl({
					url: url.toString(),
					method: 'GET',
				});

				const json = response.json as unknown as GoogleSearchResponse;
				if (!json || !json.items || !Array.isArray(json.items)) {
					return [];
				}

				return json.items.map((item: GoogleSearchResultItem) => ({
					title: item.title || '',
					url: item.link || '',
					content: item.snippet || '',
				}));
			} catch (error) {
				throw new Error(formatSearchError('Google Custom Search', error));
			}
		},
	};
}
