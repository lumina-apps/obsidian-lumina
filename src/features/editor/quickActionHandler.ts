import { getActiveProject } from "../../core/store/projectStore";
import { approvalManager } from "../../core/store/approvalStore";

import { Notice, Editor, MarkdownView } from 'obsidian';
import type { MarkdownFileInfo } from 'obsidian';
import type LuminaPlugin from '../../main';
import { createProvider } from '../../core/llm-providers';
import { formatLlmError } from '../../shared/utils/llmErrorFormatter';
import { ChatController } from '../chat/chatController';
import type { QuickAction, QuickActionType } from '../../shared/types/settings.types';
import { t } from '../../shared/locales/helpers';
import { debugLogger } from '../../shared/debugLogger';
import { normalizeError } from '../../shared/utils/errorUtils';
import { estimateTokens } from '../../shared/utils/tokenEstimator';
import { getVaultBasePath } from '../../shared/utils/fileUtils';
import { sanitizeDisplayContent } from '../../shared/utils/llmTextSanitizer';
import type { ChatMessage, TokenUsage } from '../../shared/types/llm.types';
import { activateView } from '../../core/views/viewHelper';
import { CHAT_VIEW_TYPE } from '../../shared/constants/viewTypes';

/** 인라인 Diff 승인 대기 최대 시간 (5분) */
const QA_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export interface QuickActionStreamProgress {
	/** 현재 <think> 등 사고 블록 내부를 생성 중인지 여부 */
	isThinking: boolean;
	/** 사고 블록을 제외한 현재까지의 본문 누적 텍스트 */
	previewText: string;
}

/**
 * 퀵 액션 및 즉석 프롬프트 실행 시 호출자가 제어·구독할 수 있는 선택 옵션.
 */
export interface QuickActionExecuteOptions {
	/** LLM 생성 및 승인 대기 중단용 AbortSignal */
	signal?: AbortSignal;
	/** 호출자가 명시적으로 지정한 프로바이더 ID (프롬프트 바 모델 선택기 등) */
	providerId?: string;
	/** 호출자가 명시적으로 지정한 모델 ID */
	modelId?: string;
	/** 명시적 대상 범위 (프롬프트 바 등에서 선택 해제 시에도 대상 텍스트·오프셋 유지용) */
	targetRange?: {
		from: number;
		to: number;
		text: string;
	};
	/** 스트리밍 중 진행 상태(사고 여부 및 누적 본문) 전달 콜백 */
	onStreamProgress?: (progress: QuickActionStreamProgress) => void;
	/** 승인 큐에 요청이 등록될 때 요청 ID를 전달받는 콜백 */
	onApprovalQueued?: (requestId: string) => void;
	/** Diff 승인 완료 시 커스텀 적용 콜백 (적용 성공 시 true 반환) */
	applyApprovedContent?: (
		approvalContent: string,
		context: {
			baseDoc: string;
			startOffset: number;
			endOffset: number;
			targetText: string;
		},
	) => boolean;
	/** 승인 대기 종료 시 결과(승인 적용 여부) 알림 콜백 */
	onApprovalResult?: (approved: boolean) => void;
	/** LLM 생성 단계 종료 콜백 */
	onGenerationFinished?: () => void;
	/** 오류 발생 시 커스텀 핸들러 (미지정 시 Notice 표시) */
	onError?: (message: string) => void;
	/** 진행·완료 Notice 표시 억제 여부 */
	suppressNotices?: boolean;
}

function isAbortError(err: unknown, signal?: AbortSignal): boolean {
	if (signal?.aborted) return true;
	return err instanceof Error && err.name === 'AbortError';
}

const REASONING_TAGS = ['think', 'thinking', 'thought', 'reasoning'] as const;

/**
 * LLM 응답에서 <think>/<thinking>/<thought>/<reasoning> 등 사고 과정 블록과
 * 특수 토큰을 제거하고 실제 본문 텍스트만 반환한다.
 */
export function cleanQuickActionOutput(raw: string): string {
	if (!raw) return '';
	let text = raw
		.replace(/&lt;think&gt;/gi, '<think>')
		.replace(/&lt;\/think&gt;/gi, '</think>');
	const thinkEndIdx = text.toLowerCase().lastIndexOf('</think>');
	if (thinkEndIdx !== -1) {
		text = text.slice(thinkEndIdx + '</think>'.length);
	}
	return sanitizeDisplayContent(text);
}

