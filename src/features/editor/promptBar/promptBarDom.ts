import { WidgetType } from '@codemirror/view';
import { setIcon } from 'obsidian';
import type LuminaPlugin from '../../../main';
import type { QuickAction } from '../../../shared/types/settings.types';
import { t } from '../../../shared/locales/helpers';
import { parseProviderModelValue, toProviderModelValue } from '../../../shared/utils/modelUtils';
import { openSettingsTab } from '../../../shared/utils/openSettingsTab';
import { resolvePromptBarModel, type PromptBarInternalState } from './promptBarState';

/**
 * 생성(스트리밍) 중 에디터 본문 대상 위치에 실시간 프리뷰를 표시하는 위젯.
 * 완료 후 diffExtension이 그리는 .lumina-diff-added-widget 스타일을 그대로 재사용한다.
 */
export class DiffStreamingWidget extends WidgetType {
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

export interface PromptBarDomRefs {
	dom: HTMLElement;
	textareaEl: HTMLTextAreaElement;
	submitBtn: HTMLButtonElement;
	replaceBtn: HTMLButtonElement;
	appendBtn: HTMLButtonElement;
	modelChipEl: HTMLDivElement;
	chipsRowEl: HTMLDivElement;
	errorEl: HTMLDivElement;
	statusEl: HTMLDivElement;
	statusTextEl: HTMLSpanElement;
	reviewRowEl: HTMLDivElement;
	rejectBtn: HTMLButtonElement;
	acceptBtn: HTMLButtonElement;
}

export interface PromptBarDomCache {
	lastSubmitIconMode: 'send' | 'cancel' | null;
	lastModelRenderKey: string | null;
	modelSelectEl: HTMLSelectElement | null;
	lastChipsRenderKey: string | null;
}

export interface PromptBarDomCallbacks {
	onModelChange: (providerId: string, modelId: string) => void;
	onChipClick: (qa: QuickAction) => void;
}

/**
 * 플로팅 프롬프트 바의 초기 DOM 트리를 생성해 요소 참조를 반환한다.
 */
export function createPromptBarDom(initialPrompt: string): PromptBarDomRefs {
	const dom = createDiv({ cls: 'lumina-promptbar' });
	dom.setAttribute('role', 'dialog');
	dom.tabIndex = -1;

	// Obsidian은 [aria-label] 호버 시 자동으로 툴팁을 띄우므로, 다이얼로그 컨테이너에는
	// aria-label 대신 스크린 리더 전용 라벨 요소 + aria-labelledby를 사용한다.
	const srTitleId = `lumina-promptbar-title-${Math.random().toString(36).slice(2, 9)}`;
	dom.createSpan({
		cls: 'lumina-sr-only',
		text: t('uiMessages.promptBar.commandTitle'),
		attr: { id: srTitleId },
	});
	dom.setAttribute('aria-labelledby', srTitleId);

	// ── 상단 입력 섹션 ──
	const inputRow = dom.createDiv({ cls: 'lumina-promptbar-input-row' });
	const iconEl = inputRow.createSpan({ cls: 'lumina-promptbar-icon' });
	setIcon(iconEl, 'sparkles');

	const textareaEl = inputRow.createEl('textarea', {
		cls: 'lumina-promptbar-input',
		attr: {
			rows: '1',
			placeholder: t('uiMessages.promptBar.placeholder'),
		},
	});
	textareaEl.value = initialPrompt;

	const submitBtn = inputRow.createEl('button', {
		cls: 'lumina-promptbar-submit-btn',
		attr: {
			type: 'button',
			'aria-label': t('uiMessages.promptBar.run'),
		},
	});

	// ── 에러 배너 ──
	const errorEl = dom.createDiv({ cls: 'lumina-promptbar-error' });

	// ── 생성 중 상태 행 ──
	const statusEl = dom.createDiv({ cls: 'lumina-promptbar-status' });
	const statusLeft = statusEl.createDiv({ cls: 'lumina-promptbar-status-left' });
	statusLeft.createSpan({ cls: 'lumina-promptbar-spinner' });
	const statusTextEl = statusLeft.createSpan({ text: t('uiMessages.promptBar.generating') });
	statusEl.createEl('kbd', { cls: 'lumina-promptbar-kbd', text: 'Esc' });

	// ── 리뷰(Accept/Reject) 행 ──
	const reviewRowEl = dom.createDiv({ cls: 'lumina-promptbar-review' });
	reviewRowEl.createSpan({
		cls: 'lumina-promptbar-review-hint',
		text: t('uiMessages.promptBar.reviewHint'),
	});
	const reviewActions = reviewRowEl.createDiv({ cls: 'lumina-promptbar-review-actions' });
	const rejectBtn = reviewActions.createEl('button', {
		cls: 'lumina-promptbar-btn reject',
		attr: { type: 'button' },
	});
	const rejectIcon = rejectBtn.createSpan({ cls: 'lumina-promptbar-btn-icon' });
	setIcon(rejectIcon, 'x');
	rejectBtn.createSpan({ text: t('uiMessages.actionApproval.reject') });

	const acceptBtn = reviewActions.createEl('button', {
		cls: 'lumina-promptbar-btn accept',
		attr: { type: 'button' },
	});
	const acceptIcon = acceptBtn.createSpan({ cls: 'lumina-promptbar-btn-icon' });
	setIcon(acceptIcon, 'check');
	acceptBtn.createSpan({ text: t('uiMessages.actionApproval.accept') });

	// ── 하단 푸터 (모드 토글 + 모델 + 퀵 액션 칩) ──
	const footerEl = dom.createDiv({ cls: 'lumina-promptbar-footer' });
	const controlsRow = footerEl.createDiv({ cls: 'lumina-promptbar-controls' });
	const modeGroup = controlsRow.createDiv({ cls: 'lumina-promptbar-mode-group' });
	const replaceBtn = modeGroup.createEl('button', {
		cls: 'lumina-promptbar-mode-btn',
		text: t('uiMessages.promptBar.modeReplace'),
		attr: { type: 'button' },
	});
	const appendBtn = modeGroup.createEl('button', {
		cls: 'lumina-promptbar-mode-btn',
		text: t('uiMessages.promptBar.modeAppend'),
		attr: { type: 'button' },
	});
	const modelChipEl = controlsRow.createDiv({ cls: 'lumina-promptbar-model-chip' });

	const chipsRowEl = footerEl.createDiv({ cls: 'lumina-promptbar-chips' });

	return {
		dom,
		textareaEl,
		submitBtn,
		replaceBtn,
		appendBtn,
		modelChipEl,
		chipsRowEl,
		errorEl,
		statusEl,
		statusTextEl,
		reviewRowEl,
		rejectBtn,
		acceptBtn,
	};
}

/**
 * 프롬프트 바의 현재 상태와 DOM을 동기화한다.
 * 모델 드롭다운과 퀵 액션 칩은 렌더링 키가 변경될 때만 DOM을 재구성해 타이핑·스트리밍 중 불필요한 재생성을 방지한다.
 */
export function syncPromptBarDom(
	plugin: LuminaPlugin,
	refs: PromptBarDomRefs,
	cache: PromptBarDomCache,
	state: PromptBarInternalState,
	callbacks: PromptBarDomCallbacks,
	autoResizeTextarea: () => void,
): void {
	refs.dom.dataset.phase = state.phase;

	if (refs.textareaEl.value !== state.prompt && document.activeElement !== refs.textareaEl) {
		refs.textareaEl.value = state.prompt;
		autoResizeTextarea();
	}

	const isInput = state.phase === 'input';
	const isGenerating = state.phase === 'generating';
	const isReview = state.phase === 'review';

	const modelInfo = resolvePromptBarModel(plugin);
	const hasInput = refs.textareaEl.value.trim().length > 0;

	refs.textareaEl.disabled = !isInput;
	refs.replaceBtn.disabled = !isInput;
	refs.appendBtn.disabled = !isInput;

	refs.replaceBtn.classList.toggle('is-active', state.mode === 'replace');
	refs.appendBtn.classList.toggle('is-active', state.mode === 'append');

	if (isGenerating) {
		refs.submitBtn.disabled = false;
		refs.submitBtn.classList.add('is-cancel');
		refs.submitBtn.classList.remove('is-ready');
		refs.submitBtn.setAttribute('aria-label', t('uiMessages.promptBar.cancel'));
		if (cache.lastSubmitIconMode !== 'cancel') {
			cache.lastSubmitIconMode = 'cancel';
			refs.submitBtn.empty();
			setIcon(refs.submitBtn, 'lumina-square');
		}
	} else {
		const canRun = isInput && modelInfo.valid && hasInput;
		refs.submitBtn.classList.remove('is-cancel');
		refs.submitBtn.classList.toggle('is-ready', canRun);
		refs.submitBtn.disabled = !canRun;
		refs.submitBtn.setAttribute('aria-label', t('uiMessages.promptBar.run'));
		if (cache.lastSubmitIconMode !== 'send') {
			cache.lastSubmitIconMode = 'send';
			refs.submitBtn.empty();
			setIcon(refs.submitBtn, 'lumina-send');
		}
	}

	// 모델 칩(선택기) 렌더링 — 옵션/유효성 키가 바뀔 때만 DOM 재구성
	const modelRenderKey = modelInfo.valid
		? `valid:${modelInfo.options.map((o) => `${o.value}\0${o.label}`).join('\x01')}`
		: `invalid:${t('uiMessages.promptBar.noModel')}\0${t('uiMessages.promptBar.openSettings')}`;

	if (modelRenderKey !== cache.lastModelRenderKey) {
		cache.lastModelRenderKey = modelRenderKey;
		refs.modelChipEl.empty();

		if (modelInfo.valid) {
			refs.modelChipEl.removeClass('is-warning');
			refs.modelChipEl.createSpan({ cls: 'lumina-promptbar-model-dot' });
			const selectEl = refs.modelChipEl.createEl('select', {
				cls: 'lumina-promptbar-model-select',
			});
			const selectedVal = toProviderModelValue(modelInfo.providerId, modelInfo.modelId);
			for (const opt of modelInfo.options) {
				const optionEl = selectEl.createEl('option', {
					text: opt.label,
					attr: { value: opt.value },
				});
				if (opt.value === selectedVal) {
					optionEl.selected = true;
				}
			}
			selectEl.addEventListener('change', () => {
				const parsed = parseProviderModelValue(selectEl.value);
				if (parsed) {
					callbacks.onModelChange(parsed.providerId, parsed.modelId);
				}
			});
			const chevronEl = refs.modelChipEl.createSpan({ cls: 'lumina-promptbar-model-chevron' });
			setIcon(chevronEl, 'chevron-down');
			cache.modelSelectEl = selectEl;
		} else {
			cache.modelSelectEl = null;
			refs.modelChipEl.addClass('is-warning');
			refs.modelChipEl.createSpan({
				cls: 'lumina-promptbar-model-warn',
				text: t('uiMessages.promptBar.noModel'),
			});
			const settingsBtn = refs.modelChipEl.createEl('button', {
				cls: 'lumina-promptbar-settings-link',
				text: t('uiMessages.promptBar.openSettings'),
				attr: { type: 'button' },
			});
			settingsBtn.addEventListener('click', () => {
				openSettingsTab(plugin.app, plugin.manifest.id);
			});
		}
	}

	if (modelInfo.valid && cache.modelSelectEl) {
		const selectedVal = toProviderModelValue(modelInfo.providerId, modelInfo.modelId);
		if (cache.modelSelectEl.value !== selectedVal) {
			cache.modelSelectEl.value = selectedVal;
		}
		cache.modelSelectEl.disabled = !isInput;
	}

	// 에러 배너
	if (state.errorMessage && isInput) {
		refs.errorEl.setText(state.errorMessage);
		refs.errorEl.setCssStyles({ display: 'block' });
	} else {
		refs.errorEl.setText('');
		refs.errorEl.setCssStyles({ display: 'none' });
	}

	// 생성 중 상태 행
	refs.statusEl.setCssStyles({ display: isGenerating ? 'flex' : 'none' });
	if (isGenerating) {
		refs.statusTextEl.setText(
			state.isThinking ? t('uiMessages.promptBar.thinking') : t('uiMessages.promptBar.generating'),
		);
	}

	// 리뷰 행
	refs.reviewRowEl.setCssStyles({ display: isReview ? 'flex' : 'none' });

	// 퀵 액션 칩 (input 단계에서만 표시, 목록/내용 키가 바뀔 때만 DOM 재구성)
	const quickActions = plugin.settings.chat.quickActions || [];
	const showChips = isInput && quickActions.length > 0;
	refs.chipsRowEl.setCssStyles({ display: showChips ? 'flex' : 'none' });

	if (quickActions.length === 0) {
		if (cache.lastChipsRenderKey !== '') {
			refs.chipsRowEl.empty();
			cache.lastChipsRenderKey = '';
		}
	} else if (showChips) {
		const chipsRenderKey = quickActions
			.map((qa) => `${qa.id}\0${qa.name}\0${qa.prompt}\0${qa.actionType}`)
			.join('\x01');
		if (chipsRenderKey !== cache.lastChipsRenderKey) {
			cache.lastChipsRenderKey = chipsRenderKey;
			refs.chipsRowEl.empty();
			for (const qa of quickActions) {
				const chipBtn = refs.chipsRowEl.createEl('button', {
					cls: `lumina-promptbar-chip ${qa.actionType === 'chat' ? 'is-chat' : ''}`,
					attr: { type: 'button', title: qa.prompt || qa.name },
				});
				if (qa.actionType === 'chat') {
					const chipIcon = chipBtn.createSpan({ cls: 'lumina-promptbar-chip-icon' });
					setIcon(chipIcon, 'message-circle');
				}
				chipBtn.createSpan({ text: qa.name });
				chipBtn.addEventListener('click', () => {
					callbacks.onChipClick(qa);
				});
			}
		}
	}
}
