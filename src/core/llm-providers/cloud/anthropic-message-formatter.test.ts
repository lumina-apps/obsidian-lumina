import { describe, it, expect } from 'vitest';
import {
	applyAnthropicMessageCacheBreakpoints,
	formatAnthropicMessages,
	formatAnthropicSystem,
	formatAnthropicTools,
} from './anthropic-message-formatter';
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

	it('should strip leading assistant and orphan tool_result messages so first message is always a normal user message', () => {
		const messages: ChatMessage[] = [
			{ role: 'assistant', content: 'Orphan assistant message from truncated history' },
			{ role: 'tool', tool_call_id: 'orphan_1', content: 'Orphan tool result' },
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there' },
		];

		const formatted = formatAnthropicMessages(messages);
		expect(formatted.length).toBe(2);
		expect(formatted[0].role).toBe('user');
		expect(formatted[0].content).toBe('Hello');
		expect(formatted[1].role).toBe('assistant');
	});

	it('should format multimodal user messages with base64 images into Anthropic image blocks', () => {
		const messages: ChatMessage[] = [
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'What is this image?' },
					{
						type: 'image_url',
						image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' },
					},
				],
			},
		];

		const formatted = formatAnthropicMessages(messages);
		expect(formatted).toEqual([
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'What is this image?' },
					{
						type: 'image',
						source: {
							type: 'base64',
							media_type: 'image/png',
							data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
						},
					},
				],
			},
		]);
	});

	it('should handle unsupported image MIME types gracefully', () => {
		const messages: ChatMessage[] = [
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'Unsupported' },
					{
						type: 'image_url',
						image_url: { url: 'data:image/bmp;base64,Qk0=' },
					},
				],
			},
		];

		const formatted = formatAnthropicMessages(messages);
		expect(formatted).toEqual([
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'Unsupported' },
					{ type: 'text', text: '[Unsupported image type: image/bmp]' },
				],
			},
		]);
	});

	it('should remove empty assistant messages and coalesce consecutive user messages', () => {
		const messages: ChatMessage[] = [
			{ role: 'user', content: '📋 [Previous conversation compressed]\n\nSummary text' },
			{ role: 'user', content: 'First question after compression' },
			{ role: 'assistant', content: '' },
			{ role: 'user', content: 'Retry question after empty assistant' },
		];

		const formatted = formatAnthropicMessages(messages);
		expect(formatted).toHaveLength(1);
		expect(formatted[0].role).toBe('user');
		expect(formatted[0].content).toBe(
			'📋 [Previous conversation compressed]\n\nSummary text\n\nFirst question after compression\n\nRetry question after empty assistant',
		);
	});

	it('should format system prompt with cache_control and split dynamic summary block when caching is enabled', () => {
		const staticSys = 'You are a helpful assistant.';
		const summarySys = `${staticSys}\n\n[이전 대화 요약]\nOld summary`;

		expect(formatAnthropicSystem(staticSys, false)).toBe(staticSys);
		expect(formatAnthropicSystem(staticSys, true)).toEqual([
			{ type: 'text', text: staticSys, cache_control: { type: 'ephemeral' } },
		]);
		expect(formatAnthropicSystem(summarySys, true)).toEqual([
			{ type: 'text', text: staticSys, cache_control: { type: 'ephemeral' } },
			{ type: 'text', text: '\n\n[이전 대화 요약]\nOld summary' },
		]);
	});

	it('should attach cache_control only to the last tool when enableCaching is true', () => {
		const tools: ToolDefinition[] = [
			{ name: 'tool_a', description: 'A', inputSchema: { type: 'object', properties: {} } },
			{ name: 'tool_b', description: 'B', inputSchema: { type: 'object', properties: {} } },
		];
		const formatted = formatAnthropicTools(tools, true)!;
		expect((formatted[0] as Record<string, unknown>).cache_control).toBeUndefined();
		expect((formatted[1] as Record<string, unknown>).cache_control).toEqual({ type: 'ephemeral' });
	});

	it('should apply rolling cache breakpoints to at most last 2 non-empty user messages and skip empty text blocks', () => {
		const formatted = formatAnthropicMessages([
			{ role: 'user', content: 'Turn 1' },
			{ role: 'assistant', content: 'Ans 1' },
			{ role: 'user', content: 'Turn 2' },
			{ role: 'assistant', content: 'Ans 2' },
			{ role: 'user', content: 'Turn 3' },
		]);

		const cached = applyAnthropicMessageCacheBreakpoints(formatted);
		expect(cached[0].content).toBe('Turn 1');
		expect(cached[2].content).toEqual([
			{ type: 'text', text: 'Turn 2', cache_control: { type: 'ephemeral' } },
		]);
		expect(cached[4].content).toEqual([
			{ type: 'text', text: 'Turn 3', cache_control: { type: 'ephemeral' } },
		]);

		// 빈 텍스트 블록에는 cache_control을 붙이지 않음
		const emptyResult = applyAnthropicMessageCacheBreakpoints([{ role: 'user', content: '' }]);
		expect(emptyResult[0].content).toBe('');
	});

	it('should preserve assistant thinkingBlocks before text and tool_use blocks', () => {
		const messages: ChatMessage[] = [
			{ role: 'user', content: 'Inspect note' },
			{
				role: 'assistant',
				content: 'I will inspect the note.',
				thinkingBlocks: [
					{ type: 'thinking', thinking: 'Let me check', signature: 'sig-abc' },
					{ type: 'redacted_thinking', data: 'redacted-xyz' },
				],
				tool_calls: [{ id: 'tc-1', name: 'read_note', arguments: { path: 'a.md' } }],
			},
			{ role: 'tool', tool_call_id: 'tc-1', content: 'file content' },
		];

		const formatted = formatAnthropicMessages(messages);
		expect(formatted[1]).toEqual({
			role: 'assistant',
			content: [
				{ type: 'thinking', thinking: 'Let me check', signature: 'sig-abc' },
				{ type: 'redacted_thinking', data: 'redacted-xyz' },
				{ type: 'text', text: 'I will inspect the note.' },
				{ type: 'tool_use', id: 'tc-1', name: 'read_note', input: { path: 'a.md' } },
			],
		});
	});
});