/**
 * 스트리밍 중인 누적 응답에서 현재 사고 블록 내부 여부와 본문 프리뷰 텍스트를 추출한다.
 */
export function extractStreamingProgress(raw: string): QuickActionStreamProgress {
	if (!raw) {
		return { isThinking: false, previewText: '' };
	}

	const normalized = raw
		.replace(/&lt;think&gt;/gi, '<think>')
		.replace(/&lt;\/think&gt;/gi, '</think>');
	const lower = normalized.toLowerCase();

	// 스트리밍 극초반에 "<thi..." 형태로 여는 태그가 아직 완성되지 않은 경우 깜빡임 방지
	const trimmedStart = lower.trimStart();
	if (trimmedStart.startsWith('<') && !trimmedStart.includes('>') && trimmedStart.length < 16) {
		const couldBeReasoningTag = REASONING_TAGS.some((tag) => `<${tag}>`.startsWith(trimmedStart));
		if (couldBeReasoningTag) {
			return { isThinking: true, previewText: '' };
		}
	}

	let isThinking = false;
	for (const tag of REASONING_TAGS) {
		const lastOpen = lower.lastIndexOf(`<${tag}>`);
		const lastClose = lower.lastIndexOf(`</${tag}>`);
		if (lastOpen !== -1 && lastOpen > lastClose) {
			isThinking = true;
			break;
		}
	}

	return {
		isThinking,
		previewText: cleanQuickActionOutput(normalized),
	};
}

/**
 * append 액션 시 선택 범위 끝(개행·줄 중간 포함)을 대상 마지막 줄 끝으로 정렬하고
 * 불필요한 중복 빈 줄 없이 단일 줄바꿈으로 결과를 삽입한 문서를 생성한다.
 */
export function buildAppendProposedDoc(
	baseDoc: string,
	startOffset: number,
	endOffset: number,
	resultText: string,
): string {
	const cleanResult = resultText.replace(/^(?:\r?\n)+/, '').replace(/(?:\r?\n)+$/, '');
	let effectiveEnd = Math.max(startOffset, Math.min(endOffset, baseDoc.length));
	while (
		effectiveEnd > startOffset &&
		(baseDoc[effectiveEnd - 1] === '\n' || baseDoc[effectiveEnd - 1] === '\r')
	) {
		effectiveEnd--;
	}
	const nextNl = baseDoc.indexOf('\n', effectiveEnd);
	let appendOffset = nextNl === -1 ? baseDoc.length : nextNl;
	if (appendOffset > 0 && baseDoc[appendOffset - 1] === '\r') {
		appendOffset--;
	}
	return baseDoc.slice(0, appendOffset) + `\n${cleanResult}` + baseDoc.slice(appendOffset);
}

