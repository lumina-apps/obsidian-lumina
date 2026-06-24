import type { ToolDefinition } from '../../../shared/types/llm.types';
import type { WebSearchSettings } from '../../../core/settings/settings.types';
import { getWebSearchToolDefinition } from '../../web-search/webSearchTool';

export interface CollectWebSearchToolParams {
	webSearch: WebSearchSettings;
	isLocalProvider: boolean;
	useTextTools: boolean;
}

export function collectWebSearchTool(params: CollectWebSearchToolParams): ToolDefinition | null {
	const { webSearch, isLocalProvider, useTextTools } = params;

	if (!webSearch.enabled) {
		return null;
	}

	if (!isLocalProvider) {
		return null;
	}

	return getWebSearchToolDefinition();
}
