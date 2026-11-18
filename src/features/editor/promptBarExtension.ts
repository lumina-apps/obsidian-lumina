import { StateField, StateEffect, RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, Decoration, showTooltip, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, Tooltip, TooltipView, ViewUpdate } from '@codemirror/view';
import { Editor, MarkdownView, Notice, Platform, Scope, editorInfoField, setIcon } from 'obsidian';
import type { MarkdownFileInfo } from 'obsidian';
import { get } from 'svelte/store';
import type LuminaPlugin from '../../main';
import type { QuickAction } from '../../shared/types/settings.types';
import { approvalManager, approvalStore } from '../../core/store/approvalStore';
import { sessionModelId, sessionProviderId } from '../../core/store/chatStore';
import { getActiveProject } from '../../core/store/projectStore';
import { t } from '../../shared/locales/helpers';
import {
	buildProviderModelOptions,
	 isEmbeddingModel,
	parseProviderModelValue,
	sortModelOptionsWithFavorites,
	toProviderModelValue,
	type ModelOption,
} from '../../shared/utils/modelUtils';
import { isCliProvider, PROVIDER_CATEGORIES } from '../../shared/types/settings.types';
import { aiEditAnnotation, computeScopedMinimalChange } from './editorAnnotations';
import type { QuickActionStreamProgress } from './quickActionHandler';

export type PromptBarPhase = 'input' | 'generating' | 'review';

export interface PromptBarInternalState {
	open: boolean;
	phase: PromptBarPhase;
	from: number;
	to: number;
	originalText: string;
	prompt: string;
	mode: 'replace' | 'append';
	errorMessage: string | null;
	approvalRequestId: string | null;
	streamingPreview: string;
	isThinking: boolean;
}

interface PromptBarFieldValue {
	state: PromptBarInternalState;
	tooltip: Tooltip | null;
}

interface OpenPromptBarPayload {
	from: number;
	to: number;
	originalText: string;
	initialPrompt?: string;
}

interface MiniIconAnchor {
	pos: number;
}

export const openPromptBarEffect = StateEffect.define<OpenPromptBarPayload>();
export const updatePromptBarEffect = StateEffect.define<Partial<Omit<PromptBarInternalState, 'open'>>>();
export const closePromptBarEffect = StateEffect.define<null>();
export const setMiniIconEffect = StateEffect.define<MiniIconAnchor | null>();

const INITIAL_STATE: PromptBarInternalState = {
	open: false,
	phase: 'input',
	from: 0,
	to: 0,
	originalText: '',
	prompt: '',
	mode: 'replace',
	errorMessage: null,
	approvalRequestId: null,
	streamingPreview: '',
	isThinking: false,
};

const targetRangeMark = Decoration.mark({ class: 'lumina-promptbar-target-highlight' });
const targetReplacingMark = Decoration.mark({ class: 'lumina-promptbar-target-replacing' });

/**
 * 생성(스트리밍) 중 에디터 본문 대상 위치에 실시간 프리뷰를 표시하는 위젯.
 * 완료 후 diffExtension이 그리는 .lumina-diff-added-widget 스타일을 그대로 재사용한다.
 */
class DiffStreamingWidget extends WidgetType {
	constructor(public text: string) {
		super();
	}

	eq(other: DiffStreamingWidget): boolean {
		return this.text === other.text;
	}

	toDOM(): HTMLElement {
		const div = createDiv({ cls: 'lumina-diff-added-widget lumina-promptbar-streaming-widget' });
		const display = this.text.replace(/\r?\n$/, '');
		const lines = display.split(/\r?\n/);
		for (const line of lines) {
			div.createDiv({ cls: 'lumina-diff-added-line', text: `+ ${line}` });
		}
		return div;
	}
}

/**
 * EditorView별 Obsidian Editor/View 컨텍스트 캐시.
 * editorInfoField를 사용할 수 없는 테스트·특수 뷰 환경에서도 폴백 컨텍스트를 제공한다.
 */
const viewContextMap = new WeakMap<EditorView, { editor: Editor; view: MarkdownView | MarkdownFileInfo }>();

/**
 * plugin 인스턴스별 CM6 StateField 저장소 (TooltipView가 plugin을 참조하도록 바인딩).
 */
const pluginFieldMap = new WeakMap<LuminaPlugin, StateField<PromptBarFieldValue>>();

/**
 * 세션 내 프롬프트 바에서 사용자가 직접 선택한 모델 캐시.
 */
const sessionPromptBarModelMap = new WeakMap<LuminaPlugin, { providerId: string; modelId: string }>();

/**
 * 세션 내 프롬프트 바에서 마지막으로 선택한 적용 모드(replace / append) 캐시.
 */
const sessionPromptBarModeMap = new WeakMap<LuminaPlugin, 'replace' | 'append'>();

/**
 * Obsidian Editor에서 내부 CM6 EditorView 인스턴스를 안전하게 추출한다.
 */
export function getCmEditorView(editor: Editor): EditorView | null {
	const candidate = (editor as unknown as { cm?: unknown }).cm;
	if (candidate && typeof candidate === 'object' && 'state' in candidate && 'dispatch' in candidate) {
		return candidate as EditorView;
	}
	return null;
}

/**
 * 현재 선택 영역 또는(선택 없음 시) 커서가 위치한 줄의 오프셋·텍스트를 계산한다.
 * 빈 줄이면 null을 반환한다.
 */
export function resolveTargetRange(
	editor: Editor,
	cmView: EditorView,
): { from: number; to: number; text: string } | null {
	const fromPos = editor.getCursor('from');
	const toPos = editor.getCursor('to');
	let from = editor.posToOffset(fromPos);
	let to = editor.posToOffset(toPos);
	if (from > to) {
		[from, to] = [to, from];
	}

	if (from === to) {
		const lineText = editor.getLine(fromPos.line);
		if (!lineText || lineText.trim() === '') {
			return null;
		}
		from = editor.posToOffset({ line: fromPos.line, ch: 0 });
		to = editor.posToOffset({ line: fromPos.line, ch: lineText.length });
	}

	const docLen = cmView.state.doc.length;
	const clampedFrom = Math.max(0, Math.min(from, docLen));
	const clampedTo = Math.max(clampedFrom, Math.min(to, docLen));
	const text = cmView.state.doc.sliceString(clampedFrom, clampedTo);
	if (!text || text.trim() === '') {
		return null;
	}
	return { from: clampedFrom, to: clampedTo, text };
}

