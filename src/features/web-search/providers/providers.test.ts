import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestUrl } from 'obsidian';
import { createTavilyProvider } from './tavilyProvider';
import { createBraveProvider } from './braveProvider';
import { createSearxngProvider } from './searxngProvider';
import { createExaProvider } from './exaProvider';
import { createGoogleSearchProvider } from './googleSearchProvider';
import { createSerpapiProvider } from './serpapiProvider';
import { extractHttpStatus, formatSearchError } from './providerErrors';

const mockRequestUrl = vi.mocked(requestUrl);

function respond(json: unknown): void {
	mockRequestUrl.mockResolvedValueOnce({
		status: 200,
		headers: {},
		arrayBuffer: new ArrayBuffer(0),
		text: '',
		json,
	});
}

function lastCall(): { url: string; body?: string; headers?: Record<string, string>; method?: string } {
	return mockRequestUrl.mock.calls[mockRequestUrl.mock.calls.length - 1][0] as {
		url: string;
		body?: string;
		headers?: Record<string, string>;
		method?: string;
	};
}

describe('web search providers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockRequestUrl.mockReset();
	});

	describe('tavily', () => {
		it('parses results and sends trimmed Bearer auth with max_results', async () => {
			respond({ results: [{ title: 'A', url: 'https://a.com', content: 'ca' }] });
			const results = await createTavilyProvider({ type: 'tavily', apiKey: '  k  ' }).search('q', 3);
			expect(results).toEqual([{ title: 'A', url: 'https://a.com', content: 'ca' }]);
			expect(lastCall().headers?.Authorization).toBe('Bearer k');
			expect(lastCall().body).toContain('"max_results":3');
		});

		it('throws when API key is blank', () => {
			expect(() => createTavilyProvider({ type: 'tavily', apiKey: '  ' })).toThrow('Tavily API key is missing.');
		});

		it('throws on invalid response shape', async () => {
			respond({});
			await expect(createTavilyProvider({ type: 'tavily', apiKey: 'k' }).search('q', 3)).rejects.toThrow(
				'Tavily search failed: Invalid response from Tavily API',
			);
		});
	});

	describe('brave', () => {
		it('parses results, passes count and trimmed token header, slices to maxResults', async () => {
			respond({
				web: {
					results: [
						{ title: 'A', url: 'https://a.com', description: 'da' },
						{ title: 'B', url: 'https://b.com', description: 'db' },
					],
				},
			});
			const results = await createBraveProvider({ type: 'brave', apiKey: '  k  ' }).search('q', 1);
			expect(results).toEqual([{ title: 'A', url: 'https://a.com', content: 'da' }]);
			expect(lastCall().url).toContain('count=1');
			expect(lastCall().headers?.['X-Subscription-Token']).toBe('k');
		});

		it('returns [] when web key is missing', async () => {
			respond({ query: { original: 'q' } });
			await expect(createBraveProvider({ type: 'brave', apiKey: 'k' }).search('q', 3)).resolves.toEqual([]);
		});

		it('returns [] when web exists but results is missing', async () => {
			respond({ web: { type: 'search' } });
			await expect(createBraveProvider({ type: 'brave', apiKey: 'k' }).search('q', 3)).resolves.toEqual([]);
		});

		it('throws on a non-object response', async () => {
			respond(null);
			await expect(createBraveProvider({ type: 'brave', apiKey: 'k' }).search('q', 3)).rejects.toThrow(
				'Brave search failed: Invalid response from Brave API',
			);
		});
	});

	describe('searxng', () => {
		it('parses results, trims base URL, requests json format and respects maxResults', async () => {
			respond({
				results: [
					{ title: 'A', url: 'https://a.com', content: 'ca' },
					{ title: 'B', url: 'https://b.com', snippet: 'sb' },
				],
			});
			const results = await createSearxngProvider({ type: 'searxng', baseUrl: '  http://localhost:8080/  ' }).search('q', 2);
			expect(results).toHaveLength(2);
			expect(results[1].content).toBe('sb');
			expect(lastCall().url).toBe('http://localhost:8080/search?q=q&format=json');
		});

		it('adds a hint when the JSON format is disabled (403)', async () => {
			mockRequestUrl.mockRejectedValueOnce(new Error('Request failed, status 403'));
			await expect(
				createSearxngProvider({ type: 'searxng', baseUrl: 'http://localhost:8080' }).search('q', 2),
			).rejects.toThrow(/SearXNG search failed: Request failed, status 403 \(.*search\.formats.*\)/);
		});

		it('throws when base URL is missing', () => {
			expect(() => createSearxngProvider({ type: 'searxng', baseUrl: ' ' })).toThrow('SearXNG base URL is missing.');
		});
	});

	describe('exa', () => {
		it('parses results (text, falling back to summary), trims key and limits text size', async () => {
			respond({
				results: [
					{ title: 'A', url: 'https://a.com', text: 'ta' },
					{ title: 'B', url: 'https://b.com', summary: 'sb' },
				],
			});
			const results = await createExaProvider({ type: 'exa', apiKey: '  k  ' }).search('q', 2);
			expect(results.map((r) => r.content)).toEqual(['ta', 'sb']);
			const body = JSON.parse(lastCall().body ?? '{}') as {
				numResults: number;
				contents: { text: { maxCharacters: number } };
			};
			expect(body.numResults).toBe(2);
			expect(body.contents.text.maxCharacters).toBe(2000);
			expect(lastCall().headers?.['x-api-key']).toBe('k');
		});

		it('rejects a blank API key', async () => {
			await expect(createExaProvider({ type: 'exa', apiKey: '   ' }).search('q', 2)).rejects.toThrow(
				'Exa API key is not configured.',
			);
		});
	});

	describe('google', () => {
		it('parses items and passes trimmed key/cx/num', async () => {
			respond({ items: [{ title: 'A', link: 'https://a.com', snippet: 'sa' }] });
			const results = await createGoogleSearchProvider({
				type: 'google',
				apiKey: '  k  ',
				googleSearchEngineId: '  cx  ',
			}).search('q', 4);
			expect(results).toEqual([{ title: 'A', url: 'https://a.com', content: 'sa' }]);
			const url = new URL(lastCall().url);
			expect(url.searchParams.get('key')).toBe('k');
			expect(url.searchParams.get('cx')).toBe('cx');
			expect(url.searchParams.get('num')).toBe('4');
		});

		it('returns [] when items are missing', async () => {
			respond({});
			await expect(
				createGoogleSearchProvider({ type: 'google', apiKey: 'k', googleSearchEngineId: 'cx' }).search('q', 4),
			).resolves.toEqual([]);
		});

		it('requires non-blank key and CX', async () => {
			await expect(
				createGoogleSearchProvider({ type: 'google', apiKey: 'k', googleSearchEngineId: '  ' }).search('q', 4),
			).rejects.toThrow('Google Custom Search requires both an API Key and a Search Engine ID (CX).');
		});
	});

	describe('serpapi', () => {
		it('parses organic_results and passes trimmed api_key/num', async () => {
			respond({ organic_results: [{ title: 'A', link: 'https://a.com', snippet: 'sa' }] });
			const results = await createSerpapiProvider({ type: 'serpapi', apiKey: '  k  ' }).search('q', 6);
			expect(results).toEqual([{ title: 'A', url: 'https://a.com', content: 'sa' }]);
			const url = new URL(lastCall().url);
			expect(url.searchParams.get('api_key')).toBe('k');
			expect(url.searchParams.get('num')).toBe('6');
		});

		it('returns [] when organic_results are missing', async () => {
			respond({});
			await expect(createSerpapiProvider({ type: 'serpapi', apiKey: 'k' }).search('q', 6)).resolves.toEqual([]);
		});

		it('rejects a blank API key', async () => {
			await expect(createSerpapiProvider({ type: 'serpapi', apiKey: ' ' }).search('q', 6)).rejects.toThrow(
				'SerpApi key is not configured.',
			);
		});
	});

	describe('error hints', () => {
		it.each([
			['Tavily search', createTavilyProvider({ type: 'tavily', apiKey: 'k' })],
			['Brave search', createBraveProvider({ type: 'brave', apiKey: 'k' })],
			['Exa search', createExaProvider({ type: 'exa', apiKey: 'k' })],
			[
				'Google Custom Search',
				createGoogleSearchProvider({ type: 'google', apiKey: 'k', googleSearchEngineId: 'cx' }),
			],
			['SerpApi search', createSerpapiProvider({ type: 'serpapi', apiKey: 'k' })],
		])('%s: 401 and 429 produce actionable hints', async (label, provider) => {
			mockRequestUrl.mockRejectedValueOnce(new Error('Request failed, status 401'));
			await expect(provider.search('q', 2)).rejects.toThrow(
				new RegExp(`${label} failed: Request failed, status 401 \\(Authentication failed`),
			);
			mockRequestUrl.mockRejectedValueOnce(new Error('Request failed, status 429'));
			await expect(provider.search('q', 2)).rejects.toThrow(
				new RegExp(`${label} failed: Request failed, status 429 \\(Rate limit`),
			);
		});
	});
});

describe('providerErrors', () => {
	it('extractHttpStatus parses status codes', () => {
		expect(extractHttpStatus('Request failed, status 429')).toBe(429);
		expect(extractHttpStatus('Network error')).toBeUndefined();
	});

	it('formatSearchError leaves messages without a status untouched', () => {
		expect(formatSearchError('Tavily search', new Error('Network error'))).toBe('Tavily search failed: Network error');
		expect(formatSearchError('Tavily search', 'boom')).toBe('Tavily search failed: boom');
	});

	it('formatSearchError does not add hints for other statuses', () => {
		expect(formatSearchError('Brave search', new Error('Request failed, status 500'))).toBe(
			'Brave search failed: Request failed, status 500',
		);
	});

	it('formatSearchError prefers custom hints', () => {
		expect(formatSearchError('X', new Error('status 403'), { 403: 'custom' })).toBe(
			'X failed: status 403 (custom)',
		);
	});
});
