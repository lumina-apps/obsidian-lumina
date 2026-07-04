import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildMessages, estimateTokens } from './promptBuilder';
import type { UIChatMessage } from '../../shared/types/chat.types';
import type { ChatSettings } from '../../core/settings/settings.types';

// Mock helpers
vi.mock('../../shared/locales/helpers', () => ({
	t: (key: string) => key
}));
vi.mock('../../shared/debugLogger', () => ({
	debugLogger: {
		logWarn: vi.fn(),
	}
}));

describe('promptBuilder', () => {
	let mockChatSettings: ChatSettings;
	let mockHistory: UIChatMessage[];

	beforeEach(() => {
		mockChatSettings = {
			systemPrompts: [{ id: '1', name: 'Default', content: 'You are a helpful assistant.' }],
			activeSystemPromptId: '1',
			autoSaveHistory: false,
			historyPath: '',
			sendKey: 'enter',
			quickActions: [],
			inlineTrigger: '/ai',
			enableAutocomplete: false,
			memoryMethod: 'turns',
			contextWindowTurns: 10,
			useTokenLimit: false,
			maxContextTokens: 8000,
			temperature: 0.7,
			maxOutputTokens: 1000,
			streaming: true,
			responseLanguage: 'auto',
			agentEnabled: false,
			agentExecutionMode: 'edit',
			agentMaxSteps: 15,
		} as ChatSettings;

		mockHistory = [
			{ id: 'm1', role: 'user', content: 'Hello', isStreaming: false, timestamp: 1 },
			{ id: 'm2', role: 'assistant', content: 'Hi there', isStreaming: false, timestamp: 2 },
		];
	});

	it('should build basic messages with system prompt', () => {
		const messages = buildMessages(mockHistory, 'How are you?', { chat: mockChatSettings });
		expect(messages.length).toBe(4);
		expect(messages[0].role).toBe('system');
		expect(messages[0].content).toContain('You are a helpful assistant.');
		expect(messages[1].role).toBe('user');
		expect(messages[1].content).toBe('Hello');
		expect(messages[2].role).toBe('assistant');
		expect(messages[2].content).toBe('Hi there');
		expect(messages[3].role).toBe('user');
		expect(messages[3].content).toBe('How are you?');
	});

	it('should truncate history based on turns', () => {
		mockChatSettings.contextWindowTurns = 1;
		mockHistory.push(
			{ id: 'm3', role: 'user', content: 'Second question', isStreaming: false, timestamp: 3 },
			{ id: 'm4', role: 'assistant', content: 'Second answer', isStreaming: false, timestamp: 4 }
		);
		const messages = buildMessages(mockHistory, 'Third question', { chat: mockChatSettings });
		// system (1) + 1 turn (2) + current user (1) = 4
		expect(messages.length).toBe(4);
		expect(messages[1].content).toBe('Second question');
	});

	it('should truncate history based on tokens', () => {
		mockChatSettings.memoryMethod = 'tokens';
		mockChatSettings.maxContextTokens = 10; // ~40 characters
		
		mockHistory = [
			{ id: 'm1', role: 'user', content: 'Very long message that exceeds the limit significantly', isStreaming: false, timestamp: 1 },
			{ id: 'm2', role: 'assistant', content: 'Short ans', isStreaming: false, timestamp: 2 },
		];
		
		const messages = buildMessages(mockHistory, 'New question', { chat: mockChatSettings });
		// Only 'Short ans' should fit within tokens, along with system and new question
		expect(messages.length).toBe(3);
		expect(messages[1].role).toBe('assistant');
		expect(messages[1].content).toBe('Short ans');
	});

	it('should inject RAG context', () => {
		const ragContext = 'This is a rag context chunk.';
		const messages = buildMessages(mockHistory, 'What does the context say?', {
			chat: mockChatSettings,
			ragContext
		});
		
		const lastMessage = messages[messages.length - 1];
		expect(lastMessage.role).toBe('user');
		expect(lastMessage.content).toContain('[Context from the vault]');
		expect(lastMessage.content).toContain(ragContext);
		expect(lastMessage.content).toContain('What does the context say?');
	});

	it('should strip think tags from assistant messages', () => {
		mockHistory = [
			{ id: 'm1', role: 'assistant', content: '<think>Thinking process</think>\nActual response', isStreaming: false, timestamp: 1 }
		];
		const messages = buildMessages(mockHistory, 'Next', { chat: mockChatSettings });
		
		expect(messages[1].content).toBe('Actual response');
	});
});

describe('estimateTokens', () => {
	it('should estimate English text at ~4 chars per token', () => {
		const text = 'This is a test message.'; // 23 chars
		// cjkCount = 0, otherCount = 23
		// tokens = 23 * 0.25 = 5.75 -> Math.ceil(5.75) = 6
		expect(estimateTokens(text)).toBe(6);
	});

	it('should estimate Korean text at ~1.5 tokens per char', () => {
		const text = '안녕하세요'; // 5 chars
		// cjkCount = 5, otherCount = 0
		// tokens = 5 * 1.5 = 7.5 -> Math.ceil(7.5) = 8
		expect(estimateTokens(text)).toBe(8);
	});

	it('should estimate mixed text correctly', () => {
		const text = '안녕하세요 Hello'; // 5 CJK chars, 6 other chars (space + 'Hello')
		// tokens = (5 * 1.5) + (6 * 0.25) = 7.5 + 1.5 = 9
		expect(estimateTokens(text)).toBe(9);
	});

	it('should return 0 for empty string', () => {
		expect(estimateTokens('')).toBe(0);
	});
});
