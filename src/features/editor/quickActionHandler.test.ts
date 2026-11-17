import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuickActionHandler } from './quickActionHandler';
import { DEFAULT_SETTINGS } from '../../core/settings/defaultSettings';
import { initProjectStore } from '../../core/store/projectStore';
import { createProvider } from '../../core/llm-providers';
import { approvalManager } from '../../core/store/approvalStore';
import type LuminaPlugin from '../../main';
import type { Editor, MarkdownView, TFile } from 'obsidian';
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

vi.mock('../../core/store/approvalStore', () => ({
	approvalManager: {
		requestApproval: vi.fn(),
	},
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

	it('스트리밍 중 오류가 발생하면 에디터 원문을 전혀 건드리지 않고 undo()도 호출하지 않는다', async () => {
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

		expect(mockEditor.replaceRange).not.toHaveBeenCalled();
		expect(mockEditor.undo).not.toHaveBeenCalled();
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

	it('replace/append 퀵 액션은 전용 퀵 액션 모델이 미설정이면 메인 모델로 폴백하지 않고 설정 창을 연다', async () => {
		mockPlugin.settings.connections.quickActionProviderId = '';
		mockPlugin.settings.connections.quickActionModelId = '';

		await handler.executeAction(
			{ id: 'test-qa', name: 'Translate', prompt: 'translate', actionType: 'replace' },
			mockEditor,
			{} as MarkdownView
		);

		expect(createProvider).not.toHaveBeenCalled();
		expect((mockPlugin.app as unknown as { setting: { open: ReturnType<typeof vi.fn> } }).setting.open).toHaveBeenCalled();
	});

	it('활성 파일이 있는 마크다운 뷰에서는 인라인 Diff 승인(approvalManager)을 거쳐 에디터를 수정한다', async () => {
		mockPlugin.settings.chat.streaming = false;
		const docEditor = {
			...mockEditor,
			getValue: vi.fn(() => 'Hello world'),
			setValue: vi.fn(),
		} as unknown as Editor;

		const mockChat = vi.fn().mockResolvedValue({ content: '안녕하세요' });
		(createProvider as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
			chat: mockChat,
		} as unknown as ILLMProvider);

		vi.mocked(approvalManager.requestApproval).mockResolvedValue({
			approved: true,
			content: '안녕하세요 world',
		});

		await handler.executeAction(
			{ id: 'test-qa', name: 'Translate', prompt: 'translate', actionType: 'replace' },
			docEditor,
			{ file: { path: 'Note.md' } as TFile } as MarkdownView
		);

		expect(approvalManager.requestApproval).toHaveBeenCalledWith(
			'Note.md',
			'Hello world',
			'안녕하세요 world',
			expect.any(Object),
		);
		expect(docEditor.setValue).toHaveBeenCalledWith('안녕하세요 world');
	});

	it('인라인 Diff가 거절되면 에디터 내용을 변경하지 않는다', async () => {
		mockPlugin.settings.chat.streaming = false;
		const docEditor = {
			...mockEditor,
			getValue: vi.fn(() => 'Hello world'),
			setValue: vi.fn(),
		} as unknown as Editor;

		(createProvider as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
			chat: vi.fn().mockResolvedValue({ content: '안녕하세요' }),
		} as unknown as ILLMProvider);

		vi.mocked(approvalManager.requestApproval).mockResolvedValue({
			approved: false,
			content: '',
		});

		await handler.executeAction(
			{ id: 'test-qa', name: 'Translate', prompt: 'translate', actionType: 'replace' },
			docEditor,
			{ file: { path: 'Note.md' } as TFile } as MarkdownView
		);

		expect(docEditor.setValue).not.toHaveBeenCalled();
	});
});
