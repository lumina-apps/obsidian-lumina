import type { EditorView } from '@codemirror/view';
import { Notice } from 'obsidian';
import type LuminaPlugin from '../../../main';
import type { QuickAction } from '../../../shared/types/settings.types';
import { approvalManager } from '../../../core/store/approvalStore';
import { t } from '../../../shared/locales/helpers';
import { aiEditAnnotation, computeScopedMinimalChange } from '../editorAnnotations';
import type { QuickActionStreamProgress } from '../quickActionHandler';
import {
	closePromptBarEffect,
	hasPendingEditForView,
	resolveEditorAndViewForCm,
	resolvePromptBarModel,
	updatePromptBarEffect,
	type PromptBarInternalState,
} from './promptBarState';

export interface PromptBarActionRunnerHost {
	plugin: LuminaPlugin;
	view: EditorView;
	getState: () => PromptBarInternalState | null;
	getPromptValue: () => string;
	onCloseBar: () => void;
	onFocusTextarea: () => void;
}

/**
 * 프롬프트 바의 퀵 액션 실행, 스트리밍 스로틀링 및 인라인 Diff 승인/거절 라이프사이클을 담당한다.
 */
export class PromptBarActionRunner {
	private host: PromptBarActionRunnerHost;
	private streamTimerId: number | null = null;
	private pendingStreamProgress: QuickActionStreamProgress | null = null;
	private lastDispatchedPreview = '';
	private lastDispatchedThinking = false;
	private abortController: AbortController | null = null;
	private returningToInput = false;
	private runToken = 0;
	private destroyed = false;

	constructor(host: PromptBarActionRunnerHost) {
		this.host = host;
	}

	/**
	 * 대기 중인 스트림 타이머를 정리한다.
	 */
	private clearStreamTimer(): void {
		if (this.streamTimerId !== null) {
			window.clearTimeout(this.streamTimerId);
			this.streamTimerId = null;
		}
		this.pendingStreamProgress = null;
	}

	/**
	 * 스로틀링된 스트리밍 진행 상태를 CM6 StateEffect로 반영한다.
	 */
	private flushStreamProgress(progress: QuickActionStreamProgress): void {
		if (this.destroyed) return;
		const current = this.host.getState();
		if (!current || !current.open || current.phase !== 'generating') return;
		if (
			progress.previewText === this.lastDispatchedPreview &&
			progress.isThinking === this.lastDispatchedThinking
		) {
			return;
		}
		this.lastDispatchedPreview = progress.previewText;
		this.lastDispatchedThinking = progress.isThinking;
		this.host.view.dispatch({
			effects: updatePromptBarEffect.of({
				streamingPreview: progress.previewText,
				isThinking: progress.isThinking,
			}),
		});
	}

	/**
	 * 스트림 타이머와 진행 중인 요청의 AbortController를 중단·초기화한다.
	 */
	abortAndCleanup(): void {
		this.clearStreamTimer();
		if (this.abortController && !this.abortController.signal.aborted) {
			this.abortController.abort();
		}
		this.abortController = null;
	}

	/**
	 * 뷰 파기 시 실행 상태를 종료하고 미완성 요청을 중단한다.
	 */
	destroy(): void {
		this.destroyed = true;
		this.abortAndCleanup();
	}

	/**
	 * 생성 단계의 요청을 취소하고 입력 단계로 복귀한다.
	 */
	cancel(): void {
		this.runToken++;
		this.lastDispatchedPreview = '';
		this.lastDispatchedThinking = false;
		this.abortAndCleanup();
		this.host.view.dispatch({
			effects: updatePromptBarEffect.of({
				phase: 'input',
				errorMessage: null,
				approvalRequestId: null,
				streamingPreview: '',
				isThinking: false,
			}),
		});
		this.host.onFocusTextarea();
	}

	/**
	 * 리뷰 단계의 Diff 승인 요청을 수락한다.
	 */
	accept(): void {
		const current = this.host.getState();
		if (!current || current.phase !== 'review' || !current.approvalRequestId) return;
		approvalManager.acceptAll(current.approvalRequestId);
	}