interface ResolvedPromptBarModel {
	valid: boolean;
	providerId: string;
	modelId: string;
	options: ModelOption[];
}

/**
 * 프롬프트 바에서 사용할 수 있는 전체 모델 옵션과 현재 선택 모델을 결정한다.
 * 우선순위: 바에서 직접 선택한 모델 → 퀵 액션 모델 → 현재 채팅 세션 모델 → 프로젝트 기본 모델 → 첫 번째 검증 모델
 */
function resolvePromptBarModel(plugin: LuminaPlugin): ResolvedPromptBarModel {
	const { providers, favoriteModels, quickActionProviderId, quickActionModelId } = plugin.settings.connections;

	const rawOptions = buildProviderModelOptions(
		providers,
		(type, modelId) => {
			if (isCliProvider(type)) return false;
			const isLocal = PROVIDER_CATEGORIES[type] === 'local' || type === 'custom';
			if (isLocal) return true;
			return !isEmbeddingModel(type, modelId);
		},
		'',
	);
	const options = sortModelOptionsWithFavorites(rawOptions, favoriteModels);

	if (options.length === 0) {
		return { valid: false, providerId: '', modelId: '', options: [] };
	}

	const validValueSet = new Set(options.map((o) => o.value));
	const tryPair = (pid?: string | null, mid?: string | null): { providerId: string; modelId: string } | null => {
		if (!pid || !mid) return null;
		const val = toProviderModelValue(pid, mid);
		return validValueSet.has(val) ? { providerId: pid, modelId: mid } : null;
	};

	const sessionOverride = sessionPromptBarModelMap.get(plugin);
	const activeProject = getActiveProject();

	const resolved =
		tryPair(sessionOverride?.providerId, sessionOverride?.modelId) ??
		tryPair(quickActionProviderId, quickActionModelId) ??
		tryPair(get(sessionProviderId), get(sessionModelId)) ??
		tryPair(activeProject?.defaultProviderId, activeProject?.defaultModelId) ??
		parseProviderModelValue(options[0].value);

	if (!resolved) {
		return { valid: false, providerId: '', modelId: '', options };
	}

	return {
		valid: true,
		providerId: resolved.providerId,
		modelId: resolved.modelId,
		options,
	};
}

function openLuminaSettings(plugin: LuminaPlugin): void {
	const appWithSetting = plugin.app as unknown as {
		setting?: {
			open(): void;
			openTabById(id: string): void;
		};
	};
	appWithSetting.setting?.open();
	appWithSetting.setting?.openTabById(plugin.manifest.id);
}

function resolveEditorAndViewForCm(
	plugin: LuminaPlugin,
	cmView: EditorView,
): { editor: Editor; view: MarkdownView | MarkdownFileInfo } | null {
	const cached = viewContextMap.get(cmView);
	const info = editorInfoField ? cmView.state.field(editorInfoField, false) : undefined;
	const activeMdView = plugin.app.workspace.getActiveViewOfType(MarkdownView);

	const editor = info?.editor ?? cached?.editor ?? activeMdView?.editor ?? null;
	const targetView = info ?? cached?.view ?? activeMdView ?? null;
	if (!editor || !targetView) {
		return null;
	}
	return { editor, view: targetView };
}

function hasPendingEditForView(
	plugin: LuminaPlugin,
	cmView: EditorView,
	view?: MarkdownView | MarkdownFileInfo,
): boolean {
	const infoFile = editorInfoField ? cmView.state.field(editorInfoField, false)?.file : null;
	const viewFile = (view as MarkdownView | undefined)?.file ?? null;
	const activeFile = viewFile ?? infoFile ?? plugin.app.workspace.getActiveFile?.() ?? null;
	if (!activeFile?.path) return false;
	return get(approvalStore).queue.some(
		(req) => req.filePath === activeFile.path && req.actionType === 'edit',
	);
}

/**
 * 에디터 선택 영역(또는 현재 줄) 위에 플로팅 즉석 프롬프트 바를 연다.
 */
export function openPromptBar(
	plugin: LuminaPlugin,
	editor: Editor,
	view: MarkdownView | MarkdownFileInfo,
	initialPrompt?: string,
): boolean {
	const cmView = getCmEditorView(editor);
	if (!cmView) {
		return false;
	}

	const field = pluginFieldMap.get(plugin);
	if (!field) {
		return false;
	}

	viewContextMap.set(cmView, { editor, view });

	const existing = cmView.state.field(field, false);
	if (existing?.state.open) {
		// 이미 열려 있으면 입력창에 포커스 유도 (새 초기 프롬프트가 주어진 경우에만 내용 갱신)
		if (initialPrompt !== undefined && existing.state.phase === 'input') {
			cmView.dispatch({
				effects: updatePromptBarEffect.of({ prompt: initialPrompt }),
			});
		}
		const inputEl = cmView.dom.querySelector('.lumina-promptbar-input') as HTMLTextAreaElement | null;
		inputEl?.focus();
		return true;
	}

	const range = resolveTargetRange(editor, cmView);
	if (!range) {
		new Notice(t('uiMessages.inlineEmpty'));
		return false;
	}

	if (hasPendingEditForView(plugin, cmView, view)) {
		new Notice(t('uiMessages.promptBar.pendingDiffExists'));
		return false;
	}

	cmView.dispatch({
		effects: openPromptBarEffect.of({
			from: range.from,
			to: range.to,
			originalText: range.text,
			initialPrompt,
		}),
	});
	return true;
}

/**
 * 선택 영역 끝자락에 표시되는 작은 플로팅 AI 실행 버튼 툴팁.
 */
