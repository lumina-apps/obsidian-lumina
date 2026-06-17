import { t } from '../../../shared/locales/helpers';
import type { ToolName } from './toolTypes';

/** 툴 메타데이터 (ListTools 응답용) */
export interface ToolDefinition {
	name: ToolName;
	description: string;
	inputSchema: {
		type: 'object';
		properties: Record<string, { type: string; description: string }>;
		required?: string[];
	};
}

/**
 * 등록된 모든 툴의 메타데이터 정의를 반환합니다.
 * MCP ListTools 요청 핸들러에서 사용됩니다.
 */
export function getToolDefinitions(): ToolDefinition[] {
	return [
		{
			name: 'read_active_note',
			description: t('mcpServerTools.read_active_note.desc'),
			inputSchema: { type: 'object', properties: {} },
		},
		{
			name: 'read_note',
			description: t('mcpServerTools.read_note.desc'),
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: t('mcpServerTools.read_note.argPath') },
				},
				required: ['path'],
			},
		},
		{
			name: 'create_note',
			description: t('mcpServerTools.create_note.desc'),
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: t('mcpServerTools.create_note.argPath') },
					content: { type: 'string', description: t('mcpServerTools.create_note.argContent') },
				},
				required: ['path', 'content'],
			},
		},
		{
			name: 'search_notes',
			description: t('mcpServerTools.search_notes.desc'),
			inputSchema: {
				type: 'object',
				properties: {
					query: { type: 'string', description: t('mcpServerTools.search_notes.argQuery') },
				},
				required: ['query'],
			},
		},
		{
			name: 'append_to_note',
			description: t('mcpServerTools.append_to_note.desc'),
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: t('mcpServerTools.append_to_note.argPath') },
					content: { type: 'string', description: t('mcpServerTools.append_to_note.argContent') },
				},
				required: ['path', 'content'],
			},
		},
		{
			name: 'read_daily_note',
			description: t('mcpServerTools.read_daily_note.desc'),
			inputSchema: { type: 'object', properties: {} },
		},
		{
			name: 'append_to_daily_note',
			description: t('mcpServerTools.append_to_daily_note.desc'),
			inputSchema: {
				type: 'object',
				properties: {
					content: { type: 'string', description: t('mcpServerTools.append_to_daily_note.argContent') },
				},
				required: ['content'],
			},
		},
		{
			name: 'list_notes',
			description: t('mcpServerTools.list_notes.desc'),
			inputSchema: {
				type: 'object',
				properties: {
					path: { type: 'string', description: t('mcpServerTools.list_notes.argPath') },
				},
				required: [],
			},
		},
		{
			name: 'rag_search',
			description: t('mcpServerTools.rag_search.desc'),
			inputSchema: {
				type: 'object',
				properties: {
					query: { type: 'string', description: t('mcpServerTools.rag_search.argQuery') },
					top_k: { type: 'number', description: t('mcpServerTools.rag_search.argTopK') },
					min_similarity: { type: 'number', description: t('mcpServerTools.rag_search.argMinSimilarity') },
				},
				required: ['query'],
			},
		},
	];
}