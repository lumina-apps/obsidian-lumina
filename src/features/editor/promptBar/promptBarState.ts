import { StateField, StateEffect } from '@codemirror/state';
import type { EditorView, Tooltip } from '@codemirror/view';
import { Editor, MarkdownView, editorInfoField } from 'obsidian';
import type { MarkdownFileInfo } from 'obsidian';
import { get } from 'svelte/store';
import type LuminaPlugin from '../../../main';
import { approvalStore } from '../../../core/store/approvalStore';
import { sessionModelId, sessionProviderId } from '../../../core/store/chatStore';
import { getActiveProject } from '../../../core/store/projectStore';
import { isCliProvider, PROVIDER_CATEGORIES } from '../../../shared/types/settings.types';
import {
	buildProviderModelOptions,
	isEmbeddingModel,
	parseProviderModelValue,
	sortModelOptionsWithFavorites,
	toProviderModelValue,
	type ModelOption,
} from '../../../shared/utils/modelUtils';

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

export interface PromptBarFieldValue {
	state: PromptBarInternalState;
	tooltip: Tooltip | null;
}

export interface OpenPromptBarPayload {
	from: number;
	to: number;
	originalText: string;
	initialPrompt?: string;
}

export interface MiniIconAnchor {
	pos: number;
}

export interface ResolvedPromptBarModel {
	valid: boolean;
	providerId: string;
	modelId: string;
	options: ModelOption[];
}

export const openPromptBarEffect = StateEffect.define<OpenPromptBarPayload>();
export const updatePromptBarEffect = StateEffect.define<Partial<Omit<PromptBarInternalState, 'open'>>>();
export const closePromptBarEffect = StateEffect.define<null>();
export const setMiniIconEffect = StateEffect.define<MiniIconAnchor | null>();

export const INITIAL_STATE: PromptBarInternalState = {
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

/**
 * EditorView별 Obsidian Editor/View 컨텍스트 캐시.
 * editorInfoField를 사용할 수 없는 테스트·특수 뷰 환경에서도 폴백 컨텍스트를 제공한다.
 */
export const viewContextMap = new WeakMap<
	EditorView,
	{ editor: Editor; view: MarkdownView | MarkdownFileInfo }
>();

/**
 * plugin 인스턴스별 CM6 StateField 저장소 (TooltipView가 plugin을 참조하도록 바인딩).
 */
export const pluginFieldMap = new WeakMap<LuminaPlugin, StateField<PromptBarFieldValue>>();

/**
 * 세션 내 프롬프트 바에서 사용자가 직접 선택한 모델 캐시.
 */
export const sessionPromptBarModelMap = new WeakMap<
	LuminaPlugin,
	{ providerId: string; modelId: string }
>();

/**
 * 세션 내 프롬프트 바에서 마지막으로 선택한 적용 모드(replace / append) 캐시.
 */
export const sessionPromptBarModeMap = new WeakMap<LuminaPlugin, 'replace' | 'append'>();

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

/**
 * 프롬프트 바에서 사용할 수 있는 전체 모델 옵션과 현재 선택 모델을 결정한다.
 * 우선순위: 바에서 직접 선택한 모델 → 퀵 액션 모델 → 현재 채팅 세션 모델 → 프로젝트 기본 모델 → 첫 번째 검증 모델
 */
export function resolvePromptBarModel(plugin: LuminaPlugin): ResolvedPromptBarModel {
	const { providers, favoriteModels, quickActionProviderId, quickActionModelId } =
		plugin.settings.connections;

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
	const tryPair = (
		pid?: string | null,
		mid?: string | null,
	): { providerId: string; modelId: string } | null => {
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

/**
 * CM6 EditorView에 대응하는 Obsidian Editor와 뷰 컨텍스트를 해석한다.
 */
export function resolveEditorAndViewForCm(
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

/**
 * 현재 뷰의 활성 문서에 대기 중인 edit 승인 요청이 있는지 확인한다.
 */
export function hasPendingEditForView(
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
