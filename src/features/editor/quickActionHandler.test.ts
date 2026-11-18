import { describe, it, expect, vi, beforeEach } from 'vitest';
import { diffLines } from 'diff';
import { QuickActionHandler, buildAppendProposedDoc } from './quickActionHandler';
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

	it('executeCustomPrompt는 일회성 지시를 실행하고 applyApprovedContent/onApprovalQueued 콜백을 호출한다', async () => {
		mockPlugin.settings.chat.streaming = false;
		const docEditor = {
			...mockEditor,
			getValue: vi.fn(() => 'Hello world'),
			setValue: vi.fn(),
		} as unknown as Editor;

		(createProvider as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
			chat: vi.fn().mockResolvedValue({ content: 'Hi' }),
		} as unknown as ILLMProvider);

		vi.mocked(approvalManager.requestApproval).mockImplementation(async (_path, _base, proposed, opts) => {
			opts?.onQueued?.('req-123');
			return { approved: true, content: proposed };
		});

		const queuedIds: string[] = [];
		const applied: string[] = [];
		const results: boolean[] = [];

		await handler.executeCustomPrompt(
			'Make it shorter',
			'replace',
			docEditor,
			{ file: { path: 'Note.md' } as TFile } as MarkdownView,
			{
				suppressNotices: true,
				targetRange: { from: 0, to: 5, text: 'Hello' },
				onApprovalQueued: (id) => queuedIds.push(id),
				applyApprovedContent: (content) => {
					applied.push(content);
					return true;
				},
				onApprovalResult: (ok) => results.push(ok),
			},
		);

		expect(queuedIds).toEqual(['req-123']);
		expect(applied).toEqual(['Hi world']);
		expect(results).toEqual([true]);
		expect(docEditor.setValue).not.toHaveBeenCalled();
	});

	it('AbortSignal로 중단되면 onError를 호출하지 않고 조용히 종료한다', async () => {
		mockPlugin.settings.chat.streaming = false;
		const abortCtrl = new AbortController();
		const abortErr = new Error('Aborted');
		abortErr.name = 'AbortError';

		(createProvider as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
			chat: vi.fn().mockImplementation(async () => {
				abortCtrl.abort();
				throw abortErr;
			}),
		} as unknown as ILLMProvider);

		const onError = vi.fn();
		const onGenFinished = vi.fn();

		await handler.executeCustomPrompt(
			'Rewrite',
			'replace',
			mockEditor,
			{ file: { path: 'Note.md' } as TFile } as MarkdownView,
			{
				signal: abortCtrl.signal,
				suppressNotices: true,
				targetRange: { from: 0, to: 5, text: 'Hello' },
				onError,
				onGenerationFinished: onGenFinished,
			},
		);

		expect(onGenFinished).toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
	});

	it('응답에 <think> 사고 블록이 포함되어도 에러로 중단하지 않고 태그를 제거한 본문만 적용한다', async () => {
		mockPlugin.settings.chat.streaming = true;
		const docEditor = {
			...mockEditor,
			getValue: vi.fn(() => 'Hello world'),
			setValue: vi.fn(),
		} as unknown as Editor;

		const mockStream = vi.fn().mockImplementation(async (_msgs, _opts, onChunk: (c: string) => void) => {
			onChunk('<think>\n짧게 생각 중...\n</think>\n');
			onChunk('번역된 문장');
			return { finishReason: 'stop' };
		});

		(createProvider as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
			stream: mockStream,
		} as unknown as ILLMProvider);

		vi.mocked(approvalManager.requestApproval).mockImplementation(async (_path, _base, proposed) => ({
			approved: true,
			content: proposed,
		}));

		await handler.executeAction(
			{ id: 'test-qa', name: 'Translate', prompt: 'translate', actionType: 'replace' },
			docEditor,
			{ file: { path: 'Note.md' } as TFile } as MarkdownView,
		);

		expect(approvalManager.requestApproval).toHaveBeenCalledWith(
			'Note.md',
			'Hello world',
			'번역된 문장 world',
			expect.any(Object),
		);
		expect(docEditor.setValue).toHaveBeenCalledWith('번역된 문장 world');
	});

	it('스트리밍 중 onStreamProgress 콜백으로 사고 중 여부와 정제된 프리뷰 텍스트를 전달한다', async () => {
		mockPlugin.settings.chat.streaming = true;
		const progressEvents: Array<{ isThinking: boolean; previewText: string }> = [];

		const mockStream = vi.fn().mockImplementation(async (_msgs, _opts, onChunk: (c: string) => void) => {
			onChunk('<think>\n고민 중');
			onChunk('</think>\n안녕');
			onChunk('하세요');
			return { finishReason: 'stop' };
		});

		(createProvider as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
			stream: mockStream,
		} as unknown as ILLMProvider);

		vi.mocked(approvalManager.requestApproval).mockResolvedValue({
			approved: false,
			content: '',
		});

		await handler.executeCustomPrompt(
			'인사해줘',
			'replace',
			mockEditor,
			{ file: { path: 'Note.md' } as TFile } as MarkdownView,
			{
				suppressNotices: true,
				targetRange: { from: 0, to: 5, text: 'Hello' },
				onStreamProgress: (p) => progressEvents.push(p),
			},
		);

		expect(progressEvents).toEqual([
			{ isThinking: true, previewText: '' },
			{ isThinking: false, previewText: '안녕' },
			{ isThinking: false, previewText: '안녕하세요' },
		]);
	});

	it('buildAppendProposedDoc는 선택 끝 개행·줄 중간·빈 줄 인접 상황에서도 추가 빈 줄 없이 단일 Diff 청크로 삽입한다', () => {
		// 1. 일반 줄 뒤 (trailing newline 포함 선택)
		const doc1 = 'Line 1\nLine 2\nLine 3';
		const prop1 = buildAppendProposedDoc(doc1, 0, 7, 'Added\n');
		expect(prop1).toBe('Line 1\nAdded\nLine 2\nLine 3');
		const changes1 = diffLines(doc1, prop1).filter((c) => c.added || c.removed);
		expect(changes1).toEqual([{ count: 1, added: true, removed: false, value: 'Added\n' }]);

		// 2. 빈 줄 바로 앞 줄 뒤
		const doc2 = 'Line 1\n\nLine 3';
		const prop2 = buildAppendProposedDoc(doc2, 0, 6, 'Added');
		expect(prop2).toBe('Line 1\nAdded\n\nLine 3');
		const changes2 = diffLines(doc2, prop2).filter((c) => c.added || c.removed);
		expect(changes2).toEqual([{ count: 1, added: true, removed: false, value: 'Added\n' }]);

		// 3. 줄 중간까지만 선택한 경우에도 해당 줄 끝으로 정렬 후 다음 줄에 삽입
		const doc3 = 'Line 1 tail\nLine 2';
		const prop3 = buildAppendProposedDoc(doc3, 0, 6, 'Added');
		expect(prop3).toBe('Line 1 tail\nAdded\nLine 2');
		const changes3 = diffLines(doc3, prop3).filter((c) => c.added || c.removed);
		expect(changes3).toEqual([{ count: 1, added: true, removed: false, value: 'Added\n' }]);
	});
});
