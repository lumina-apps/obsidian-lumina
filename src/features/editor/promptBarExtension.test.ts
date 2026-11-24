import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { Platform, type Editor, type MarkdownView, type TFile } from 'obsidian';
import {
	buildPromptBarExtension,
	openPromptBar,
	closePromptBarEffect,
} from './promptBarExtension';
import { aiEditAnnotation } from './editorAnnotations';
import { buildInlineAutocompleteExtension } from './autocompleteExtension';
import type { AutocompleteHandler } from './autocompleteHandler';
import { approvalManager, approvalStore } from '../../core/store/approvalStore';
import { DEFAULT_SETTINGS } from '../../core/settings/defaultSettings';
import type LuminaPlugin from '../../main';
import type { QuickActionExecuteOptions } from './quickActionHandler';

function createMockEditorForCm(cmView: EditorView): Editor {
	const posToOffset = (pos: { line: number; ch: number }): number => {
		const lineNum = Math.max(1, Math.min(pos.line + 1, cmView.state.doc.lines));
		const line = cmView.state.doc.line(lineNum);
		return Math.min(line.from + pos.ch, line.to);
	};
	const offsetToPos = (offset: number): { line: number; ch: number } => {
		const clamped = Math.max(0, Math.min(offset, cmView.state.doc.length));
		const line = cmView.state.doc.lineAt(clamped);
		return { line: line.number - 1, ch: clamped - line.from };
	};

	return {
		cm: cmView,
		getCursor: (type?: 'from' | 'to') => {
			const sel = cmView.state.selection.main;
			const offset = type === 'to' ? sel.to : sel.from;
			return offsetToPos(offset);
		},
		getLine: (lineIdx: number) => {
			const lineNum = Math.max(1, Math.min(lineIdx + 1, cmView.state.doc.lines));
			return cmView.state.doc.line(lineNum).text;
		},
		getSelection: () => {
			const sel = cmView.state.selection.main;
			return cmView.state.doc.sliceString(sel.from, sel.to);
		},
		getValue: () => cmView.state.doc.toString(),
		setValue: (val: string) => {
			cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: val } });
		},
		posToOffset,
		offsetToPos,
	} as unknown as Editor;
}

