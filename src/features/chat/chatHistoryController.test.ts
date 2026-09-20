import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatHistoryController } from './chatHistoryController';
import { ChatController } from './chatController';
import {
	resetChat,
	addMessage,
	currentSessionId,
	currentSessionTitle,
	sessionProviderId,
	sessionModelId,
} from '../../core/store/chatStore';
import { get } from 'svelte/store';
import type LuminaPlugin from '../../main';
import * as historyModule from './history';

vi.mock('obsidian', () => ({
	normalizePath: (p: string) => p.replace(/\/+/g, '/').replace(/\/$/, ''),
	Notice: vi.fn(),
	FileSystemAdapter: class FileSystemAdapter {
		getBasePath(): string { return ''; }
	},
}));

vi.mock('./history', () => ({
	saveSession: vi.fn().mockResolvedValue(undefined),
	loadSession: vi.fn().mockResolvedValue(null),
	loadSessionsList: vi.fn().mockResolvedValue([]),
	deleteSession: vi.fn().mockResolvedValue(true),
	renameSession: vi.fn().mockResolvedValue({ id: 'test-id', title: 'Renamed Title' }),
	generateTitle: vi.fn().mockReturnValue('Fallback Title'),
	generateTitleWithLLM: vi.fn().mockResolvedValue('LLM Generated Title'),
	exportSessionToMarkdown: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../core/store/projectStore', () => ({
	getActiveProject: vi.fn().mockReturnValue({
		id: 'default',
		historySubfolder: '',
	}),
}));

describe('ChatHistoryController & ChatController History Lifecycle', () => {
	let mockPlugin: LuminaPlugin;

	beforeEach(() => {
		resetChat();
		vi.clearAllMocks();

		mockPlugin = {
			app: {
				vault: {
					adapter: { exists: vi.fn().mockResolvedValue(true) },
				},
			},
			settings: {
				chat: {
					historyPath: 'chatHistory',
					autoSaveHistory: true,
				},
				connections: {
					providers: [
						{
							id: 'openai-p1',
							name: 'OpenAI',
							type: 'openai',
							isVerified: true,
							availableModels: ['gpt-4o'],
						},
					],
				},
			},
		} as unknown as LuminaPlugin;
	});

	afterEach(() => {
		resetChat();
	});

	it('should resolve historyPath to default chatHistory when setting is empty', () => {
		mockPlugin.settings.chat.historyPath = '   ';
		const historyCtrl = new ChatHistoryController(mockPlugin);
		const path = historyCtrl.resolveHistoryPath();
		expect(path).toBe('chatHistory');
	});

	it('should assign currentSessionId before title generation to prevent race conditions', async () => {
		const historyCtrl = new ChatHistoryController(mockPlugin);
		addMessage({
			id: 'm1',
			role: 'user',
			content: 'Hello world',
			timestamp: 1000,
			isStreaming: false,
		});
		addMessage({
			id: 'm2',
			role: 'assistant',
			content: 'Hi there!',
			timestamp: 2000,
			isStreaming: false,
		});

		expect(get(currentSessionId)).toBeNull();

		await historyCtrl.saveHistory('openai-p1', 'gpt-4o');

		const assignedId = get(currentSessionId);
		expect(assignedId).not.toBeNull();
		expect(typeof assignedId).toBe('string');
		expect(get(currentSessionTitle)).toBe('LLM Generated Title');
		expect(historyModule.saveSession).toHaveBeenCalledTimes(1);
	});

	it('should not overwrite currentSessionTitle if session was reset during async title generation', async () => {
		// Simulate slow LLM title generation
		vi.mocked(historyModule.generateTitleWithLLM).mockImplementationOnce(async () => {
			// Simulate user clicking "New Chat" while LLM is generating title
			resetChat();
			return 'Late Title';
		});

		const historyCtrl = new ChatHistoryController(mockPlugin);
		addMessage({
			id: 'm1',
			role: 'user',
			content: 'Question',
			timestamp: 1000,
			isStreaming: false,
		});

		await historyCtrl.saveHistory('openai-p1', 'gpt-4o');

		// Because resetChat() occurred during generation, the new chat should remain clean
		expect(get(currentSessionId)).toBeNull();
		expect(get(currentSessionTitle)).toBeNull();
	});

	it('should rename session in memory if currently active and call history module', async () => {
		const historyCtrl = new ChatHistoryController(mockPlugin);
		currentSessionId.set('active-session-123');
		currentSessionTitle.set('Old Title');

		const success = await historyCtrl.renameSession('active-session-123', 'New Lovely Title');
		expect(success).toBe(true);
		expect(get(currentSessionTitle)).toBe('New Lovely Title');
		expect(historyModule.renameSession).toHaveBeenCalledWith(
			mockPlugin.app,
			'active-session-123',
			'New Lovely Title',
			'chatHistory',
		);
	});

	it('should queue concurrent saveHistory requests without dropping the latest state', async () => {
		let resolveFirstSave: () => void = () => {};
		const firstSavePromise = new Promise<void>((resolve) => {
			resolveFirstSave = resolve;
		});

		let callCount = 0;
		vi.mocked(historyModule.saveSession).mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				await firstSavePromise;
			}
		});

		const chatCtrl = new ChatController(mockPlugin);
		addMessage({ id: 'm1', role: 'user', content: 'Msg 1', timestamp: 1000, isStreaming: false });
		addMessage({ id: 'm2', role: 'assistant', content: 'Resp 1', timestamp: 2000, isStreaming: false });

		// Start first save (holds the lock)
		const save1 = chatCtrl.saveHistory('openai-p1', 'gpt-4o');

		// While first save is in-flight, trigger a second save
		const save2 = chatCtrl.saveHistory('openai-p1', 'gpt-4o');

		// Unlock first save
		resolveFirstSave();
		await Promise.all([save1, save2]);

		// Both saves should have been processed (save1 finished, and save2 ran afterwards)
		expect(callCount).toBe(2);
		chatCtrl.destroy();
	});

	it('should flush pending autoSaveTimeout on controller destroy', async () => {
		vi.useFakeTimers();
		const chatCtrl = new ChatController(mockPlugin);

		addMessage({ id: 'm1', role: 'user', content: 'User msg', timestamp: 1000, isStreaming: false });
		addMessage({ id: 'm2', role: 'assistant', content: 'AI msg', timestamp: 2000, isStreaming: false });

		// Manually set lastProviderId/modelId or sessionProviderId
		sessionProviderId.set('openai-p1');
		sessionModelId.set('gpt-4o');

		// Trigger messages update to schedule 3000ms auto-save
		addMessage({ id: 'm3', role: 'user', content: 'Follow up', timestamp: 3000, isStreaming: false });

		// Destroy before 3000ms timeout fires
		chatCtrl.destroy();

		// Allow async flush to execute
		await vi.runAllTimersAsync();

		// destroy() should have flushed saveSession
		expect(historyModule.saveSession).toHaveBeenCalled();
		vi.useRealTimers();
	});
});