class SelectionMiniIconTooltipView implements TooltipView {
	dom: HTMLElement;

	constructor(plugin: LuminaPlugin, view: EditorView) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'lumina-mini-trigger';
		btn.setAttribute('aria-label', t('uiMessages.promptBar.commandTitle'));

		const iconEl = btn.createSpan({ cls: 'lumina-mini-trigger-icon' });
		setIcon(iconEl, 'sparkles');
		btn.createSpan({ cls: 'lumina-mini-trigger-label', text: 'AI' });

		// 클릭 시 에디터 선택 영역이 해제되지 않도록 mousedown 기본 동작 차단
		btn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
		});

		btn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const resolved = resolveEditorAndViewForCm(plugin, view);
			if (!resolved) return;
			openPromptBar(plugin, resolved.editor, resolved.view);
		});

		this.dom = btn;
	}
}

class PromptBarTooltipView implements TooltipView {
	dom: HTMLElement;
	private plugin: LuminaPlugin;
	private view: EditorView;
	private field: StateField<PromptBarFieldValue>;

	private textareaEl: HTMLTextAreaElement;
	private submitBtn: HTMLButtonElement;
	private replaceBtn: HTMLButtonElement;
	private appendBtn: HTMLButtonElement;
	private modelChipEl: HTMLDivElement;
	private chipsRowEl: HTMLDivElement;
	private errorEl: HTMLDivElement;
	private statusEl: HTMLDivElement;
	private statusTextEl: HTMLSpanElement;
	private reviewRowEl: HTMLDivElement;
	private rejectBtn: HTMLButtonElement;
	private acceptBtn: HTMLButtonElement;

	private keymapScope: Scope | null = null;
	private outsidePointerHandler: ((e: PointerEvent) => void) | null = null;
	private mountTimerId: number | null = null;
	private outsideListenerTimerId: number | null = null;
	private focusTimerId: number | null = null;
	private streamTimerId: number | null = null;
	private pendingStreamProgress: QuickActionStreamProgress | null = null;
	private lastDispatchedPreview = '';
	private lastDispatchedThinking = false;
	private abortController: AbortController | null = null;

	private isComposing = false;
	private destroyed = false;
	private returningToInput = false;
	private runToken = 0;
	private lastPhase: PromptBarPhase | null = null;
	private lastSubmitIconMode: 'send' | 'cancel' | null = null;
	private handledKeyEvents = new WeakSet<KeyboardEvent>();

	constructor(
		plugin: LuminaPlugin,
		view: EditorView,
		field: StateField<PromptBarFieldValue>,
		initialState: PromptBarInternalState,
	) {
		this.plugin = plugin;
		this.view = view;
		this.field = field;

		this.dom = createDiv({ cls: 'lumina-promptbar' });
		this.dom.setAttribute('role', 'dialog');
		this.dom.tabIndex = -1;

		// Obsidian은 [aria-label] 호버 시 자동으로 툴팁을 띄우므로, 다이얼로그 컨테이너에는
		// aria-label 대신 스크린 리더 전용 라벨 요소 + aria-labelledby를 사용한다.
		const srTitleId = `lumina-promptbar-title-${Math.random().toString(36).slice(2, 9)}`;
		const srTitle = this.dom.createSpan({
			cls: 'lumina-sr-only',
			text: t('uiMessages.promptBar.commandTitle'),
			attr: { id: srTitleId },
		});
		void srTitle;
		this.dom.setAttribute('aria-labelledby', srTitleId);

		// ── 상단 입력 섹션 ──
		const inputRow = this.dom.createDiv({ cls: 'lumina-promptbar-input-row' });
		const iconEl = inputRow.createSpan({ cls: 'lumina-promptbar-icon' });
		setIcon(iconEl, 'sparkles');

		this.textareaEl = inputRow.createEl('textarea', {
			cls: 'lumina-promptbar-input',
			attr: {
				rows: '1',
				placeholder: t('uiMessages.promptBar.placeholder'),
			},
		});
		this.textareaEl.value = initialState.prompt;

		this.submitBtn = inputRow.createEl('button', {
			cls: 'lumina-promptbar-submit-btn',
			attr: {
				type: 'button',
				'aria-label': t('uiMessages.promptBar.run'),
			},
		});

		// ── 에러 배너 ──
		this.errorEl = this.dom.createDiv({ cls: 'lumina-promptbar-error' });

		// ── 생성 중 상태 행 ──
		this.statusEl = this.dom.createDiv({ cls: 'lumina-promptbar-status' });
		const statusLeft = this.statusEl.createDiv({ cls: 'lumina-promptbar-status-left' });
		statusLeft.createSpan({ cls: 'lumina-promptbar-spinner' });
		this.statusTextEl = statusLeft.createSpan({ text: t('uiMessages.promptBar.generating') });
		this.statusEl.createEl('kbd', { cls: 'lumina-promptbar-kbd', text: 'Esc' });

		// ── 리뷰(Accept/Reject) 행 ──
		this.reviewRowEl = this.dom.createDiv({ cls: 'lumina-promptbar-review' });
		this.reviewRowEl.createSpan({
			cls: 'lumina-promptbar-review-hint',
			text: t('uiMessages.promptBar.reviewHint'),
		});
		const reviewActions = this.reviewRowEl.createDiv({ cls: 'lumina-promptbar-review-actions' });
		this.rejectBtn = reviewActions.createEl('button', {
			cls: 'lumina-promptbar-btn reject',
			attr: { type: 'button' },
		});
		const rejectIcon = this.rejectBtn.createSpan({ cls: 'lumina-promptbar-btn-icon' });
		setIcon(rejectIcon, 'x');
		this.rejectBtn.createSpan({ text: t('uiMessages.actionApproval.reject') });

		this.acceptBtn = reviewActions.createEl('button', {
			cls: 'lumina-promptbar-btn accept',
			attr: { type: 'button' },
		});
		const acceptIcon = this.acceptBtn.createSpan({ cls: 'lumina-promptbar-btn-icon' });
		setIcon(acceptIcon, 'check');
		this.acceptBtn.createSpan({ text: t('uiMessages.actionApproval.accept') });

		// ── 하단 푸터 (모드 토글 + 모델 + 퀵 액션 칩) ──
		const footerEl = this.dom.createDiv({ cls: 'lumina-promptbar-footer' });
		const controlsRow = footerEl.createDiv({ cls: 'lumina-promptbar-controls' });
		const modeGroup = controlsRow.createDiv({ cls: 'lumina-promptbar-mode-group' });
		this.replaceBtn = modeGroup.createEl('button', {
			cls: 'lumina-promptbar-mode-btn',
			text: t('uiMessages.promptBar.modeReplace'),
			attr: { type: 'button' },
		});
		this.appendBtn = modeGroup.createEl('button', {
			cls: 'lumina-promptbar-mode-btn',
			text: t('uiMessages.promptBar.modeAppend'),
			attr: { type: 'button' },
		});
		this.modelChipEl = controlsRow.createDiv({ cls: 'lumina-promptbar-model-chip' });

		this.chipsRowEl = footerEl.createDiv({ cls: 'lumina-promptbar-chips' });

		this.bindEvents();
		this.syncDOM(initialState);
	}