describe('promptBarExtension', () => {
	let parent: HTMLDivElement;
	let mockPlugin: LuminaPlugin;
	let mockExecuteAction: ReturnType<typeof vi.fn>;
	let view: EditorView | null = null;
	let origGetClientRects: (() => DOMRectList) | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
		approvalStore.set({ queue: [], undoStack: [] });

		if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
			origGetClientRects = Range.prototype.getClientRects;
			Range.prototype.getClientRects = () => ({
				length: 1,
				0: { top: 0, bottom: 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) },
				item: () => null,
				[Symbol.iterator]: function* () {},
			}) as unknown as DOMRectList;
		}

		parent = document.createElement('div');
		document.body.appendChild(parent);

		mockExecuteAction = vi.fn();

		const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
		settings.connections.providers = [
			{
				id: 'prov-1',
				type: 'openai',
				credential: 'key',
				baseUrl: '',
				isVerified: true,
				availableModels: ['gpt-4o-mini'],
			},
		];
		settings.connections.quickActionProviderId = 'prov-1';
		settings.connections.quickActionModelId = 'gpt-4o-mini';
		settings.chat.quickActions = [
			{ id: 'qa-1', name: '요약', prompt: 'Summarize', actionType: 'replace' },
			{ id: 'qa-2', name: '채팅 질문', prompt: 'Explain', actionType: 'chat' },
		];

		mockPlugin = {
			app: {
				workspace: {
					getActiveFile: vi.fn(() => ({ path: 'Note.md' } as TFile)),
					getActiveViewOfType: vi.fn(() => null),
				},
				keymap: {
					pushScope: vi.fn(),
					popScope: vi.fn(),
				},
				setting: {
					open: vi.fn(),
					openTabById: vi.fn(),
				},
			},
			manifest: { id: 'obsidian-lumina' },
			settings,
			quickActionHandler: {
				executeAction: mockExecuteAction,
			},
		} as unknown as LuminaPlugin;
	});

	afterEach(() => {
		view?.destroy();
		view = null;
		parent.remove();
		if (typeof Range !== 'undefined' && origGetClientRects === undefined) {
			delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
		}
	});

	it('선택 영역 위에서 프롬프트 바를 열고 대상 범위 하이라이트를 표시한다', () => {
		view = new EditorView({
			state: EditorState.create({
				doc: 'First line\nTarget sentence here\nLast line',
				selection: { anchor: 11, head: 31 },
				extensions: [buildPromptBarExtension(mockPlugin)],
			}),
			parent,
		});

		const editor = createMockEditorForCm(view);
		const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;

		const opened = openPromptBar(mockPlugin, editor, mdView);
		expect(opened).toBe(true);

		const bar = view.dom.querySelector('.lumina-promptbar') as HTMLElement | null;
		expect(bar).not.toBeNull();
		expect(bar?.dataset.phase).toBe('input');
		expect(bar?.hasAttribute('aria-label')).toBe(false);
		expect(bar?.hasAttribute('aria-labelledby')).toBe(true);
		expect(view.dom.querySelector('.lumina-promptbar-target-highlight')?.textContent).toBe('Target sentence here');
		expect(bar?.querySelectorAll('.lumina-promptbar-chip')).toHaveLength(2);
	});

	it('선택 영역이 없으면 현재 줄을 대상으로 열고, 빈 줄에서는 열리지 않는다', () => {
		view = new EditorView({
			state: EditorState.create({
				doc: 'Line one\n\nLine three',
				selection: { anchor: 9 }, // 빈 줄
				extensions: [buildPromptBarExtension(mockPlugin)],
			}),
			parent,
		});

		const editor = createMockEditorForCm(view);
		const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;

		expect(openPromptBar(mockPlugin, editor, mdView)).toBe(false);
		expect(view.dom.querySelector('.lumina-promptbar')).toBeNull();

		// 비어 있지 않은 첫 번째 줄로 커서 이동 (선택 없음)
		view.dispatch({ selection: { anchor: 3 } });
		expect(openPromptBar(mockPlugin, editor, mdView)).toBe(true);
		expect(view.dom.querySelector('.lumina-promptbar-target-highlight')?.textContent).toBe('Line one');
	});

	it('동일 파일에 처리 중인 edit 승인 요청이 있으면 프롬프트 바를 열지 않는다', async () => {
		const pending = approvalManager.requestApproval('Note.md', 'old', 'new');

		view = new EditorView({
			state: EditorState.create({
				doc: 'Hello world',
				selection: { anchor: 0, head: 5 },
				extensions: [buildPromptBarExtension(mockPlugin)],
			}),
			parent,
		});

		const editor = createMockEditorForCm(view);
		const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;

		expect(openPromptBar(mockPlugin, editor, mdView)).toBe(false);
		expect(view.dom.querySelector('.lumina-promptbar')).toBeNull();

		// 정리
		let reqId = '';
		const unsub = approvalStore.subscribe((s) => {
			if (s.queue[0]) reqId = s.queue[0].id;
		});
		unsub();
		approvalManager.rejectAll(reqId);
		await pending;
	});

	it('즉석 지시 실행 -> 리뷰 -> Accept 시 최소 변경 구간만 aiEditAnnotation과 함께 적용되고 바가 닫힌다', async () => {
		const aiEditSeen: boolean[] = [];
		const changesSeen: Array<{ fromA: number; toA: number; inserted: string }> = [];

		view = new EditorView({
			state: EditorState.create({
				doc: 'Intro\nHello old world\nOutro',
				selection: { anchor: 6, head: 21 },
				extensions: [
					buildPromptBarExtension(mockPlugin),
					EditorView.updateListener.of((upd) => {
						for (const tr of upd.transactions) {
							if (tr.docChanged) {
								aiEditSeen.push(tr.annotation(aiEditAnnotation) === true);
								tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
									changesSeen.push({ fromA, toA, inserted: inserted.toString() });
								});
							}
						}
					}),
				],
			}),
			parent,
		});

		const editor = createMockEditorForCm(view);
		const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;

		mockExecuteAction.mockImplementation(
			async (
				_action,
				_ed,
				_v,
				opts?: QuickActionExecuteOptions,
			) => {
				const baseDoc = editor.getValue();
				const proposedDoc = baseDoc.replace('Hello old world', 'Hello new world');
				const approval = await approvalManager.requestApproval('Note.md', baseDoc, proposedDoc, {
					signal: opts?.signal,
					onQueued: opts?.onApprovalQueued,
				});
				if (approval.approved) {
					const applied = opts?.applyApprovedContent?.(approval.content, {
						baseDoc,
						startOffset: opts.targetRange?.from ?? 6,
						endOffset: opts.targetRange?.to ?? 21,
						targetText: opts.targetRange?.text ?? 'Hello old world',
					});
					opts?.onApprovalResult?.(Boolean(applied));
				} else {
					opts?.onApprovalResult?.(false);
				}
			},
		);

		openPromptBar(mockPlugin, editor, mdView);
		const input = view.dom.querySelector('.lumina-promptbar-input') as HTMLTextAreaElement;
		expect(input).not.toBeNull();

		input.value = 'old를 new로 바꿔줘';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

		// 비동기 approvalManager 큐 등록 대기
		await vi.waitFor(() => {
			const bar = view?.dom.querySelector('.lumina-promptbar') as HTMLElement | null;
			expect(bar?.dataset.phase).toBe('review');
		});

		const acceptBtn = view.dom.querySelector('.lumina-promptbar-btn.accept') as HTMLButtonElement;
		acceptBtn.click();

		await vi.waitFor(() => {
			expect(view?.state.doc.toString()).toBe('Intro\nHello new world\nOutro');
			expect(view?.dom.querySelector('.lumina-promptbar')).toBeNull();
		});

		expect(aiEditSeen).toEqual([true]);
		expect(changesSeen).toEqual([{ fromA: 12, toA: 15, inserted: 'new' }]);
	});

	it('review 단계에서 Esc를 누르면 Diff를 거절하고 입력 지시문을 유지한 채 input 단계로 복귀한다', async () => {
		view = new EditorView({
			state: EditorState.create({
				doc: 'Alpha\nBeta\nGamma',
				selection: { anchor: 6, head: 10 },
				extensions: [buildPromptBarExtension(mockPlugin)],
			}),
			parent,
		});

		const editor = createMockEditorForCm(view);
		const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;

		mockExecuteAction.mockImplementation(async (_action, _ed, _v, opts?: QuickActionExecuteOptions) => {
			const baseDoc = editor.getValue();
			const proposedDoc = baseDoc.replace('Beta', 'Beta Modified');
			const approval = await approvalManager.requestApproval('Note.md', baseDoc, proposedDoc, {
				signal: opts?.signal,
				onQueued: opts?.onApprovalQueued,
			});
			opts?.onApprovalResult?.(approval.approved);
		});

		openPromptBar(mockPlugin, editor, mdView, '멋지게 고쳐줘');

		const submitBtn = view.dom.querySelector('.lumina-promptbar-submit-btn') as HTMLButtonElement;
		submitBtn.click();

		await vi.waitFor(() => {
			const bar = view?.dom.querySelector('.lumina-promptbar') as HTMLElement | null;
			expect(bar?.dataset.phase).toBe('review');
		});

		const barEl = view.dom.querySelector('.lumina-promptbar') as HTMLElement;
		barEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

		await vi.waitFor(() => {
			expect(barEl.dataset.phase).toBe('input');
		});

		const input = view.dom.querySelector('.lumina-promptbar-input') as HTMLTextAreaElement;
		expect(input.value).toBe('멋지게 고쳐줘');
		expect(view.state.doc.toString()).toBe('Alpha\nBeta\nGamma');
	});

	it('generating 단계에서 Cancel 클릭 시 AbortSignal이 중단되고 input 단계로 복귀한다', async () => {
		view = new EditorView({
			state: EditorState.create({
				doc: 'Some target text',
				selection: { anchor: 0, head: 16 },
				extensions: [buildPromptBarExtension(mockPlugin)],
			}),
			parent,
		});

		const editor = createMockEditorForCm(view);
		const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;

		let capturedSignal: AbortSignal | undefined;
		mockExecuteAction.mockImplementation(async (_action, _ed, _v, opts?: QuickActionExecuteOptions) => {
			capturedSignal = opts?.signal;
			await new Promise<void>((resolve) => {
				opts?.signal?.addEventListener('abort', () => resolve());
			});
		});

		openPromptBar(mockPlugin, editor, mdView, '요약해줘');
		const submitBtn = view.dom.querySelector('.lumina-promptbar-submit-btn') as HTMLButtonElement;
		submitBtn.click();

		const barEl = view.dom.querySelector('.lumina-promptbar') as HTMLElement;
		expect(barEl.dataset.phase).toBe('generating');
		expect(capturedSignal?.aborted).toBe(false);

		// Cancel 버튼 클릭
		submitBtn.click();
		expect(capturedSignal?.aborted).toBe(true);
		expect(barEl.dataset.phase).toBe('input');
	});

	it('IME 조합 중 Enter 입력은 프롬프트를 즉시 제출하지 않는다', () => {
		view = new EditorView({
			state: EditorState.create({
				doc: '한국어 문장',
				selection: { anchor: 0, head: 6 },
				extensions: [buildPromptBarExtension(mockPlugin)],
			}),
			parent,
		});

		const editor = createMockEditorForCm(view);
		const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;

		openPromptBar(mockPlugin, editor, mdView, '번역해줘');
		const input = view.dom.querySelector('.lumina-promptbar-input') as HTMLTextAreaElement;

		input.dispatchEvent(new Event('compositionstart'));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		expect(mockExecuteAction).not.toHaveBeenCalled();

		input.dispatchEvent(new Event('compositionend'));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		expect(mockExecuteAction).toHaveBeenCalledTimes(1);

		view.dispatch({ effects: closePromptBarEffect.of(null) });
	});

	it('aiEditAnnotation이 포함된 트랜잭션은 인라인 자동완성 재요청 타이머를 트리거하지 않는다', () => {
		vi.useFakeTimers();
		try {
			const fetchSuggestion = vi.fn().mockResolvedValue('next');
			const mockAutocompleteHandler = {
				getWaitTimeMs: () => 200,
				getContextLength: () => 500,
				fetchSuggestion,
			} as unknown as AutocompleteHandler;

			view = new EditorView({
				state: EditorState.create({
					doc: 'Hello',
					extensions: [buildInlineAutocompleteExtension(mockAutocompleteHandler)],
				}),
				parent,
			});

			// AI 편집 트랜잭션 -> 스킵되어야 함
			view.dispatch({
				changes: { from: 5, to: 5, insert: ' AI' },
				annotations: aiEditAnnotation.of(true),
			});
			vi.advanceTimersByTime(500);
			expect(fetchSuggestion).not.toHaveBeenCalled();

			// 일반 타이핑 트랜잭션 -> 정상 트리거되어야 함
			view.dispatch({
				changes: { from: 8, to: 8, insert: '!' },
			});
			vi.advanceTimersByTime(250);
			expect(fetchSuggestion).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('chat 타입 칩 클릭 시 바를 닫고 targetRange와 함께 executeAction을 호출한다', () => {
		view = new EditorView({
			state: EditorState.create({
				doc: 'Explain this line',
				selection: { anchor: 0, head: 17 },
				extensions: [buildPromptBarExtension(mockPlugin)],
			}),
			parent,
		});

		const editor = createMockEditorForCm(view);
		const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;

		openPromptBar(mockPlugin, editor, mdView);
		const chatChip = view.dom.querySelector('.lumina-promptbar-chip.is-chat') as HTMLButtonElement;
		expect(chatChip).not.toBeNull();
		chatChip.click();

		expect(view.dom.querySelector('.lumina-promptbar')).toBeNull();
		expect(mockExecuteAction).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'qa-2', actionType: 'chat' }),
			editor,
			mdView,
			expect.objectContaining({
				targetRange: { from: 0, to: 17, text: 'Explain this line' },
			}),
		);
	});

	it('퀵 액션 전용 모델이 미설정이어도 등록된 일반 모델로 자동 폴백하며 드롭다운에서 모델을 전환할 수 있다', () => {
		mockPlugin.settings.connections.quickActionProviderId = '';
		mockPlugin.settings.connections.quickActionModelId = '';
		mockPlugin.settings.connections.providers[0].availableModels = ['gemma4:e2b-mlx', 'gpt-4o'];

		view = new EditorView({
			state: EditorState.create({
				doc: 'Target text',
				selection: { anchor: 0, head: 11 },
				extensions: [buildPromptBarExtension(mockPlugin)],
			}),
			parent,
		});

		const editor = createMockEditorForCm(view);
		const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;

		openPromptBar(mockPlugin, editor, mdView, '다듬어줘');
		const selectEl = view.dom.querySelector('.lumina-promptbar-model-select') as HTMLSelectElement | null;
		expect(selectEl).not.toBeNull();
		expect(selectEl?.value).toBe('prov-1::gemma4:e2b-mlx');

		// 드롭다운에서 다른 일반 모델(gpt-4o) 선택 후 실행
		if (selectEl) {
			selectEl.value = 'prov-1::gpt-4o';
			selectEl.dispatchEvent(new Event('change', { bubbles: true }));
		}

		const submitBtn = view.dom.querySelector('.lumina-promptbar-submit-btn') as HTMLButtonElement;
		submitBtn.click();

		expect(mockExecuteAction).toHaveBeenCalledWith(
			expect.objectContaining({ prompt: '다듬어줘' }),
			editor,
			mdView,
			expect.objectContaining({
				providerId: 'prov-1',
				modelId: 'gpt-4o',
			}),
		);
	});

	it('사용 가능한 검증된 모델이 하나도 없을 때만 경고와 설정 열기 버튼을 표시한다', () => {
		mockPlugin.settings.connections.quickActionProviderId = '';
		mockPlugin.settings.connections.quickActionModelId = '';
		mockPlugin.settings.connections.providers = [];

		view = new EditorView({
			state: EditorState.create({
				doc: 'Target text',
				selection: { anchor: 0, head: 11 },
				extensions: [buildPromptBarExtension(mockPlugin)],
			}),
			parent,
		});

		const editor = createMockEditorForCm(view);
		const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;

		openPromptBar(mockPlugin, editor, mdView);
		const settingsLink = view.dom.querySelector('.lumina-promptbar-settings-link') as HTMLButtonElement | null;
		expect(settingsLink).not.toBeNull();
		settingsLink?.click();

		expect((mockPlugin.app as unknown as { setting: { open: ReturnType<typeof vi.fn> } }).setting.open).toHaveBeenCalled();
	});

	it('선택 영역 미니 아이콘이 ON일 때 선택 후 표시되며 클릭 시 프롬프트 바를 연다', () => {
		vi.useFakeTimers();
		try {
			mockPlugin.settings.chat.enableSelectionMiniIcon = true;

			view = new EditorView({
				state: EditorState.create({
					doc: 'Select this phrase cleanly',
					extensions: [buildPromptBarExtension(mockPlugin)],
				}),
				parent,
			});

			const editor = createMockEditorForCm(view);
			const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;
			vi.mocked(mockPlugin.app.workspace.getActiveViewOfType).mockReturnValue(mdView);

			// 선택 영역 지정
			view.dispatch({ selection: { anchor: 7, head: 18 } });
			vi.advanceTimersByTime(200);

			const miniBtn = view.dom.querySelector('.lumina-mini-trigger') as HTMLButtonElement | null;
			expect(miniBtn).not.toBeNull();

			// 클릭 시 미니 아이콘이 사라지고 프롬프트 바가 열려야 함
			miniBtn?.click();
			expect(view.dom.querySelector('.lumina-mini-trigger')).toBeNull();
			expect(view.dom.querySelector('.lumina-promptbar')).not.toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('선택 영역 미니 아이콘이 OFF일 때는 선택 시에도 미니 아이콘을 표시하지 않는다', () => {
		vi.useFakeTimers();
		try {
			mockPlugin.settings.chat.enableSelectionMiniIcon = false;

			view = new EditorView({
				state: EditorState.create({
					doc: 'Select this phrase cleanly',
					extensions: [buildPromptBarExtension(mockPlugin)],
				}),
				parent,
			});

			view.dispatch({ selection: { anchor: 0, head: 6 } });
			vi.advanceTimersByTime(250);

			expect(view.dom.querySelector('.lumina-mini-trigger')).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('마우스 드래그 중(pointerdown 상태)에는 미니 아이콘을 띄우지 않고 pointerup 이후에 표시한다', () => {
		vi.useFakeTimers();
		try {
			mockPlugin.settings.chat.enableSelectionMiniIcon = true;

			view = new EditorView({
				state: EditorState.create({
					doc: 'Dragging across words',
					extensions: [buildPromptBarExtension(mockPlugin)],
				}),
				parent,
			});

			view.dom.dispatchEvent(new Event('pointerdown'));
			view.dispatch({ selection: { anchor: 0, head: 8 } });
			vi.advanceTimersByTime(300);
			expect(view.dom.querySelector('.lumina-mini-trigger')).toBeNull();

			window.dispatchEvent(new Event('pointerup'));
			vi.advanceTimersByTime(100);
			expect(view.dom.querySelector('.lumina-mini-trigger')).not.toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('스트리밍 중 <think> 구간은 본문 프리뷰를 숨기고 상태만 표시하다 본문 시작 시 에디터 Diff 자리에 실시간 프리뷰를 띄운다', async () => {
		vi.useFakeTimers();
		try {
			view = new EditorView({
				state: EditorState.create({
					doc: 'Original line\nSecond line',
					selection: { anchor: 0, head: 13 },
					extensions: [buildPromptBarExtension(mockPlugin)],
				}),
				parent,
			});

			const editor = createMockEditorForCm(view);
			const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;

			let emitProgress: ((p: { isThinking: boolean; previewText: string }) => void) | undefined;
			let resolveRun: (() => void) | undefined;

			mockExecuteAction.mockImplementation(async (_action, _ed, _v, opts?: QuickActionExecuteOptions) => {
				emitProgress = opts?.onStreamProgress;
				await new Promise<void>((resolve) => {
					resolveRun = resolve;
				});
			});

			openPromptBar(mockPlugin, editor, mdView, '다시 써줘');
			const submitBtn = view.dom.querySelector('.lumina-promptbar-submit-btn') as HTMLButtonElement;
			submitBtn.click();

			// 1. <think> 생성 중: 본문 스트리밍 위젯은 숨기고 상태 텍스트만 "Thinking..."으로 표시
			emitProgress?.({ isThinking: true, previewText: '' });
			expect(view.dom.querySelector('.lumina-promptbar-streaming-widget')).toBeNull();
			expect(view.dom.querySelector('.lumina-promptbar-status')?.textContent).toContain('Thinking');

			// 2. 실제 본문 첫 청크 도착: 즉시 본문에 + 프리뷰 위젯과 replace 하이라이트 표시
			vi.advanceTimersByTime(40);
			emitProgress?.({ isThinking: false, previewText: 'First streamed line' });
			expect(view.dom.querySelector('.lumina-promptbar-streaming-widget')?.textContent).toContain('+ First streamed line');
			expect(view.dom.querySelector('.lumina-promptbar-target-replacing')?.textContent).toBe('Original line');
			expect(view.dom.querySelector('.lumina-promptbar-status')?.textContent).toContain('Generating');

			// 3. 취소 시 프리뷰 위젯 정리
			submitBtn.click();
			expect(view.dom.querySelector('.lumina-promptbar-streaming-widget')).toBeNull();
			resolveRun?.();
		} finally {
			vi.useRealTimers();
		}
	});

	it('기본 모드는 replace이며, 마지막으로 선택한 모드를 세션 동안 기억한다', () => {
		view = new EditorView({
			state: EditorState.create({
				doc: 'Line one\nLine two',
				selection: { anchor: 0, head: 8 },
				extensions: [buildPromptBarExtension(mockPlugin)],
			}),
			parent,
		});

		const editor = createMockEditorForCm(view);
		const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;

		// 1. 최초 오픈 시 기본값은 replace
		openPromptBar(mockPlugin, editor, mdView);
		const modeBtns = view.dom.querySelectorAll('.lumina-promptbar-mode-btn');
		expect(modeBtns[0].classList.contains('is-active')).toBe(true);
		expect(modeBtns[1].classList.contains('is-active')).toBe(false);

		// 2. append로 전환 후 바 닫기
		(modeBtns[1] as HTMLButtonElement).click();
		expect(modeBtns[1].classList.contains('is-active')).toBe(true);
		view.dispatch({ effects: closePromptBarEffect.of(null) });

		// 3. 다시 열면 마지막 선택인 append가 유지됨
		openPromptBar(mockPlugin, editor, mdView);
		const reopenedBtns = view.dom.querySelectorAll('.lumina-promptbar-mode-btn');
		expect(reopenedBtns[0].classList.contains('is-active')).toBe(false);
		expect(reopenedBtns[1].classList.contains('is-active')).toBe(true);
	});

	it('편집 퀵 액션 칩을 클릭하면 칩의 기본 actionType 대신 현재 프롬프트 바에서 선택한 모드로 실행된다', () => {
		view = new EditorView({
			state: EditorState.create({
				doc: 'Target sentence',
				selection: { anchor: 0, head: 15 },
				extensions: [buildPromptBarExtension(mockPlugin)],
			}),
			parent,
		});

		const editor = createMockEditorForCm(view);
		const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;

		openPromptBar(mockPlugin, editor, mdView);

		// append 모드로 전환한 뒤 actionType이 'replace'인 '요약' 칩 클릭
		const modeBtns = view.dom.querySelectorAll('.lumina-promptbar-mode-btn');
		(modeBtns[1] as HTMLButtonElement).click();

		const editChip = view.dom.querySelector('.lumina-promptbar-chip:not(.is-chat)') as HTMLButtonElement;
		editChip.click();

		expect(mockExecuteAction).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'qa-1', actionType: 'append' }),
			editor,
			mdView,
			expect.any(Object),
		);
	});

	it('타이핑 및 스트리밍 진행 중 모델 드롭다운과 퀵 액션 칩 DOM 인스턴스를 불필요하게 재생성하지 않는다', () => {
		vi.useFakeTimers();
		try {
			view = new EditorView({
				state: EditorState.create({
					doc: 'Target line',
					selection: { anchor: 0, head: 11 },
					extensions: [buildPromptBarExtension(mockPlugin)],
				}),
				parent,
			});

			const editor = createMockEditorForCm(view);
			const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;

			let emitProgress: ((p: { isThinking: boolean; previewText: string }) => void) | undefined;
			let resolveRun: (() => void) | undefined;
			mockExecuteAction.mockImplementation(async (_action, _ed, _v, opts?: QuickActionExecuteOptions) => {
				emitProgress = opts?.onStreamProgress;
				await new Promise<void>((resolve) => {
					resolveRun = resolve;
				});
			});

			openPromptBar(mockPlugin, editor, mdView);
			const inputEl = view.dom.querySelector('.lumina-promptbar-input') as HTMLTextAreaElement;
			const initialSelect = view.dom.querySelector('.lumina-promptbar-model-select') as HTMLSelectElement;
			const initialChip = view.dom.querySelector('.lumina-promptbar-chip') as HTMLButtonElement;
			expect(initialSelect).not.toBeNull();
			expect(initialChip).not.toBeNull();

			// 연속 타이핑 중에도 동일한 DOM 노드 유지
			inputEl.value = '가';
			inputEl.dispatchEvent(new Event('input', { bubbles: true }));
			inputEl.value = '가나다';
			inputEl.dispatchEvent(new Event('input', { bubbles: true }));
			expect(view.dom.querySelector('.lumina-promptbar-model-select')).toBe(initialSelect);
			expect(view.dom.querySelector('.lumina-promptbar-chip')).toBe(initialChip);

			// 스트리밍 진행 중에도 <select> 인스턴스가 재생성되지 않고 disabled만 전환
			const submitBtn = view.dom.querySelector('.lumina-promptbar-submit-btn') as HTMLButtonElement;
			submitBtn.click();
			emitProgress?.({ isThinking: false, previewText: 'First' });
			vi.advanceTimersByTime(40);
			emitProgress?.({ isThinking: false, previewText: 'First Second' });

			expect(view.dom.querySelector('.lumina-promptbar-model-select')).toBe(initialSelect);
			expect(initialSelect.disabled).toBe(true);

			submitBtn.click();
			resolveRun?.();
		} finally {
			vi.useRealTimers();
		}
	});

	it('phase 전환 시 모델 select의 disabled 상태를 토글하고, 모델 목록 변경 시 옵션을 재구성한다', () => {
		view = new EditorView({
			state: EditorState.create({
				doc: 'Target line',
				selection: { anchor: 0, head: 11 },
				extensions: [buildPromptBarExtension(mockPlugin)],
			}),
			parent,
		});

		const editor = createMockEditorForCm(view);
		const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;

		let resolveRun: (() => void) | undefined;
		mockExecuteAction.mockImplementation(async () => {
			await new Promise<void>((resolve) => {
				resolveRun = resolve;
			});
		});

		openPromptBar(mockPlugin, editor, mdView, '요약');
		const initialSelect = view.dom.querySelector('.lumina-promptbar-model-select') as HTMLSelectElement;
		expect(initialSelect.disabled).toBe(false);
		expect(initialSelect.querySelectorAll('option')).toHaveLength(1);

		const submitBtn = view.dom.querySelector('.lumina-promptbar-submit-btn') as HTMLButtonElement;
		submitBtn.click();
		expect(initialSelect.disabled).toBe(true);

		// 취소로 input 복귀 시 disabled 해제 및 동일 노드 유지
		submitBtn.click();
		expect(view.dom.querySelector('.lumina-promptbar-model-select')).toBe(initialSelect);
		expect(initialSelect.disabled).toBe(false);

		// 설정의 모델 목록 변경 후 상태 업데이트 시 옵션 재구성
		mockPlugin.settings.connections.providers[0].availableModels = ['gpt-4o-mini', 'gpt-4o'];
		const inputEl = view.dom.querySelector('.lumina-promptbar-input') as HTMLTextAreaElement;
		inputEl.value = '다시 요약';
		inputEl.dispatchEvent(new Event('input', { bubbles: true }));

		const updatedSelect = view.dom.querySelector('.lumina-promptbar-model-select') as HTMLSelectElement;
		expect(updatedSelect.querySelectorAll('option')).toHaveLength(2);
		expect(updatedSelect.querySelectorAll('option')[1].textContent).toContain('gpt-4o');

		resolveRun?.();
	});

	it('모바일 환경에서 입력 중 외부 pointerdown으로는 닫히지 않고 닫기 버튼으로 닫힌다', () => {
		const origIsMobile = Platform.isMobile;
		(Platform as { isMobile: boolean }).isMobile = true;
		vi.useFakeTimers();

		try {
			view = new EditorView({
				state: EditorState.create({
					doc: 'Target line',
					selection: { anchor: 0, head: 11 },
					extensions: [buildPromptBarExtension(mockPlugin)],
				}),
				parent,
			});

			const editor = createMockEditorForCm(view);
			const mdView = { file: { path: 'Note.md' } as TFile, editor } as unknown as MarkdownView;

			openPromptBar(mockPlugin, editor, mdView);
			vi.advanceTimersByTime(10);

			const closeBtn = view.dom.querySelector('.lumina-promptbar-close-btn') as HTMLButtonElement | null;
			const inputEl = view.dom.querySelector('.lumina-promptbar-input') as HTMLTextAreaElement;
			expect(closeBtn).not.toBeNull();

			inputEl.value = '작성 중인 프롬프트';
			inputEl.dispatchEvent(new Event('input', { bubbles: true }));

			// 프롬프트가 비어있지 않을 때 바 외부 탭은 프롬프트 바를 닫지 않아야 함
			const pointerDown = Object.assign(new Event('pointerdown', { bubbles: true }), {
				clientX: 10,
				clientY: 10,
				pointerId: 1,
			});
			const pointerUp = Object.assign(new Event('pointerup', { bubbles: true }), {
				clientX: 10,
				clientY: 10,
				pointerId: 1,
			});
			document.body.dispatchEvent(pointerDown);
			document.body.dispatchEvent(pointerUp);

			expect(view.dom.querySelector('.lumina-promptbar-input')).not.toBeNull();

			// 명시적 모바일 닫기 버튼 클릭 시 닫힘
			closeBtn!.click();
			expect(view.dom.querySelector('.lumina-promptbar-input')).toBeNull();
		} finally {
			vi.useRealTimers();
			(Platform as { isMobile: boolean }).isMobile = origIsMobile;
		}
	});
});
