import type { StateField } from '@codemirror/state';
import type { EditorView, TooltipView, ViewUpdate } from '@codemirror/view';
import { Scope } from 'obsidian';
import type LuminaPlugin from '../../../main';
import type { QuickAction } from '../../../shared/types/settings.types';
import {
	closePromptBarEffect,
	sessionPromptBarModeMap,
	sessionPromptBarModelMap,
	updatePromptBarEffect,
	type PromptBarFieldValue,
	type PromptBarInternalState,
	type PromptBarPhase,
} from './promptBarState';
import {
	createPromptBarDom,
	syncPromptBarDom,
	type PromptBarDomCache,
	type PromptBarDomRefs,
} from './promptBarDom';
import { PromptBarActionRunner } from './promptBarActionRunner';

/**
 * CM6 Tooltip으로 렌더링되는 플로팅 즉석 프롬프트 바 뷰 컨트롤러.
 * DOM 생성/동기화, 입력/IME 및 키맵 스코프 라이프사이클을 관리하고 액션 실행은 PromptBarActionRunner에 위임한다.
 */
export class PromptBarTooltipView implements TooltipView {
	dom: HTMLElement;
	private plugin: LuminaPlugin;
	private view: EditorView;
	private field: StateField<PromptBarFieldValue>;
	private refs: PromptBarDomRefs;
	private actionRunner: PromptBarActionRunner;
	private domCache: PromptBarDomCache = {
		lastSubmitIconMode: null,
		lastModelRenderKey: null,
		modelSelectEl: null,
		lastChipsRenderKey: null,
	};

	private keymapScope: Scope | null = null;
	private outsidePointerHandler: ((e: PointerEvent) => void) | null = null;
	private mountTimerId: number | null = null;
	private outsideListenerTimerId: number | null = null;
	private focusTimerId: number | null = null;

	private isComposing = false;
	private destroyed = false;
	private lastPhase: PromptBarPhase | null = null;
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
		this.refs = createPromptBarDom(initialState.prompt);
		this.dom = this.refs.dom;
		this.actionRunner = new PromptBarActionRunner({
			plugin: this.plugin,
			view: this.view,
			getState: () => this.getState(),
			getPromptValue: () => this.refs.textareaEl.value,
			onCloseBar: () => this.closeBar(),
			onFocusTextarea: () => this.scheduleFocus(this.refs.textareaEl),
		});

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
				e.target !== this.refs.rejectBtn
			) {
				this.handledKeyEvents.add(e);
				e.preventDefault();
				this.actionRunner.accept();
			}
		});

		this.refs.textareaEl.addEventListener('compositionstart', () => {
			this.isComposing = true;
		});
		this.refs.textareaEl.addEventListener('compositionend', () => {
			this.isComposing = false;
		});

		this.refs.textareaEl.addEventListener('input', () => {
			this.autoResizeTextarea();
			const current = this.getState();
			if (current?.open) {
				this.view.dispatch({
					effects: updatePromptBarEffect.of({
						prompt: this.refs.textareaEl.value,
						errorMessage: null,
					}),
				});
			}
		});

		this.refs.textareaEl.addEventListener('keydown', (e) => {
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

		this.refs.submitBtn.addEventListener('click', () => {
			const current = this.getState();
			if (current?.phase === 'generating') {
				this.actionRunner.cancel();
			} else {
				this.submitCustomPrompt();
			}
		});

		this.refs.replaceBtn.addEventListener('click', () => {
			this.setMode('replace');
		});
		this.refs.appendBtn.addEventListener('click', () => {
			this.setMode('append');
		});

		this.refs.rejectBtn.addEventListener('click', () => {
			this.actionRunner.rejectToInput();
		});
		this.refs.acceptBtn.addEventListener('click', () => {
			this.actionRunner.accept();
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
			this.refs.textareaEl.focus();
			const len = this.refs.textareaEl.value.length;
			this.refs.textareaEl.setSelectionRange(len, len);
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
		this.actionRunner.destroy();
		if (this.outsidePointerHandler) {
			document.removeEventListener('pointerdown', this.outsidePointerHandler, true);
			this.outsidePointerHandler = null;
		}
		if (this.keymapScope && this.plugin.app?.keymap?.popScope) {
			this.plugin.app.keymap.popScope(this.keymapScope);
			this.keymapScope = null;
		}
	}

	private getState(): PromptBarInternalState | null {
		return this.view.state.field(this.field, false)?.state ?? null;
	}

	private autoResizeTextarea = (): void => {
		this.refs.textareaEl.style.height = 'auto';
		const nextHeight = Math.min(Math.max(this.refs.textareaEl.scrollHeight, 24), 108);
		this.refs.textareaEl.style.height = `${nextHeight}px`;
	};

	private setMode(mode: 'replace' | 'append'): void {
		const current = this.getState();
		if (!current || current.phase !== 'input') return;
		sessionPromptBarModeMap.set(this.plugin, mode);
		this.view.dispatch({
			effects: updatePromptBarEffect.of({ mode }),
		});
		this.refs.textareaEl.focus();
	}

	private closeBar(): void {
		this.actionRunner.abortAndCleanup();
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

	private handleEscape(): void {
		const current = this.getState();
		if (!current || !current.open) return;

		if (current.phase === 'generating') {
			this.actionRunner.cancel();
		} else if (current.phase === 'review') {
			this.actionRunner.rejectToInput();
		} else {
			this.closeBar();
			this.view.focus();
		}
	}

	private submitCustomPrompt(): void {
		const current = this.getState();
		if (!current || !current.open || current.phase !== 'input') return;

		const trimmed = this.refs.textareaEl.value.trim();
		if (!trimmed) return;

		const action: QuickAction = {
			id: '__adhoc__',
			name: trimmed.length > 30 ? `${trimmed.slice(0, 30)}…` : trimmed,
			prompt: trimmed,
			actionType: current.mode,
		};
		this.actionRunner.run(action);
	}

	private syncDOM(state: PromptBarInternalState): void {
		syncPromptBarDom(
			this.plugin,
			this.refs,
			this.domCache,
			state,
			{
				onModelChange: (providerId, modelId) => {
					sessionPromptBarModelMap.set(this.plugin, { providerId, modelId });
					const cur = this.getState();
					if (cur) {
						this.syncDOM(cur);
					}
					this.scheduleFocus(this.refs.textareaEl);
				},
				onChipClick: (qa) => {
					const cur = this.getState();
					if (!cur) return;
					// 채팅 전송 칩은 그대로 유지하고, 편집 칩은 프롬프트 바에서 현재 선택한 모드(바꾸기/아래에 추가)를 따른다
					const effectiveAction: QuickAction =
						qa.actionType === 'chat' ? qa : { ...qa, actionType: cur.mode };
					this.actionRunner.run(effectiveAction);
				},
			},
			this.autoResizeTextarea,
		);

		if (this.lastPhase !== state.phase) {
			this.lastPhase = state.phase;
			if (state.phase === 'review') {
				this.scheduleFocus(this.refs.acceptBtn);
			}
		}
	}
}
