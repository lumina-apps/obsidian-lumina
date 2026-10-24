import { requestUrl } from 'obsidian';
import type { WebSearchProviderConfig } from '../../../shared/types/settings.types';
import type { IWebSearchProvider, SearchResult } from '../webSearchService';
import { formatSearchError } from './providerErrors';

interface SearxngResult {
	title?: string;
	url?: string;
	content?: string;
	snippet?: string;
}

interface SearxngSearchResponse {
	results?: SearxngResult[];
}

export function createSearxngProvider(config: WebSearchProviderConfig): IWebSearchProvider {
	const rawBaseUrl = config.baseUrl?.trim();
	if (!rawBaseUrl) {
		throw new Error('SearXNG base URL is missing.');
	}

	const baseUrl = rawBaseUrl.replace(/\/+$/, ''); // remove trailing slash

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

				const data = response.json as unknown as SearxngSearchResponse;
				if (!data || !data.results || !Array.isArray(data.results)) {
					throw new Error('Invalid response from SearXNG API');
				}

				return data.results.map((r: SearxngResult) => ({
					title: r.title || '',
					url: r.url || '',
					content: r.content || r.snippet || '',
				})).slice(0, maxResults);
			} catch (error) {
				throw new Error(
					formatSearchError('SearXNG search', error, {
						403: 'The JSON format may be disabled on this SearXNG instance. Add "json" to search.formats in settings.yml.',
					}),
				);
			}
		}
	};
}
