import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuickActionHandler } from './quickActionHandler';
import { DEFAULT_SETTINGS } from '../../core/settings/defaultSettings';
import { initProjectStore } from '../../core/store/projectStore';
import { createProvider } from '../../core/llm-providers';
import type LuminaPlugin from '../../main';
import type { Editor, MarkdownView } from 'obsidian';
import type { ILLMProvider } from '../../shared/types/llm.types';

vi.mock('../../core/llm-providers', () => ({
	createProvider: vi.fn(),
}));

vi.mock('../../core/views/viewHelper', () => ({
	activateView: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../chat/chatController', () => ({
	ChatController: vi.fn().mockImplementation(() => ({
		sendMessage: vi.fn().mockResolvedValue(undefined),
		destroy: vi.fn(),
	})),
}));

describe('QuickActionHandler', () => {
	let mockPlugin: LuminaPlugin;
	let handler: QuickActionHandler;
	let mockEditor: Editor;
	let currentCursor: { from: { line: number; ch: number }; to: { line: number; ch: number } };

	beforeEach(() => {
		vi.clearAllMocks();

		currentCursor = {
			from: { line: 0, ch: 0 },
			to: { line: 0, ch: 5 },
		};

		mockEditor = {
			getSelection: vi.fn(() => 'Hello'),
			getCursor: vi.fn((type?: 'from' | 'to') => (type === 'to' ? currentCursor.to : currentCursor.from)),
			replaceRange: vi.fn(),
			posToOffset: vi.fn((pos) => pos.line * 100 + pos.ch),
			offsetToPos: vi.fn((offset) => ({ line: Math.floor(offset / 100), ch: offset % 100 })),
			undo: vi.fn(),
		} as unknown as Editor;

		mockPlugin = {
			app: {
				workspace: {},
				setting: {
					open: vi.fn(),
					openTabById: vi.fn(),
				},
			},
			manifest: { id: 'obsidian-lumina' },
			settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
		} as unknown as LuminaPlugin;

		mockPlugin.settings.connections.providers = [
			{
				id: 'prov-1',
				type: 'openai',
				credential: 'test',
				baseUrl: '',
				isVerified: true,
				availableModels: ['gpt-4o-mini'],
			},
		];
		mockPlugin.settings.connections.quickActionProviderId = 'prov-1';
		mockPlugin.settings.connections.quickActionModelId = 'gpt-4o-mini';

		initProjectStore(mockPlugin.settings.projects.list, mockPlugin.settings.projects.activeProjectId);
		handler = new QuickActionHandler(mockPlugin);
	});

	it('should return early when selection is empty', async () => {
		(mockEditor.getSelection as unknown as ReturnType<typeof vi.fn>).mockReturnValue('');

		await handler.executeAction(
			{ id: 'test-qa', name: 'Test', prompt: 'test', actionType: 'replace' },
			mockEditor,
			{} as MarkdownView
		);

		expect(createProvider).not.toHaveBeenCalled();
		expect(mockEditor.replaceRange).not.toHaveBeenCalled();
	});

	it('should use initial cursor coordinates even if cursor moves during non-streaming chat', async () => {
		mockPlugin.settings.chat.streaming = false;

		const mockChat = vi.fn().mockImplementation(async () => {
			// Simulate user moving cursor while LLM responds
			currentCursor = {
				from: { line: 10, ch: 20 },
				to: { line: 10, ch: 25 },
			};
			return { content: 'Translated Text' };
		});

		(createProvider as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
			chat: mockChat,
		} as unknown as ILLMProvider);

		await handler.executeAction(
			{ id: 'test-qa', name: 'Translate', prompt: 'translate', actionType: 'replace' },
			mockEditor,
			{} as MarkdownView
		);

		expect(mockChat).toHaveBeenCalled();
		// Must use initial coordinates ({line:0, ch:0} and {line:0, ch:5}), not moved ones
		expect(mockEditor.replaceRange).toHaveBeenCalledWith(
			'Translated Text',
			{ line: 0, ch: 0 },
			{ line: 0, ch: 5 }
		);
		expect(mockEditor.undo).not.toHaveBeenCalled();
	});

	it('should safely revert editor when error occurs in streaming mode without calling undo()', async () => {
		mockPlugin.settings.chat.streaming = true;

		const mockStream = vi.fn().mockRejectedValue(new Error('Network failure'));
		(createProvider as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
			stream: mockStream,
		} as unknown as ILLMProvider);

		await handler.executeAction(
			{ id: 'test-qa', name: 'Translate', prompt: 'translate', actionType: 'replace' },
			mockEditor,
			{} as MarkdownView
		);

		// First replaceRange was indicator insertion
		expect(mockEditor.replaceRange).toHaveBeenCalled();
		// Crucial: editor.undo() should NEVER be called; instead revert replaces with original selection
		expect(mockEditor.undo).not.toHaveBeenCalled();
		// Last replaceRange should be the restoration of original selection
		const calls = (mockEditor.replaceRange as unknown as ReturnType<typeof vi.fn>).mock.calls;
		const lastCall = calls[calls.length - 1];
		expect(lastCall[0]).toBe('Hello');
	});

	it('should not modify editor or call undo if error occurs before editor is touched', async () => {
		mockPlugin.settings.chat.streaming = true;

		(createProvider as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
			throw new Error('Provider initialization failed');
		});

		await handler.executeAction(
			{ id: 'test-qa', name: 'Translate', prompt: 'translate', actionType: 'replace' },
			mockEditor,
			{} as MarkdownView
		);

		expect(mockEditor.replaceRange).not.toHaveBeenCalled();
		expect(mockEditor.undo).not.toHaveBeenCalled();
	});
});