	private bindEvents(): void {
		// 툴팁 내부 마우스다운 시 에디터 포커스 탈취·선택 변경 방지
		this.dom.addEventListener('mousedown', (e) => {
			e.stopPropagation();
		});

		this.dom.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (this.handledKeyEvents.has(e)) return;

			if (e.key === 'Escape') {
				if (this.isComposing || e.isComposing || e.keyCode === 229) return;
				this.handledKeyEvents.add(e);
				e.preventDefault();
				this.handleEscape();
				return;
			}

			const current = this.getState();
			if (
				current?.phase === 'review' &&
				e.key === 'Enter' &&
				!e.shiftKey &&
				e.target !== this.rejectBtn
			) {
				this.handledKeyEvents.add(e);
				e.preventDefault();
				this.handleAccept();
			}
		});

		this.textareaEl.addEventListener('compositionstart', () => {
			this.isComposing = true;
		});
		this.textareaEl.addEventListener('compositionend', () => {
			this.isComposing = false;
		});

		this.textareaEl.addEventListener('input', () => {
			this.autoResizeTextarea();
			const current = this.getState();
			if (current?.open) {
				this.view.dispatch({
					effects: updatePromptBarEffect.of({
						prompt: this.textareaEl.value,
						errorMessage: null,
					}),
				});
			}
		});

		this.textareaEl.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (this.isComposing || e.isComposing || e.keyCode === 229) {
				return;
			}

			if (e.key === 'Enter' && !e.shiftKey) {
				this.handledKeyEvents.add(e);
				e.preventDefault();
				this.submitCustomPrompt();
				return;
			}

			if (e.key === 'Escape') {
				this.handledKeyEvents.add(e);
				e.preventDefault();
				this.handleEscape();
			}
		});

		this.submitBtn.addEventListener('click', () => {
			const current = this.getState();
			if (current?.phase === 'generating') {
				this.cancelGeneration();
			} else {
				this.submitCustomPrompt();
			}
		});

		this.replaceBtn.addEventListener('click', () => {
			this.setMode('replace');
		});
		this.appendBtn.addEventListener('click', () => {
			this.setMode('append');
		});

		this.rejectBtn.addEventListener('click', () => {
			this.handleRejectToInput();
		});
		this.acceptBtn.addEventListener('click', () => {
			this.handleAccept();
		});
	}

	mount(): void {
		if (this.destroyed) return;

		// 바가 열린 동안 Obsidian 전역 Escape 단축키가 바깥으로 새지 않도록 Scope 푸시
		if (typeof Scope === 'function' && this.plugin.app?.keymap?.pushScope) {
			const parentScope = (this.plugin.app as unknown as { scope?: Scope }).scope;
			this.keymapScope = new Scope(parentScope);
			this.keymapScope.register([], 'Escape', (evt) => {
				if (this.isComposing || evt.isComposing) return true;
				if (this.handledKeyEvents.has(evt)) return false;
				this.handledKeyEvents.add(evt);
				this.handleEscape();
				return false;
			});
			this.plugin.app.keymap.pushScope(this.keymapScope);
		}

		// 메뉴 닫힘 직후 포커스가 에디터로 돌아가는 것을 피하기 위해 다음 틱에 입력창 포커스
		this.mountTimerId = window.setTimeout(() => {
			this.mountTimerId = null;
			if (this.destroyed) return;
			this.autoResizeTextarea();
			this.textareaEl.focus();
			const len = this.textareaEl.value.length;
			this.textareaEl.setSelectionRange(len, len);
		}, 0);

		// 열기 클릭 이벤트 버블링 이후 바깥 클릭 감지 등록
		this.outsidePointerHandler = (e: PointerEvent) => {
			if (this.destroyed) return;
			if (!(e.target instanceof Node) || this.dom.contains(e.target)) return;
			const current = this.getState();
			if (current?.open && current.phase === 'input') {
				this.closeBar();
			}
		};
		this.outsideListenerTimerId = window.setTimeout(() => {
			this.outsideListenerTimerId = null;
			if (this.destroyed || !this.outsidePointerHandler) return;
			document.addEventListener('pointerdown', this.outsidePointerHandler, true);
		}, 0);
	}

	update(update: ViewUpdate): void {
		if (this.destroyed) return;
		const fieldVal = update.state.field(this.field, false);
		if (fieldVal?.state.open) {
			this.syncDOM(fieldVal.state);
		}
	}

	destroy(): void {
		this.destroyed = true;
		if (this.mountTimerId !== null) {
			window.clearTimeout(this.mountTimerId);
			this.mountTimerId = null;
		}
		if (this.outsideListenerTimerId !== null) {
			window.clearTimeout(this.outsideListenerTimerId);
			this.outsideListenerTimerId = null;
		}
		if (this.focusTimerId !== null) {
			window.clearTimeout(this.focusTimerId);
			this.focusTimerId = null;
		}
		this.clearStreamTimer();
		if (this.outsidePointerHandler) {
			document.removeEventListener('pointerdown', this.outsidePointerHandler, true);
			this.outsidePointerHandler = null;
		}
		if (this.keymapScope && this.plugin.app?.keymap?.popScope) {
			this.plugin.app.keymap.popScope(this.keymapScope);
			this.keymapScope = null;
		}
		if (this.abortController && !this.abortController.signal.aborted) {
			this.abortController.abort();
		}
		this.abortController = null;
	}

	private getState(): PromptBarInternalState | null {
		return this.view.state.field(this.field, false)?.state ?? null;
	}

	private autoResizeTextarea(): void {
		this.textareaEl.style.height = 'auto';
		const nextHeight = Math.min(Math.max(this.textareaEl.scrollHeight, 24), 108);
		this.textareaEl.style.height = `${nextHeight}px`;
	}

	private setMode(mode: 'replace' | 'append'): void {
		const current = this.getState();
		if (!current || current.phase !== 'input') return;
		sessionPromptBarModeMap.set(this.plugin, mode);
		this.view.dispatch({
			effects: updatePromptBarEffect.of({ mode }),
		});
		this.textareaEl.focus();
	}

	private clearStreamTimer(): void {
		if (this.streamTimerId !== null) {
			window.clearTimeout(this.streamTimerId);
			this.streamTimerId = null;
		}
		this.pendingStreamProgress = null;
	}

	private flushStreamProgress(progress: QuickActionStreamProgress): void {
		if (this.destroyed) return;
		const current = this.getState();
		if (!current || !current.open || current.phase !== 'generating') return;
		if (
			progress.previewText === this.lastDispatchedPreview &&
			progress.isThinking === this.lastDispatchedThinking
		) {
			return;
		}
		this.lastDispatchedPreview = progress.previewText;
		this.lastDispatchedThinking = progress.isThinking;
		this.view.dispatch({
			effects: updatePromptBarEffect.of({
				streamingPreview: progress.previewText,
				isThinking: progress.isThinking,
			}),
		});
	}

	private closeBar(): void {
		this.clearStreamTimer();
		this.abortController?.abort();
		this.abortController = null;
		this.view.dispatch({
			effects: closePromptBarEffect.of(null),
		});
	}

	private scheduleFocus(el: HTMLElement): void {
		if (this.focusTimerId !== null) {
			window.clearTimeout(this.focusTimerId);
		}
		this.focusTimerId = window.setTimeout(() => {
			this.focusTimerId = null;
			if (!this.destroyed) {
				el.focus();
			}
		}, 0);
	}

	private cancelGeneration(): void {
		this.runToken++;
		this.clearStreamTimer();
		this.lastDispatchedPreview = '';
		this.lastDispatchedThinking = false;
		this.abortController?.abort();
		this.abortController = null;
		this.view.dispatch({
			effects: updatePromptBarEffect.of({
				phase: 'input',
				errorMessage: null,
				approvalRequestId: null,
				streamingPreview: '',
				isThinking: false,
			}),
		});
		this.scheduleFocus(this.textareaEl);
	}

	private handleAccept(): void {
		const current = this.getState();
		if (!current || current.phase !== 'review' || !current.approvalRequestId) return;
		approvalManager.acceptAll(current.approvalRequestId);
	}

	private handleRejectToInput(): void {
		const current = this.getState();
		if (!current || current.phase !== 'review') return;
		if (current.approvalRequestId) {
			this.returningToInput = true;
			approvalManager.rejectAll(current.approvalRequestId);
		} else {
			this.view.dispatch({
				effects: updatePromptBarEffect.of({
					phase: 'input',
					approvalRequestId: null,
				}),
			});
		}
		this.scheduleFocus(this.textareaEl);
	}

	private handleEscape(): void {
		const current = this.getState();
		if (!current || !current.open) return;

		if (current.phase === 'generating') {
			this.cancelGeneration();
		} else if (current.phase === 'review') {
			this.handleRejectToInput();
		} else {
			this.closeBar();
			this.view.focus();
		}
	}

	private submitCustomPrompt(): void {
		const current = this.getState();
		if (!current || !current.open || current.phase !== 'input') return;

		const trimmed = this.textareaEl.value.trim();
		if (!trimmed) return;

		const action: QuickAction = {
			id: '__adhoc__',
			name: trimmed.length > 30 ? `${trimmed.slice(0, 30)}…` : trimmed,
			prompt: trimmed,
			actionType: current.mode,
		};
		this.runAction(action);
	}

	private runAction(action: QuickAction): void {
		const current = this.getState();
		if (!current || !current.open || current.phase !== 'input') return;

		const resolved = resolveEditorAndViewForCm(this.plugin, this.view);
		if (!resolved) return;

		const docLen = this.view.state.doc.length;
		const clampedFrom = Math.max(0, Math.min(current.from, docLen));
		const clampedTo = Math.max(clampedFrom, Math.min(current.to, docLen));
		const targetText = this.view.state.doc.sliceString(clampedFrom, clampedTo);
		if (!targetText) {
			this.closeBar();
			return;
		}

		if (action.actionType === 'chat') {
			// 채팅 전송 칩 클릭 시에는 바를 닫고 채팅 뷰로 전달
			this.closeBar();
			void this.plugin.quickActionHandler.executeAction(action, resolved.editor, resolved.view, {
				targetRange: {
					from: clampedFrom,
					to: clampedTo,
					text: targetText,
				},
			});
			return;
		}

		const modelInfo = resolvePromptBarModel(this.plugin);
		if (!modelInfo.valid) {
			this.view.dispatch({
				effects: updatePromptBarEffect.of({
					errorMessage: t('uiMessages.qaNotConfigured'),
				}),
			});
			return;
		}

		if (hasPendingEditForView(this.plugin, this.view, resolved.view)) {
			this.view.dispatch({
				effects: updatePromptBarEffect.of({
					errorMessage: t('uiMessages.promptBar.pendingDiffExists'),
				}),
			});
			return;
		}

		this.runToken++;
		const myToken = this.runToken;
		this.clearStreamTimer();
		this.lastDispatchedPreview = '';
		this.lastDispatchedThinking = false;
		this.abortController?.abort();
		this.abortController = new AbortController();

		this.view.dispatch({
			effects: updatePromptBarEffect.of({
				phase: 'generating',
				prompt: this.textareaEl.value,
				errorMessage: null,
				approvalRequestId: null,
				streamingPreview: '',
				isThinking: false,
			}),
		});

		void this.plugin.quickActionHandler.executeAction(action, resolved.editor, resolved.view, {
			signal: this.abortController.signal,
			providerId: modelInfo.providerId,
			modelId: modelInfo.modelId,
			suppressNotices: true,
			targetRange: {
				from: clampedFrom,
				to: clampedTo,
				text: targetText,
			},
			onStreamProgress: (progress) => {
				if (this.destroyed || myToken !== this.runToken) return;
				if (
					progress.previewText === this.lastDispatchedPreview &&
					progress.isThinking === this.lastDispatchedThinking
				) {
					return;
				}
				if (this.streamTimerId === null) {
					this.flushStreamProgress(progress);
					this.streamTimerId = window.setTimeout(() => {
						this.streamTimerId = null;
						const trailing = this.pendingStreamProgress;
						this.pendingStreamProgress = null;
						if (trailing && !this.destroyed && myToken === this.runToken) {
							this.flushStreamProgress(trailing);
						}
					}, 32);
				} else {
					this.pendingStreamProgress = progress;
				}
			},
			onGenerationFinished: () => {
				if (this.destroyed || myToken !== this.runToken) return;
				this.clearStreamTimer();
			},
			onApprovalQueued: (requestId) => {
				if (this.destroyed || myToken !== this.runToken) return;
				this.clearStreamTimer();
				this.lastDispatchedPreview = '';
				this.lastDispatchedThinking = false;
				this.view.dispatch({
					effects: updatePromptBarEffect.of({
						phase: 'review',
						approvalRequestId: requestId,
						errorMessage: null,
						streamingPreview: '',
						isThinking: false,
					}),
				});
			},
			applyApprovedContent: (approvalContent, ctx) => {
				if (this.destroyed) return false;
				const latest = this.getState();
				if (!latest || !latest.open) return false;

				const currentTarget = this.view.state.doc.sliceString(latest.from, latest.to);
				if (currentTarget !== ctx.targetText) {
					new Notice(t('uiMessages.promptBar.targetModified'));
					this.view.dispatch({ effects: closePromptBarEffect.of(null) });
					return false;
				}

				const minimal = computeScopedMinimalChange(
					ctx.baseDoc,
					ctx.startOffset,
					ctx.endOffset,
					approvalContent,
					latest.from,
				);

				if (minimal?.isFullDoc && this.view.state.doc.toString() !== ctx.baseDoc) {
					new Notice(t('uiMessages.promptBar.targetModified'));
					this.view.dispatch({ effects: closePromptBarEffect.of(null) });
					return false;
				}

				this.view.dispatch({
					...(minimal
						? { changes: { from: minimal.from, to: minimal.to, insert: minimal.insert } }
						: {}),
					annotations: aiEditAnnotation.of(true),
					effects: closePromptBarEffect.of(null),
				});

				if (!minimal) {
					new Notice(t('uiMessages.promptBar.noChanges'));
				}
				return true;
			},
			onApprovalResult: (approved) => {
				if (this.destroyed || myToken !== this.runToken) return;
				if (approved) {
					if (this.getState()?.open) {
						this.view.dispatch({ effects: closePromptBarEffect.of(null) });
					}
					return;
				}
				if (this.returningToInput) {
					this.returningToInput = false;
					this.view.dispatch({
						effects: updatePromptBarEffect.of({
							phase: 'input',
							approvalRequestId: null,
						}),
					});
					this.scheduleFocus(this.textareaEl);
				} else if (this.getState()?.open) {
					// 외부 Diff 배너(Reject All) 또는 타임아웃으로 거절된 경우 바 닫기
					this.view.dispatch({ effects: closePromptBarEffect.of(null) });
				}
			},
			onError: (message) => {
				if (this.destroyed || myToken !== this.runToken) return;
				this.clearStreamTimer();
				this.lastDispatchedPreview = '';
				this.lastDispatchedThinking = false;
				this.view.dispatch({
					effects: updatePromptBarEffect.of({
						phase: 'input',
						errorMessage: message,
						approvalRequestId: null,
						streamingPreview: '',
						isThinking: false,
					}),
				});
				this.scheduleFocus(this.textareaEl);
			},
		});
	}

	private syncDOM(state: PromptBarInternalState): void {
		this.dom.dataset.phase = state.phase;

		if (this.textareaEl.value !== state.prompt && document.activeElement !== this.textareaEl) {
			this.textareaEl.value = state.prompt;
			this.autoResizeTextarea();
		}

		const isInput = state.phase === 'input';
		const isGenerating = state.phase === 'generating';
		const isReview = state.phase === 'review';

		const modelInfo = resolvePromptBarModel(this.plugin);
		const hasInput = this.textareaEl.value.trim().length > 0;

		this.textareaEl.disabled = !isInput;
		this.replaceBtn.disabled = !isInput;
		this.appendBtn.disabled = !isInput;

		this.replaceBtn.classList.toggle('is-active', state.mode === 'replace');
		this.appendBtn.classList.toggle('is-active', state.mode === 'append');

		if (isGenerating) {
			this.submitBtn.disabled = false;
			this.submitBtn.classList.add('is-cancel');
			this.submitBtn.classList.remove('is-ready');
			this.submitBtn.setAttribute('aria-label', t('uiMessages.promptBar.cancel'));
			if (this.lastSubmitIconMode !== 'cancel') {
				this.lastSubmitIconMode = 'cancel';
				this.submitBtn.empty();
				setIcon(this.submitBtn, 'lumina-square');
			}
		} else {
			const canRun = isInput && modelInfo.valid && hasInput;
			this.submitBtn.classList.remove('is-cancel');
			this.submitBtn.classList.toggle('is-ready', canRun);
			this.submitBtn.disabled = !canRun;
			this.submitBtn.setAttribute('aria-label', t('uiMessages.promptBar.run'));
			if (this.lastSubmitIconMode !== 'send') {
				this.lastSubmitIconMode = 'send';
				this.submitBtn.empty();
				setIcon(this.submitBtn, 'lumina-send');
			}
		}

		// 모델 칩(선택기) 렌더링
		this.modelChipEl.empty();
		if (modelInfo.valid) {
			this.modelChipEl.removeClass('is-warning');
			this.modelChipEl.createSpan({ cls: 'lumina-promptbar-model-dot' });
			const selectEl = this.modelChipEl.createEl('select', {
				cls: 'lumina-promptbar-model-select',
			});
			for (const opt of modelInfo.options) {
				const optionEl = selectEl.createEl('option', {
					text: opt.label,
					attr: { value: opt.value },
				});
				if (opt.value === toProviderModelValue(modelInfo.providerId, modelInfo.modelId)) {
					optionEl.selected = true;
				}
			}
			selectEl.value = toProviderModelValue(modelInfo.providerId, modelInfo.modelId);
			selectEl.disabled = !isInput;
			selectEl.addEventListener('change', () => {
				const parsed = parseProviderModelValue(selectEl.value);
				if (parsed) {
					sessionPromptBarModelMap.set(this.plugin, parsed);
					const cur = this.getState();
					if (cur) {
						this.syncDOM(cur);
					}
					this.scheduleFocus(this.textareaEl);
				}
			});
			const chevronEl = this.modelChipEl.createSpan({ cls: 'lumina-promptbar-model-chevron' });
			setIcon(chevronEl, 'chevron-down');
		} else {
			this.modelChipEl.addClass('is-warning');
			this.modelChipEl.createSpan({
				cls: 'lumina-promptbar-model-warn',
				text: t('uiMessages.promptBar.noModel'),
			});
			const settingsBtn = this.modelChipEl.createEl('button', {
				cls: 'lumina-promptbar-settings-link',
				text: t('uiMessages.promptBar.openSettings'),
				attr: { type: 'button' },
			});
			settingsBtn.addEventListener('click', () => {
				openLuminaSettings(this.plugin);
			});
		}

		// 에러 배너
		if (state.errorMessage && isInput) {
			this.errorEl.setText(state.errorMessage);
			this.errorEl.style.display = 'block';
		} else {
			this.errorEl.setText('');
			this.errorEl.style.display = 'none';
		}

		// 생성 중 상태 행
		this.statusEl.style.display = isGenerating ? 'flex' : 'none';
		if (isGenerating) {
			this.statusTextEl.setText(
				state.isThinking
					? t('uiMessages.promptBar.thinking')
					: t('uiMessages.promptBar.generating'),
			);
		}

		// 리뷰 행
		this.reviewRowEl.style.display = isReview ? 'flex' : 'none';

		// 퀵 액션 칩 (input 단계에서만 표시)
		this.chipsRowEl.empty();
		const quickActions = this.plugin.settings.chat.quickActions || [];
		if (isInput && quickActions.length > 0) {
			this.chipsRowEl.style.display = 'flex';
			for (const qa of quickActions) {
				const chipBtn = this.chipsRowEl.createEl('button', {
					cls: `lumina-promptbar-chip ${qa.actionType === 'chat' ? 'is-chat' : ''}`,
					attr: { type: 'button', title: qa.prompt || qa.name },
				});
				if (qa.actionType === 'chat') {
					const chipIcon = chipBtn.createSpan({ cls: 'lumina-promptbar-chip-icon' });
					setIcon(chipIcon, 'message-circle');
				}
				chipBtn.createSpan({ text: qa.name });
				chipBtn.addEventListener('click', () => {
					const cur = this.getState();
					if (!cur) return;
					// 채팅 전송 칩은 그대로 유지하고, 편집 칩은 프롬프트 바에서 현재 선택한 모드(바꾸기/아래에 추가)를 따른다
					const effectiveAction: QuickAction = qa.actionType === 'chat'
						? qa
						: { ...qa, actionType: cur.mode };
					this.runAction(effectiveAction);
				});
			}
		} else {
			this.chipsRowEl.style.display = 'none';
		}

		if (this.lastPhase !== state.phase) {
			this.lastPhase = state.phase;
			if (isReview) {
				this.scheduleFocus(this.acceptBtn);
			}
		}
	}
}

