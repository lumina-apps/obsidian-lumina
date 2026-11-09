import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { AutocompleteHandler } from './autocompleteHandler';
import {
	autocompleteStateField,
	autocompleteKeymap,
	setSuggestion,
	splitFirstWord,
} from './autocompleteExtension';
import {
	DEFAULT_AUTOCOMPLETE_CONTEXT_LENGTH,
	DEFAULT_AUTOCOMPLETE_PROMPT,
	DEFAULT_AUTOCOMPLETE_WAIT_TIME_MS,
	DEFAULT_SETTINGS,
} from '../../core/settings/defaultSettings';
import { createProvider } from '../../core/llm-providers';
import type LuminaPlugin from '../../main';
import type { ILLMProvider } from '../../shared/types/llm.types';

vi.mock('../../core/llm-providers', () => ({
	createProvider: vi.fn(),
}));

describe('AutocompleteHandler & Inline Autocomplete', () => {
	let mockPlugin: LuminaPlugin;
	let handler: AutocompleteHandler;
	let mockChatFn: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();

		mockPlugin = {
			settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
		} as unknown as LuminaPlugin;

		mockPlugin.settings.chat.enableAutocomplete = true;
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
		mockPlugin.settings.connections.taskProviderId = 'prov-1';
		mockPlugin.settings.connections.taskModelId = 'gpt-4o-mini';

		mockChatFn = vi.fn().mockResolvedValue({ content: 'continuation text.' });
		vi.mocked(createProvider).mockReturnValue({
			chat: mockChatFn,
		} as unknown as ILLMProvider);

		handler = new AutocompleteHandler(mockPlugin);
	});

	describe('getContextLength & getWaitTimeMs', () => {
		it('returns default values when unchanged', () => {
			expect(handler.getContextLength()).toBe(DEFAULT_AUTOCOMPLETE_CONTEXT_LENGTH);
			expect(handler.getWaitTimeMs()).toBe(DEFAULT_AUTOCOMPLETE_WAIT_TIME_MS);
		});

		it('returns custom configured values', () => {
			mockPlugin.settings.chat.autocompleteContextLength = 2500;
			mockPlugin.settings.chat.autocompleteWaitTimeMs = 1200;

			expect(handler.getContextLength()).toBe(2500);
			expect(handler.getWaitTimeMs()).toBe(1200);
		});

		it('clamps values below minimum (100) and falls back on invalid values', () => {
			mockPlugin.settings.chat.autocompleteContextLength = 50;
			mockPlugin.settings.chat.autocompleteWaitTimeMs = 20;
			expect(handler.getContextLength()).toBe(100);
			expect(handler.getWaitTimeMs()).toBe(100);

			mockPlugin.settings.chat.autocompleteContextLength = Number.NaN;
			mockPlugin.settings.chat.autocompleteWaitTimeMs = -10;
			expect(handler.getContextLength()).toBe(DEFAULT_AUTOCOMPLETE_CONTEXT_LENGTH);
			expect(handler.getWaitTimeMs()).toBe(DEFAULT_AUTOCOMPLETE_WAIT_TIME_MS);
		});
	});

	describe('fetchSuggestion prompt customization', () => {
		it('uses DEFAULT_AUTOCOMPLETE_PROMPT by default', async () => {
			const res = await handler.fetchSuggestion('Hello');
			expect(res).toBe(' continuation text.');
			expect(mockChatFn).toHaveBeenCalledTimes(1);
			const messages = mockChatFn.mock.calls[0][0];
			expect(messages[0].content).toBe(`${DEFAULT_AUTOCOMPLETE_PROMPT}\n\nContext text:\nHello`);
		});

		it('uses custom autocompletePrompt when configured', async () => {
			mockPlugin.settings.chat.autocompletePrompt = 'Custom instruction for inline completion.';
			await handler.fetchSuggestion('My note');
			const messages = mockChatFn.mock.calls[0][0];
			expect(messages[0].content).toBe('Custom instruction for inline completion.\n\nContext text:\nMy note');
		});

		it('falls back to DEFAULT_AUTOCOMPLETE_PROMPT when autocompletePrompt is blank', async () => {
			mockPlugin.settings.chat.autocompletePrompt = '   ';
			await handler.fetchSuggestion('My note');
			const messages = mockChatFn.mock.calls[0][0];
			expect(messages[0].content).toBe(`${DEFAULT_AUTOCOMPLETE_PROMPT}\n\nContext text:\nMy note`);
		});
	});

	describe('splitFirstWord & partial suggestion acceptance', () => {
		it('splits leading whitespace + first word and preserves remaining text', () => {
			expect(splitFirstWord(' hello world!')).toEqual({
				firstWord: ' hello',
				remaining: ' world!',
			});
			expect(splitFirstWord(' world!')).toEqual({
				firstWord: ' world!',
				remaining: '',
			});
		});

		it('splits first word without leading whitespace and preserves remaining text', () => {
			expect(splitFirstWord('안녕하세요 반갑습니다 오늘')).toEqual({
				firstWord: '안녕하세요',
				remaining: ' 반갑습니다 오늘',
			});
		});

		it('updates autocompleteStateField with remaining suggestion on partial accept via ArrowRight and Tab', () => {
			const parent = document.createElement('div');
			document.body.appendChild(parent);

			const view = new EditorView({
				state: EditorState.create({
					doc: 'Hello',
					selection: { anchor: 5 },
					extensions: [autocompleteStateField, autocompleteKeymap],
				}),
				parent,
			});

			// 초기 제안 주입 (pos 5에 ' world again')
			view.dispatch({
				effects: setSuggestion.of({ text: ' world again', pos: 5 }),
			});
			expect(view.state.field(autocompleteStateField)).toEqual({ text: ' world again', pos: 5 });

			// 1. ArrowRight 키 입력으로 첫 번째 단어 (' world') 부분 수락
			view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));

			expect(view.state.doc.toString()).toBe('Hello world');
			expect(view.state.field(autocompleteStateField)).toEqual({ text: ' again', pos: 11 });

			// 2. Tab 키 입력으로 나머지 전체 제안 (' again') 수락
			view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));

			expect(view.state.doc.toString()).toBe('Hello world again');
			expect(view.state.field(autocompleteStateField)).toBeNull();

			// 3. Escape 키 입력으로 제안 취소
			view.dispatch({
				effects: setSuggestion.of({ text: ' cancel me', pos: 17 }),
			});
			expect(view.state.field(autocompleteStateField)).toEqual({ text: ' cancel me', pos: 17 });

			view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
			expect(view.state.field(autocompleteStateField)).toBeNull();

			view.destroy();
			parent.remove();
		});
	});
});
