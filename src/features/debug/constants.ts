import type { DebugLogType } from '../../shared/types/debug.types';

export interface FilterOption {
	value: DebugLogType | 'all';
	label: string;
}

export const FILTER_OPTIONS: FilterOption[] = [
	{ value: 'all', label: 'All' },
	{ value: 'llm-request', label: 'Request' },
	{ value: 'llm-response', label: 'Response' },
	{ value: 'rag', label: 'RAG' },
	{ value: 'system', label: 'System' },
	{ value: 'error', label: 'Error' },
	{ value: 'mcp', label: 'MCP' },
];

export const TYPE_LABEL_MAP: Record<DebugLogType, string> = {
	'llm-request': 'REQUEST',
	'llm-response': 'RESPONSE',
	'rag': 'RAG',
	'system': 'SYSTEM',
	'error': 'ERROR',
	'mcp': 'MCP',
};