	/**
	 * 리뷰 단계의 Diff를 거절하고 입력 단계로 되돌린다.
	 */
	rejectToInput(): void {
		const current = this.host.getState();
		if (!current || current.phase !== 'review') return;
		if (current.approvalRequestId) {
			this.returningToInput = true;
			approvalManager.rejectAll(current.approvalRequestId);
		} else {
			this.host.view.dispatch({
				effects: updatePromptBarEffect.of({
					phase: 'input',
					approvalRequestId: null,
				}),
			});
		}
		this.host.onFocusTextarea();
	}

	/**
	 * 선택된 퀵 액션 또는 사용자 지시 프롬프트를 실행한다.
	 */
	run(action: QuickAction): void {
		const current = this.host.getState();
		if (!current || !current.open || current.phase !== 'input') return;

		const resolved = resolveEditorAndViewForCm(this.host.plugin, this.host.view);
		if (!resolved) return;

		const docLen = this.host.view.state.doc.length;
		const clampedFrom = Math.max(0, Math.min(current.from, docLen));
		const clampedTo = Math.max(clampedFrom, Math.min(current.to, docLen));
		const targetText = this.host.view.state.doc.sliceString(clampedFrom, clampedTo);
		if (!targetText) {
			this.host.onCloseBar();
			return;
		}

		if (action.actionType === 'chat') {
			// 채팅 전송 칩 클릭 시에는 바를 닫고 채팅 뷰로 전달
			this.host.onCloseBar();
			void this.host.plugin.quickActionHandler.executeAction(
				action,
				resolved.editor,
				resolved.view,
				{
					targetRange: {
						from: clampedFrom,
						to: clampedTo,
						text: targetText,
					},
				},
			);
			return;
		}

		const modelInfo = resolvePromptBarModel(this.host.plugin);
		if (!modelInfo.valid) {
			this.host.view.dispatch({
				effects: updatePromptBarEffect.of({
					errorMessage: t('uiMessages.qaNotConfigured'),
				}),
			});
			return;
		}

		if (hasPendingEditForView(this.host.plugin, this.host.view, resolved.view)) {
			this.host.view.dispatch({
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

		this.host.view.dispatch({
			effects: updatePromptBarEffect.of({
				phase: 'generating',
				prompt: this.host.getPromptValue(),
				errorMessage: null,
				approvalRequestId: null,
				streamingPreview: '',
				isThinking: false,
			}),
		});

		void this.host.plugin.quickActionHandler.executeAction(action, resolved.editor, resolved.view, {
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
				this.host.view.dispatch({
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
				const latest = this.host.getState();
				if (!latest || !latest.open) return false;

				const currentTarget = this.host.view.state.doc.sliceString(latest.from, latest.to);
				if (currentTarget !== ctx.targetText) {
					new Notice(t('uiMessages.promptBar.targetModified'));
					this.host.view.dispatch({ effects: closePromptBarEffect.of(null) });
					return false;
				}

				const minimal = computeScopedMinimalChange(
					ctx.baseDoc,
					ctx.startOffset,
					ctx.endOffset,
					approvalContent,
					latest.from,
				);

				if (minimal?.isFullDoc && this.host.view.state.doc.toString() !== ctx.baseDoc) {
					new Notice(t('uiMessages.promptBar.targetModified'));
					this.host.view.dispatch({ effects: closePromptBarEffect.of(null) });
					return false;
				}

				this.host.view.dispatch({
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
					if (this.host.getState()?.open) {
						this.host.view.dispatch({ effects: closePromptBarEffect.of(null) });
					}
					return;
				}
				if (this.returningToInput) {
					this.returningToInput = false;
					this.host.view.dispatch({
						effects: updatePromptBarEffect.of({
							phase: 'input',
							approvalRequestId: null,
						}),
					});
					this.host.onFocusTextarea();
				} else if (this.host.getState()?.open) {
					// 외부 Diff 배너(Reject All) 또는 타임아웃으로 거절된 경우 바 닫기
					this.host.view.dispatch({ effects: closePromptBarEffect.of(null) });
				}
			},
			onError: (message) => {
				if (this.destroyed || myToken !== this.runToken) return;
				this.clearStreamTimer();
				this.lastDispatchedPreview = '';
				this.lastDispatchedThinking = false;
				this.host.view.dispatch({
					effects: updatePromptBarEffect.of({
						phase: 'input',
						errorMessage: message,
						approvalRequestId: null,
						streamingPreview: '',
						isThinking: false,
					}),
				});
				this.host.onFocusTextarea();
			},
		});
	}
}
