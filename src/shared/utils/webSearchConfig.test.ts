import { describe, it, expect } from 'vitest';
import { isWebSearchProviderConfigured } from './webSearchConfig';

describe('isWebSearchProviderConfigured', () => {
	it('config가 없으면 false', () => {
		expect(isWebSearchProviderConfigured(undefined)).toBe(false);
	});

	it('API 키 기반 provider는 공백이 아닌 키가 필요하다', () => {
		expect(isWebSearchProviderConfigured({ type: 'tavily', apiKey: 'k' })).toBe(true);
		expect(isWebSearchProviderConfigured({ type: 'brave', apiKey: '' })).toBe(false);
		expect(isWebSearchProviderConfigured({ type: 'exa', apiKey: '   ' })).toBe(false);
		expect(isWebSearchProviderConfigured({ type: 'serpapi' })).toBe(false);
	});

	it('searxng은 baseUrl이 필요하다', () => {
		expect(isWebSearchProviderConfigured({ type: 'searxng', baseUrl: 'http://localhost:8080' })).toBe(true);
		expect(isWebSearchProviderConfigured({ type: 'searxng', baseUrl: ' ' })).toBe(false);
	});

	it('google은 API 키와 CX가 모두 필요하다', () => {
		expect(isWebSearchProviderConfigured({ type: 'google', apiKey: 'k', googleSearchEngineId: 'cx' })).toBe(true);
		expect(isWebSearchProviderConfigured({ type: 'google', apiKey: 'k', googleSearchEngineId: '' })).toBe(false);
		expect(isWebSearchProviderConfigured({ type: 'google', apiKey: '', googleSearchEngineId: 'cx' })).toBe(false);
	});
});
