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

	it('should strip leading assistant/model messages so first message is always user', () => {
		const messages: ChatMessage[] = [
			{ role: 'assistant', content: 'Orphan assistant message from truncated history' },
			{ role: 'user', content: 'Hello' },
			{ role: 'assistant', content: 'Hi there' },
		];

		const formatted = formatGeminiMessages(messages);
		expect(formatted.length).toBe(2);
		expect(formatted[0].role).toBe('user');
		expect(formatted[0].parts).toEqual([{ text: 'Hello' }]);
		expect(formatted[1].role).toBe('model');
	});
});

