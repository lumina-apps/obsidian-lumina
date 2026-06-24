import type { WebSearchProviderConfig } from '../../shared/types/settings.types';
import { createTavilyProvider } from './providers/tavilyProvider';
import { createBraveProvider } from './providers/braveProvider';
import { createSearxngProvider } from './providers/searxngProvider';
import { createExaProvider } from './providers/exaProvider';
import { createGoogleSearchProvider } from './providers/googleSearchProvider';
import { createSerpapiProvider } from './providers/serpapiProvider';

export interface SearchResult {
	title: string;
	url: string;
	content: string;
}

export interface IWebSearchProvider {
	search(query: string, maxResults: number): Promise<SearchResult[]>;
}

export function createWebSearchProvider(config: WebSearchProviderConfig): IWebSearchProvider {
	switch (config.type) {
		case 'tavily':
			return createTavilyProvider(config);
		case 'brave':
			return createBraveProvider(config);
		case 'searxng':
			return createSearxngProvider(config);
		case 'exa':
			return createExaProvider(config);
		case 'google':
			return createGoogleSearchProvider(config);
		case 'serpapi':
			return createSerpapiProvider(config);
		default:
			throw new Error(`Unsupported search provider: ${config.type}`);
	}
}
