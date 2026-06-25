import type { ToolDefinition } from '../../../shared/types/llm.types';
import type { WebSearchSettings } from '../../../core/settings/settings.types';
import { getWebSearchToolDefinition } from '../../web-search/webSearchTool';

export interface CollectWebSearchToolParams {
	webSearch: WebSearchSettings;
}

export function collectWebSearchTool(params: CollectWebSearchToolParams): ToolDefinition | null {
	const { webSearch } = params;

	if (!webSearch.enabled) {
		return null;
	}

	return getWebSearchToolDefinition();
}
