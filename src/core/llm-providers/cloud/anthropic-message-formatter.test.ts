import { describe, it, expect } from 'vitest';
import { formatAnthropicMessages, formatAnthropicTools } from './anthropic-message-formatter';
import type { ChatMessage, ToolDefinition } from '../../../shared/types/llm.types';

describe('anthropic-message-formatter', () => {
	it('should format simple user and assistant messages', () => {
		const messages: ChatMessage[] = [
			{ role: 'system', content: 'You are a helpful assistant.' },
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there!' },
		];

		const formatted = formatAnthropicMessages(messages);

		// system role should be filtered out
		expect(formatted).toEqual([
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: [{ type: 'text', text: 'Hi there!' }] },
		]);
	});

	it('should coalesce consecutive tool_result messages into a single user message', () => {
		const messages: ChatMessage[] = [
			{ role: 'user', content: 'Read these notes' },
			{
				role: 'assistant',
				content: '',
				tool_calls: [
					{ id: 'call_1', name: 'read_note', arguments: { path: 'Note1.md' } },
					{ id: 'call_2', name: 'read_note', arguments: { path: 'Note2.md' } },
				],
			},
			{
				role: 'tool',
				tool_call_id: 'call_1',
				name: 'read_note',
				content: 'Content of Note 1',
			},
			{
				role: 'tool',
				tool_call_id: 'call_2',
				name: 'read_note',
				content: 'Content of Note 2',
			},
		];

		const formatted = formatAnthropicMessages(messages);

		// Must have strictly alternating roles: user -> assistant -> user (merged tool results)
		expect(formatted.length).toBe(3);
		expect(formatted[0].role).toBe('user');
		expect(formatted[1].role).toBe('assistant');
		expect(formatted[2].role).toBe('user');

		const userToolResults = formatted[2];
		expect(Array.isArray(userToolResults.content)).toBe(true);
		expect(userToolResults.content).toEqual([
			{
				type: 'tool_result',
				tool_use_id: 'call_1',
				content: 'Content of Note 1',
			},
			{
				type: 'tool_result',
				tool_use_id: 'call_2',
				content: 'Content of Note 2',
			},
		]);
	});

	it('should format tools correctly', () => {
		const tools: ToolDefinition[] = [
			{
				name: 'search_notes',
				description: 'Search notes by keyword',
				inputSchema: {
					type: 'object',
					properties: {
						query: { type: 'string' },
					},
					required: ['query'],
				},
			},
		];

		const formatted = formatAnthropicTools(tools);
		expect(formatted).toEqual([
			{
				name: 'search_notes',
				description: 'Search notes by keyword',
				input_schema: {
					type: 'object',
					properties: { query: { type: 'string' } },
					required: ['query'],
				},
			},
		]);
	});

	it('should return undefined for empty tools', () => {
		expect(formatAnthropicTools(undefined)).toBeUndefined();
		expect(formatAnthropicTools([])).toBeUndefined();
	});
});

