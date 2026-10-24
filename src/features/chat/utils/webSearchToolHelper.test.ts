import { describe, it, expect } from 'vitest';
import { collectWebSearchTool } from './webSearchToolHelper';
import type { WebSearchSettings } from '../../../core/settings/settings.types';

function makeSettings(enabled: boolean): WebSearchSettings {
	return {
		enabled,
		activeProviderId: 'tavily',
		maxResults: 5,
		maxContentLength: 3000,
		providers: [{ type: 'tavily', apiKey: 'k' }],
	};
}

describe('collectWebSearchTool', () => {
	it('웹 검색이 꺼져 있으면 null을 반환한다', () => {
		expect(collectWebSearchTool({ webSearch: makeSettings(false) })).toBeNull();
	});

	it('웹 검색이 켜져 있으면 툴 정의를 반환한다', () => {
		const tool = collectWebSearchTool({ webSearch: makeSettings(true) });
		expect(tool?.name).toBe('lumina_web_search');
	});
});