/**
 * CM6 에디터 플로팅 즉석 프롬프트 바 및 선택 영역 미니 AI 버튼 확장을 생성한다.
 */
export function buildPromptBarExtension(plugin: LuminaPlugin): Extension {
	const promptBarField: StateField<PromptBarFieldValue> = StateField.define<PromptBarFieldValue>({
		create() {
			return {
				state: { ...INITIAL_STATE },
				tooltip: null,
			};
		},
		update(value, tr) {
			let nextState = value.state;
			let nextTooltip = value.tooltip;

			// 같은 뷰에서 다른 노트로 전환되면 열린 프롬프트 바를 정리
			if (editorInfoField && nextState.open) {
				const oldFile = tr.startState.field(editorInfoField, false)?.file?.path;
				const newFile = tr.state.field(editorInfoField, false)?.file?.path;
				if (oldFile !== newFile) {
					nextState = { ...INITIAL_STATE };
					nextTooltip = null;
					return { state: nextState, tooltip: nextTooltip };
				}
			}

			if (tr.docChanged && nextState.open) {
				const docLen = tr.state.doc.length;
				const mappedFrom = Math.max(0, Math.min(tr.changes.mapPos(nextState.from, 1), docLen));
				const mappedTo = Math.max(mappedFrom, Math.min(tr.changes.mapPos(nextState.to, -1), docLen));
				nextState = {
					...nextState,
					from: mappedFrom,
					to: mappedTo,
				};
			}

			for (const effect of tr.effects) {
				if (effect.is(openPromptBarEffect)) {
					const payload = effect.value;
					const newState: PromptBarInternalState = {
						open: true,
						phase: 'input',
						from: payload.from,
						to: payload.to,
						originalText: payload.originalText,
						prompt: payload.initialPrompt ?? '',
						mode: sessionPromptBarModeMap.get(plugin) ?? 'replace',
						errorMessage: null,
						approvalRequestId: null,
						streamingPreview: '',
						isThinking: false,
					};
					nextState = newState;
					nextTooltip = {
						pos: payload.from,
						end: payload.to,
						above: !Platform.isMobile,
						strictSide: false,
						create(view: EditorView) {
							return new PromptBarTooltipView(plugin, view, promptBarField, newState);
						},
					};
				} else if (effect.is(updatePromptBarEffect)) {
					if (nextState.open) {
						nextState = {
							...nextState,
							...effect.value,
						};
					}
				} else if (effect.is(closePromptBarEffect)) {
					nextState = { ...INITIAL_STATE };
					nextTooltip = null;
				}
			}

			if (nextState === value.state && nextTooltip === value.tooltip) {
				return value;
			}
			return { state: nextState, tooltip: nextTooltip };
		},
		provide(field) {
			return [
				showTooltip.from(field, (val) => val.tooltip),
				EditorView.decorations.compute([field], (state): DecorationSet => {
					const val = state.field(field);
					if (!val.state.open) {
						return Decoration.none;
					}

					const docLen = state.doc.length;
					const from = Math.max(0, Math.min(val.state.from, docLen));
					const to = Math.max(from, Math.min(val.state.to, docLen));
					const isStreamingPreview =
						val.state.phase === 'generating' && val.state.streamingPreview.length > 0;

					const builder = new RangeSetBuilder<Decoration>();
					if (from < to) {
						const mark =
							isStreamingPreview && val.state.mode === 'replace'
								? targetReplacingMark
								: targetRangeMark;
						builder.add(from, to, mark);
					}
					if (isStreamingPreview) {
						const lineEnd = state.doc.lineAt(to).to;
						builder.add(
							lineEnd,
							lineEnd,
							Decoration.widget({
								widget: new DiffStreamingWidget(val.state.streamingPreview),
								block: true,
								side: 1,
							}),
						);
					}
					return builder.finish();
				}),
			];
		},
	});

	const miniIconField: StateField<Tooltip | null> = StateField.define<Tooltip | null>({
		create() {
			return null;
		},
		update(value, tr) {
			if (!plugin.settings.chat.enableSelectionMiniIcon) {
				return null;
			}
			if (tr.state.field(promptBarField, false)?.state.open) {
				return null;
			}
			if (tr.docChanged) {
				return null;
			}

			for (const effect of tr.effects) {
				if (effect.is(openPromptBarEffect)) {
					return null;
				}
				if (effect.is(setMiniIconEffect)) {
					const anchor = effect.value;
					if (!anchor) return null;
					if (value && value.pos === anchor.pos) return value;
					return {
						pos: anchor.pos,
						above: Platform.isMobile,
						strictSide: false,
						create(view: EditorView) {
							return new SelectionMiniIconTooltipView(plugin, view);
						},
					};
				}
			}

			if (tr.selection) {
				// 선택 변경 중에는 숨기고 ViewPlugin 디바운스 완료 후 다시 표시
				return null;
			}

			return value;
		},
		provide: (field) => showTooltip.from(field),
	});

	const miniIconPlugin = ViewPlugin.fromClass(class {
		private view: EditorView;
		private timer: number | null = null;
		private isPointerDown = false;
		private destroyed = false;

		private onPointerDown = () => {
			this.isPointerDown = true;
			if (this.timer !== null) {
				window.clearTimeout(this.timer);
				this.timer = null;
			}
		};

		private onPointerUp = () => {
			if (!this.isPointerDown) return;
			this.isPointerDown = false;
			this.scheduleCheck(80);
		};

		constructor(view: EditorView) {
			this.view = view;
			view.dom.addEventListener('pointerdown', this.onPointerDown);
			window.addEventListener('pointerup', this.onPointerUp);
		}

		update(update: ViewUpdate) {
			if (update.docChanged || update.selectionSet) {
				if (!plugin.settings.chat.enableSelectionMiniIcon) {
					if (this.timer !== null) {
						window.clearTimeout(this.timer);
						this.timer = null;
					}
					return;
				}
				if (this.isPointerDown) return;
				this.scheduleCheck(180);
			}
		}

		private scheduleCheck(delayMs: number): void {
			if (this.timer !== null) {
				window.clearTimeout(this.timer);
			}
			this.timer = window.setTimeout(() => {
				this.timer = null;
				if (this.destroyed || this.isPointerDown) return;
				if (!plugin.settings.chat.enableSelectionMiniIcon) return;
				if (this.view.state.field(promptBarField, false)?.state.open) return;

				const sel = this.view.state.selection.main;
				if (sel.empty) return;

				const selectedText = this.view.state.doc.sliceString(sel.from, sel.to);
				if (!selectedText || selectedText.trim().length === 0) return;

				if (hasPendingEditForView(plugin, this.view)) return;

				const anchorPos = Platform.isMobile ? sel.from : sel.to;
				this.view.dispatch({
					effects: setMiniIconEffect.of({ pos: anchorPos }),
				});
			}, delayMs);
		}

		destroy() {
			this.destroyed = true;
			if (this.timer !== null) {
				window.clearTimeout(this.timer);
				this.timer = null;
			}
			this.view.dom.removeEventListener('pointerdown', this.onPointerDown);
			window.removeEventListener('pointerup', this.onPointerUp);
		}
	});

	pluginFieldMap.set(plugin, promptBarField);
	return [promptBarField, miniIconField, miniIconPlugin];
}
