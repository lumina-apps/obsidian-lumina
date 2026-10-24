import type { WebSearchProviderConfig } from '../types/settings.types';

/** 웹 검색 provider에 필요한 설정(키/URL/CX)이 채워져 있는지 판별합니다. */
export function isWebSearchProviderConfigured(config: WebSearchProviderConfig | undefined): boolean {
	if (!config) return false;
	const apiKey = config.apiKey?.trim();

	switch (config.type) {
		case 'searxng':
			return !!config.baseUrl?.trim();
		case 'google':
			return !!apiKey && !!config.googleSearchEngineId?.trim();
		default:
			return !!apiKey;
	}
}