export class QuickActionHandler {
	private plugin: LuminaPlugin;

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
	}

	/**
	 * 일회성 즉석 프롬프트를 임시 QuickAction으로 감싸 기존 실행 파이프라인을 통해 실행한다.
	 */
	async executeCustomPrompt(
		prompt: string,
		actionType: QuickActionType,
		editor: Editor,
		view: MarkdownView | MarkdownFileInfo,
		options?: QuickActionExecuteOptions,
	): Promise<void> {
		const trimmed = prompt.trim();
		if (!trimmed && actionType !== 'chat') {
			return;
		}
		const adhocAction: QuickAction = {
			id: '__adhoc__',
			name: trimmed.length > 30 ? `${trimmed.slice(0, 30)}…` : (trimmed || 'Prompt'),
			prompt: trimmed,
			actionType,
		};
		await this.executeAction(adhocAction, editor, view, options);
	}

	async executeAction(
		action: QuickAction,
		editor: Editor,
		view: MarkdownView | MarkdownFileInfo,
		options?: QuickActionExecuteOptions,
	) {
		if (options?.signal?.aborted) {
			return;
		}

		const explicitTarget = options?.targetRange;
		const selection = explicitTarget ? explicitTarget.text : editor.getSelection();
		if (!selection) {
			if (!options?.suppressNotices) {
				new Notice(t('uiMessages.qaEmptySel'));
			}
			return;
		}

		// 비동기 작업 전 초기 커서 및 선택 영역 위치 캡처 (레이스 컨디션 방지)
		const initialFrom = explicitTarget && typeof editor.offsetToPos === 'function'
			? editor.offsetToPos(explicitTarget.from)
			: editor.getCursor('from');
		const initialTo = explicitTarget && typeof editor.offsetToPos === 'function'
			? editor.offsetToPos(explicitTarget.to)
			: editor.getCursor('to');

		const { connections, chat } = this.plugin.settings;
		
		let providerId = '';
		let modelId = '';

		const isValidVerifiedPair = (pid?: string, mid?: string): pid is string => {
			if (!pid || !mid) return false;
			const p = connections.providers.find(prov => prov.id === pid);
			return Boolean(p && p.isVerified);
		};

		if (options?.providerId && options?.modelId) {
			if (!isValidVerifiedPair(options.providerId, options.modelId)) {
				const invalidMsg = t('uiMessages.qaInvalidProvider');
				if (options.onError) {
					options.onError(invalidMsg);
				} else {
					new Notice(invalidMsg);
				}
				return;
			}
			providerId = options.providerId;
			modelId = options.modelId;
		} else if (action.actionType === 'chat') {
			// chat 액션은 채팅창으로 전송되므로 활성 프로젝트 기본 모델 → 검증된 첫 모델 순으로 폴백 허용
			const activeProject = getActiveProject();
			if (isValidVerifiedPair(activeProject.defaultProviderId, activeProject.defaultModelId)) {
				providerId = activeProject.defaultProviderId!;
				modelId = activeProject.defaultModelId!;
			}
			if (!providerId || !modelId) {
				const verified = connections.providers.filter(p => p.isVerified && p.availableModels.length > 0);
				if (verified.length > 0) {
					providerId = verified[0].id;
					modelId = verified[0].availableModels[0];
				}
			}
		} else {
			// replace / append 인라인 퀵 액션은 속도·비용 최적화를 위해 전용 퀵 액션 모델 지정 필수 (/ai 서제스트와 정책 통일)
			if (connections.quickActionProviderId && connections.quickActionModelId) {
				const configuredProvider = connections.providers.find(p => p.id === connections.quickActionProviderId);
				if (!configuredProvider || !configuredProvider.isVerified) {
					new Notice(t('uiMessages.qaInvalidProvider'));
					return;
				}
				providerId = connections.quickActionProviderId;
				modelId = connections.quickActionModelId;
			}
		}

		if (!providerId || !modelId) {
			if (options?.onError) {
				options.onError(action.actionType === 'chat' ? t('settings.translation.noValidModel') : t('uiMessages.qaNotConfigured'));
				return;
			}
			new Notice(action.actionType === 'chat' ? t('settings.translation.noValidModel') : t('uiMessages.qaNotConfigured'));
			const appWithSetting = this.plugin.app as unknown as {
				setting?: {
					open(): void;
					openTabById(id: string): void;
				};
			};
			appWithSetting.setting?.open();
			appWithSetting.setting?.openTabById(this.plugin.manifest.id);
			return;
		}

		const providerConfig = connections.providers.find(p => p.id === providerId);
		if (!providerConfig || !providerConfig.isVerified) {
			const invalidMsg = action.actionType === 'chat' ? t('settings.translation.noValidModel') : t('uiMessages.qaInvalidProvider');
			if (options?.onError) {
				options.onError(invalidMsg);
				return;
			}
			new Notice(invalidMsg);
			return;
		}

		if (action.actionType === 'chat') {
			await activateView(this.plugin.app.workspace, CHAT_VIEW_TYPE);
			const controller = new ChatController(this.plugin);
			try {
				// 채팅 전송 (채팅창 이력에 남김)
				await controller.sendMessage(
					action.prompt,
					[{ type: 'selection', path: `selection-${Date.now()}`, name: t('uiMessages.qaSelectedText'), content: selection }],
					providerId,
					modelId,
					{ useRagContext: false }
				);
			} finally {
				controller.destroy();
			}
			return;
		}

		// replace 또는 append 동작: 응답 생성 후 인라인 Diff 승인을 거쳐 반영
		const activeFile = (view as MarkdownView)?.file ?? this.plugin.app.workspace.getActiveFile?.() ?? null;
		const canUseDiff = Boolean(
			activeFile?.path &&
			typeof editor.getValue === 'function' &&
			typeof editor.setValue === 'function' &&
			typeof editor.posToOffset === 'function'
		);
		const baseDoc = canUseDiff ? editor.getValue() : '';
		const startOffset = explicitTarget
			? explicitTarget.from
			: (canUseDiff ? editor.posToOffset(initialFrom) : 0);
		const endOffset = explicitTarget
			? explicitTarget.to
			: (canUseDiff ? editor.posToOffset(initialTo) : 0);

		if (!options?.suppressNotices) {
			new Notice(t('uiMessages.qaExecuting', { name: action.name }));
		}

		let llmStart = Date.now();
		let requestId = '';
		let tokenUsage: TokenUsage | undefined;
		let fullResponse = '';
		let finishReason: string | undefined;

		try {
			const provider = createProvider(providerConfig);

			// 로컬/소형 모델용 엄격한 시스템 프롬프트
			const sysPrompt = "You are a direct AI assistant. Execute the requested action on the provided text. Output ONLY the final result. Do not output spaces, conversational filler, or markdown blocks unless requested.";

			// 명시적 앵커로 후행 공백 환각 방지
			const userPrompt = action.prompt
				? `Task: ${action.prompt}\n\nInput Text:\n${selection.trim()}\n\nOutput:\n`
				: selection.trim();

			const llmMessages: ChatMessage[] = [
				{ role: 'system', content: sysPrompt },
				{ role: 'user', content: userPrompt }
			];

			llmStart = Date.now();

			const estimatedInputTokens = llmMessages.reduce((acc, m) => {
				const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
				return acc + estimateTokens(c);
			}, 0);

			requestId = debugLogger.logRequest({
				provider: providerConfig.type,
				model: modelId,
				temperature: chat.temperature,
				maxTokens: chat.maxOutputTokens,
				stream: chat.streaming,
				systemPrompt: sysPrompt,
				messages: llmMessages.map(m => ({ role: m.role, content: m.content as string })),
				estimatedInputTokens,
			});

			const vaultCwd = getVaultBasePath(this.plugin.app);
			const qaChatOptions = {
				model: modelId,
				temperature: chat.temperature,
				maxOutputTokens: chat.maxOutputTokens || undefined,
				...(vaultCwd ? { cwd: vaultCwd } : {}),
				...(options?.signal ? { signal: options.signal } : {}),
			};

			if (chat.streaming) {
				let chunkCount = 0;
				const streamRes = await provider.stream(
					llmMessages,
					qaChatOptions,
					(chunk) => {
						if (options?.signal?.aborted) {
							const abortErr = new Error('Aborted');
							abortErr.name = 'AbortError';
							throw abortErr;
						}
						if (!chunk) return;
						fullResponse += chunk;

						if (options?.onStreamProgress) {
							options.onStreamProgress(extractStreamingProgress(fullResponse));
						}

						if (chunk.replace(/\r/g, '')) {
							chunkCount++;
						}
					}
				);
				tokenUsage = streamRes?.usage;
				finishReason = streamRes?.finishReason;

				// 스트리밍 청크가 없으면 일반 chat 요청으로 폴백
				if (chunkCount === 0 && !options?.signal?.aborted) {
					const response = await provider.chat(llmMessages, qaChatOptions);
					fullResponse = response.content;
					tokenUsage = response?.usage;
					finishReason = response?.finishReason;
				}
			} else {
				const response = await provider.chat(llmMessages, qaChatOptions);
				fullResponse = response.content;
				tokenUsage = response?.usage;
				finishReason = response?.finishReason;
			}

			if (options?.signal?.aborted) {
				debugLogger.logResponse(requestId, {
					model: modelId,
					content: fullResponse,
					durationMs: Date.now() - llmStart,
					usage: tokenUsage,
					stopReason: 'aborted',
				});
				options?.onGenerationFinished?.();
				return;
			}

			debugLogger.logResponse(requestId, {
				model: modelId,
				content: fullResponse,
				durationMs: Date.now() - llmStart,
				usage: tokenUsage,
				...(finishReason ? { stopReason: finishReason } : {}),
			});

			options?.onGenerationFinished?.();

			const resultText = cleanQuickActionOutput(fullResponse);
			if (!resultText || resultText.trim() === '') {
				const isLengthStop = finishReason === 'length' || finishReason === 'max_tokens';
				const emptyMsg = isLengthStop
					? t('uiMessages.emptyResponseTokenLimit')
					: t('uiMessages.qaEmptyResponse');
				if (options?.onError) {
					options.onError(emptyMsg);
				} else if (!options?.suppressNotices) {
					new Notice(emptyMsg);
				}
				return;
			}

			if (canUseDiff && activeFile) {
				const proposedDoc = action.actionType === 'replace'
					? baseDoc.slice(0, startOffset) + resultText + baseDoc.slice(endOffset)
					: buildAppendProposedDoc(baseDoc, startOffset, endOffset, resultText);

				const approval = await approvalManager.requestApproval(
					activeFile.path,
					baseDoc,
					proposedDoc,
					{
						timeoutMs: QA_APPROVAL_TIMEOUT_MS,
						...(options?.signal ? { signal: options.signal } : {}),
						...(options?.onApprovalQueued ? { onQueued: options.onApprovalQueued } : {}),
					},
				);

				if (!approval.approved) {
					options?.onApprovalResult?.(false);
					return;
				}

				if (options?.applyApprovedContent) {
					const applied = options.applyApprovedContent(approval.content, {
						baseDoc,
						startOffset,
						endOffset,
						targetText: selection,
					});
					options?.onApprovalResult?.(applied);
					if (applied && !options.suppressNotices) {
						new Notice(t('uiMessages.qaCompleted', { name: action.name }));
					}
					return;
				}

				if (editor.getValue() !== baseDoc) {
					// 승인 대기 중 사용자가 문서를 직접 수정한 경우 덮어쓰기 방지
					new Notice(t('uiMessages.qaError', { msg: 'Document was modified while waiting for approval.' }));
					return;
				}

				editor.setValue(approval.content);
				if (!options?.suppressNotices) {
					new Notice(t('uiMessages.qaCompleted', { name: action.name }));
				}
				return;
			}

			// 파일 정보가 없는 특수 에디터 폴백
			if (action.actionType === 'replace') {
				editor.replaceRange(resultText, initialFrom, initialTo);
			} else if (action.actionType === 'append') {
				const cleanResult = resultText.replace(/^(?:\r?\n)+/, '').replace(/(?:\r?\n)+$/, '');
				const hasGetLine = typeof editor.getLine === 'function';
				const lineText = hasGetLine ? editor.getLine(initialTo.line) : '';
				const lineEndPos = hasGetLine ? { line: initialTo.line, ch: lineText.length } : initialTo;
				editor.replaceRange(`\n${cleanResult}`, lineEndPos);
			}

			options?.onApprovalResult?.(true);
			if (!options?.suppressNotices) {
				new Notice(t('uiMessages.qaCompleted', { name: action.name }));
			}
		} catch (err: unknown) {
			options?.onGenerationFinished?.();

			if (isAbortError(err, options?.signal)) {
				if (requestId) {
					debugLogger.logResponse(requestId, {
						model: modelId,
						content: fullResponse || '⏹ [Aborted]',
						durationMs: Date.now() - llmStart,
						usage: tokenUsage,
						stopReason: 'aborted',
					});
				}
				return;
			}

			const msg = err instanceof Error ? err.message : t('uiMessages.qaUnknownError');
			if (requestId) {
				debugLogger.logResponse(requestId, {
					model: modelId,
					content: fullResponse || `❌ [Error] ${msg}`,
					durationMs: Date.now() - llmStart,
					usage: tokenUsage,
					stopReason: 'error',
				});
			}

			debugLogger.logError('llm', normalizeError(err));
			const errorNotice = t('uiMessages.qaError', { msg: formatLlmError(err) });
			if (options?.onError) {
				options.onError(errorNotice);
			} else {
				new Notice(errorNotice);
			}
		}
	}
}