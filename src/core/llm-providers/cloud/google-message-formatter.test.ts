import { describe, it, expect } from 'vitest';
import { formatGeminiMessages, getGeminiSystemInstruction, formatGeminiTools } from './google-message-formatter';
import type { ChatMessage } from '../../../shared/types/llm.types';

describe('google-message-formatter', () => {
	it('should format simple user and assistant messages', () => {
		const messages: ChatMessage[] = [
			{ role: 'system', content: 'You are a helpful assistant.' },
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there!' },
		];

		const formatted = formatGeminiMessages(messages);

		// system role should be filtered out
		expect(formatted).toEqual([
			{ role: 'user', parts: [{ text: 'Hello' }] },
			{ role: 'model', parts: [{ text: 'Hi there!' }] },
		]);
	});

	it('should extract system instruction correctly', () => {
		const messages: ChatMessage[] = [
			{ role: 'system', content: 'Instruction 1' },
			{ role: 'system', content: 'Instruction 2' },
			{ role: 'user', content: 'Hello' },
		];

		const instruction = getGeminiSystemInstruction(messages);
		expect(instruction).toEqual({
			parts: [{ text: 'Instruction 1\nInstruction 2' }]
		});
	});

	it('should strip leading assistant/model and orphan tool messages so first message is always a normal user message', () => {
		const messages: ChatMessage[] = [
			{ role: 'assistant', content: 'Orphan assistant message from truncated history' },
			{ role: 'tool', name: 'read_note', content: 'Orphan tool result' },
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there' },
		];

		const formatted = formatGeminiMessages(messages);
		expect(formatted.length).toBe(2);
		expect(formatted[0].role).toBe('user');
		expect(formatted[0].parts).toEqual([{ text: 'Hello' }]);
		expect(formatted[1].role).toBe('model');
	});

	it('should format tool messages with role "user" and functionResponse parts', () => {
		const messages: ChatMessage[] = [
			{ role: 'user', content: 'Write one line into a test note' },
			{
				role: 'assistant',
				content: 'Calling tool: write_note',
				tool_calls: [
					{
						id: 'call_1',
						name: 'write_note',
						arguments: { path: 'test.md', content: 'hello' },
						thoughtSignature: 'sig-123',
					},
				],
			},
			{
				role: 'tool',
				tool_call_id: 'call_1',
				name: 'write_note',
				content: '{"status":"ok"}',
				thoughtSignature: 'sig-123',
			},
		];

		const formatted = formatGeminiMessages(messages);

		expect(formatted).toEqual([
			{ role: 'user', parts: [{ text: 'Write one line into a test note' }] },
			{
				role: 'model',
				parts: [
					{
						functionCall: {
							name: 'write_note',
							args: { path: 'test.md', content: 'hello' },
						},
						thoughtSignature: 'sig-123',
					},
				],
			},
			{
				role: 'user',
				parts: [
					{
						functionResponse: {
							name: 'write_note',
							response: { status: 'ok' },
						},
						thoughtSignature: 'sig-123',
					},
				],
			},
		]);
	});

	it('should coalesce consecutive tool messages into a single user message for parallel function calling', () => {
		const messages: ChatMessage[] = [
			{ role: 'user', content: 'Read both notes' },
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

		const formatted = formatGeminiMessages(messages);

		expect(formatted).toHaveLength(3);
		expect(formatted[0].role).toBe('user');
		expect(formatted[1].role).toBe('model');
		expect(formatted[2].role).toBe('user');
		expect(formatted[2].parts).toEqual([
			{
				functionResponse: {
					name: 'read_note',
					response: { content: 'Content of Note 1' },
				},
			},
			{
				functionResponse: {
					name: 'read_note',
					response: { content: 'Content of Note 2' },
				},
			},
		]);
	});
});

