import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
	AutocompleteHandler,
	hasCompletedFirstOutputLine,
	postProcessAutocompleteSuggestion,
} from './autocompleteHandler';
import {
	autocompleteStateField,
	autocompleteKeymap,
	buildInlineAutocompleteExtension,
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
			expect(messages).toEqual([
				{ role: 'system', content: DEFAULT_AUTOCOMPLETE_PROMPT },
				{ role: 'user', content: 'Context text:\nHello' },
			]);
		});

		it('uses custom autocompletePrompt when configured and preserves base autocomplete rules', async () => {
			mockPlugin.settings.chat.autocompletePrompt = 'Custom instruction for inline completion.';
			await handler.fetchSuggestion('My note');
			const messages = mockChatFn.mock.calls[0][0];
			expect(messages[0].role).toBe('system');
			expect(messages[0].content).toContain(DEFAULT_AUTOCOMPLETE_PROMPT);
			expect(messages[0].content).toContain('Custom instruction for inline completion.');
			expect(messages[1].role).toBe('user');
			expect(messages[1].content).toContain('Context text:\nMy note');
			expect(messages[1].content).toContain('Custom instruction for inline completion.');
		});

		it('falls back to DEFAULT_AUTOCOMPLETE_PROMPT when autocompletePrompt is blank', async () => {
			mockPlugin.settings.chat.autocompletePrompt = '   ';
			await handler.fetchSuggestion('My note');
			const messages = mockChatFn.mock.calls[0][0];
			expect(messages).toEqual([
				{ role: 'system', content: DEFAULT_AUTOCOMPLETE_PROMPT },
				{ role: 'user', content: 'Context text:\nMy note' },
			]);
		});

		it('커서 뒤 텍스트(suffixText)가 있으면 중복 생성을 막기 위해 프롬프트 앞쪽에 배치하고 맨 끝을 Context text로 끝낸다', async () => {
			await handler.fetchSuggestion('Start of sentence', 'End of sentence');
			const messages = mockChatFn.mock.calls[0][0];
			const userContent = messages[1].content as string;
			expect(userContent).toContain('Context text:\nStart of sentence');
			expect(userContent).toContain('End of sentence');
			expect(userContent.indexOf('End of sentence')).toBeLessThan(userContent.indexOf('Context text:\nStart of sentence'));
			expect(userContent.endsWith('Context text:\nStart of sentence')).toBe(true);
		});

		it('한글/CJK 문맥에서는 앞에 불필요한 공백을 강제 삽입하지 않는다', async () => {
			mockChatFn.mockResolvedValueOnce({ content: '은 맑습니다.' });
			const res = await handler.fetchSuggestion('오늘 날씨');
			expect(res).toBe('은 맑습니다.');
		});
	});

	describe('postProcessAutocompleteSuggestion (라인 복사 및 중복 차단)', () => {
		it('contextText에 이미 존재하는 줄을 그대로 복사한 응답은 null을 반환한다', () => {
			const ctx = '- 사과\n- 바나나\n- ';
			expect(postProcessAutocompleteSuggestion('바나나', ctx, '')).toBeNull();
			expect(postProcessAutocompleteSuggestion('- 사과', ctx, '')).toBeNull();
		});

		it('suffixText의 첫 줄을 그대로 복사하거나 시작이 동일하면 null을 반환한다', () => {
			const ctx = '- 사과\n- ';
			const suffix = '- 포도\n- 딸기';
			expect(postProcessAutocompleteSuggestion('- 포도', ctx, suffix)).toBeNull();
			expect(postProcessAutocompleteSuggestion('포도', ctx, '포도\n딸기')).toBeNull();
		});

		it('현재 줄 앞부분을 다시 포함해 출력한 경우 중복 앞부분만 제거하고 나머지 제안을 살린다', () => {
			const ctx = '첫 줄\n오늘 날씨가 ';
			expect(postProcessAutocompleteSuggestion('오늘 날씨가 정말 맑다.', ctx, '')).toBe('정말 맑다.');

			const ctxNoSpace = '첫 줄\n오늘 날씨가';
			expect(postProcessAutocompleteSuggestion('오늘 날씨가 맑다.', ctxNoSpace, '')).toBe(' 맑다.');
		});

		it('여러 줄 응답이 오면 첫 번째 비어 있지 않은 줄만 추출한다', () => {
			const res = postProcessAutocompleteSuggestion('\n첫 번째 이어쓰기\n두 번째 불필요한 줄', '시작 ', '');
			expect(res).toBe('첫 번째 이어쓰기');
		});

		it('끝부분이 suffixText 시작과 겹치면 겹치는 부분을 잘라낸다', () => {
			const res = postProcessAutocompleteSuggestion('새 단어 그리고 끝부분', '앞 ', '끝부분 문장');
			expect(res).toBe('새 단어 그리고 ');
		});

		it('스트리밍 중 <think> 구간에서는 조기 중단하지 않고 본문 첫 줄 완성 시 즉시 조기 중단(early stop)한다', async () => {
			expect(hasCompletedFirstOutputLine('<think>\n첫째 생각\n둘째 생각')).toBe(false);
			expect(hasCompletedFirstOutputLine('<think>\n생각 완료\n</think>\n')).toBe(false);
			expect(hasCompletedFirstOutputLine('<think>\n생각 완료\n</think>\n본문 첫 줄 작성 중')).toBe(false);
			expect(hasCompletedFirstOutputLine('<think>\n생각 완료\n</think>\n본문 첫 줄 완성\n두 번째 줄')).toBe(true);

			let abortedDuringStream = false;
			const mockStream = vi.fn().mockImplementation(
				async (_msgs, opts: { signal?: AbortSignal }, onChunk: (c: string) => void) => {
					onChunk('<think>\n길게 생각하는 중...\n여전히 생각 중...\n</think>\n');
					expect(opts.signal?.aborted).toBe(false);

					onChunk('이어지는 첫 문장입니다.\n뒤따르는 두 번째 문장');
					abortedDuringStream = Boolean(opts.signal?.aborted);
					if (abortedDuringStream) {
						const abortErr = new Error('Aborted');
						abortErr.name = 'AbortError';
						throw abortErr;
					}
					return { finishReason: 'stop' };
				},
			);

			vi.mocked(createProvider).mockReturnValue({
				stream: mockStream,
				chat: mockChatFn,
			} as unknown as ILLMProvider);

			const res = await handler.fetchSuggestion('오늘 날씨는 ');
			expect(abortedDuringStream).toBe(true);
			expect(res).toBe('이어지는 첫 문장입니다.');
			expect(mockChatFn).not.toHaveBeenCalled();
		});

		it('줄바꿈이 없어도 한 문장이 끝나고 다음 문장이 시작되면 스트림을 조기 중단하고 첫 문장만 반환한다', async () => {
			expect(hasCompletedFirstOutputLine('오늘 날씨가 맑습니다. 내')).toBe(true);
			expect(hasCompletedFirstOutputLine('1. 첫 번째 항목 작성 중')).toBe(false);

			let abortedDuringStream = false;
			const mockStream = vi.fn().mockImplementation(
				async (_msgs, opts: { signal?: AbortSignal }, onChunk: (c: string) => void) => {
					onChunk('오늘 날씨가 정말 맑습니다. ');
					expect(opts.signal?.aborted).toBe(false);

					onChunk('내일도 화창할 것입니다.');
					abortedDuringStream = Boolean(opts.signal?.aborted);
					if (abortedDuringStream) {
						const abortErr = new Error('Aborted');
						abortErr.name = 'AbortError';
						throw abortErr;
					}
					return { finishReason: 'stop' };
				},
			);

			vi.mocked(createProvider).mockReturnValue({
				stream: mockStream,
				chat: mockChatFn,
			} as unknown as ILLMProvider);

			const res = await handler.fetchSuggestion('산책을 가려고 하는데 ');
			expect(abortedDuringStream).toBe(true);
			expect(res).toBe('오늘 날씨가 정말 맑습니다.');
		});
	});

	describe('autocompletePlugin delete guard', () => {
		it('텍스트 삽입 없이 삭제만 발생한 트랜잭션에서는 자동완성을 요청하지 않는다', () => {
			vi.useFakeTimers();
			try {
				const fetchSpy = vi.spyOn(handler, 'fetchSuggestion').mockResolvedValue('next');
				const parent = document.createElement('div');
				document.body.appendChild(parent);

				const view = new EditorView({
					state: EditorState.create({
						doc: 'Hello world',
						selection: { anchor: 11 },
						extensions: [buildInlineAutocompleteExtension(handler)],
					}),
					parent,
				});

				// 삭제만 수행 (Backspace)
				view.dispatch({ changes: { from: 10, to: 11, insert: '' } });
				vi.advanceTimersByTime(1000);
				expect(fetchSpy).not.toHaveBeenCalled();

				// 문자 삽입 수행 -> 정상 호출
				view.dispatch({ changes: { from: 10, to: 10, insert: '!' } });
				vi.advanceTimersByTime(800);
				expect(fetchSpy).toHaveBeenCalledTimes(1);

				view.destroy();
				parent.remove();
			} finally {
				vi.useRealTimers();
			}
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
