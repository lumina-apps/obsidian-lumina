import { getActiveProject } from "../../core/store/projectStore";
import { approvalManager } from "../../core/store/approvalStore";

import { Notice, Editor, MarkdownView } from 'obsidian';
import type { MarkdownFileInfo } from 'obsidian';
import type LuminaPlugin from '../../main';
import { createProvider } from '../../core/llm-providers';
import { formatLlmError } from '../../shared/utils/llmErrorFormatter';
import { ChatController } from '../chat/chatController';
import type { QuickAction } from '../../shared/types/settings.types';
import { t } from '../../shared/locales/helpers';
import { debugLogger } from '../../shared/debugLogger';
import { normalizeError } from '../../shared/utils/errorUtils';
import { estimateTokens } from '../../shared/utils/tokenEstimator';
import { getVaultBasePath } from '../../shared/utils/fileUtils';
import type { ChatMessage, TokenUsage } from '../../shared/types/llm.types';
import { activateView } from '../../core/views/viewHelper';
import { CHAT_VIEW_TYPE } from '../../shared/constants/viewTypes';

/** 인라인 Diff 승인 대기 최대 시간 (5분) */
const QA_APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export class QuickActionHandler {
	private plugin: LuminaPlugin;

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
	}

	async executeAction(action: QuickAction, editor: Editor, view: MarkdownView | MarkdownFileInfo) {
		const selection = editor.getSelection();
		if (!selection) {
			new Notice(t('uiMessages.qaEmptySel'));
			return;
		}

		// 비동기 작업 전 초기 커서 및 선택 영역 위치 캡처 (레이스 컨디션 방지)
		const initialFrom = editor.getCursor('from');
		const initialTo = editor.getCursor('to');

		const { connections, chat } = this.plugin.settings;
		
		let providerId = '';
		let modelId = '';

		const isValidVerifiedPair = (pid?: string, mid?: string): pid is string => {
			if (!pid || !mid) return false;
			const p = connections.providers.find(prov => prov.id === pid);
			return Boolean(p && p.isVerified);
		};

		if (action.actionType === 'chat') {
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
			new Notice(action.actionType === 'chat' ? t('settings.translation.noValidModel') : t('uiMessages.qaInvalidProvider'));
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
		const startOffset = canUseDiff ? editor.posToOffset(initialFrom) : 0;
		const endOffset = canUseDiff ? editor.posToOffset(initialTo) : 0;

		new Notice(t('uiMessages.qaExecuting', { name: action.name }));

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
			};

			if (chat.streaming) {
				let chunkCount = 0;
				const streamRes = await provider.stream(
					llmMessages,
					qaChatOptions,
					(chunk) => {
						if (!chunk) return;
						fullResponse += chunk;

						// <think> 태그 감지 시 중단 (추론형 모델)
						if (fullResponse.includes('<think>') || fullResponse.includes('&lt;think&gt;')) {
							throw new Error('REASONING_DETECTED');
						}

						if (chunk.replace(/\r/g, '')) {
							chunkCount++;
						}
					}
				);
				tokenUsage = streamRes?.usage;
				finishReason = streamRes?.finishReason;

				// 스트리밍 청크가 없으면 일반 chat 요청으로 폴백
				if (chunkCount === 0) {
					const response = await provider.chat(llmMessages, qaChatOptions);
					fullResponse = response.content;
					tokenUsage = response?.usage;
					finishReason = response?.finishReason;

					if (fullResponse.includes('<think>') || fullResponse.includes('&lt;think&gt;')) {
						throw new Error('REASONING_DETECTED');
					}
				}
			} else {
				const response = await provider.chat(llmMessages, qaChatOptions);
				fullResponse = response.content;
				tokenUsage = response?.usage;
				finishReason = response?.finishReason;

				if (fullResponse.includes('<think>') || fullResponse.includes('&lt;think&gt;')) {
					throw new Error('REASONING_DETECTED');
				}
			}

			debugLogger.logResponse(requestId, {
				model: modelId,
				content: fullResponse,
				durationMs: Date.now() - llmStart,
				usage: tokenUsage,
				...(finishReason ? { stopReason: finishReason } : {}),
			});

			const resultText = fullResponse;
			if (!resultText || resultText.trim() === '') {
				new Notice(t('uiMessages.qaEmptyResponse'));
				return;
			}

			if (canUseDiff && activeFile) {
				const proposedDoc = action.actionType === 'replace'
					? baseDoc.slice(0, startOffset) + resultText + baseDoc.slice(endOffset)
					: baseDoc.slice(0, endOffset) + `\n\n${resultText}` + baseDoc.slice(endOffset);

				const approval = await approvalManager.requestApproval(
					activeFile.path,
					baseDoc,
					proposedDoc,
					{ timeoutMs: QA_APPROVAL_TIMEOUT_MS },
				);

				if (!approval.approved) {
					return;
				}

				if (editor.getValue() !== baseDoc) {
					// 승인 대기 중 사용자가 문서를 직접 수정한 경우 덮어쓰기 방지
					new Notice(t('uiMessages.qaError', { msg: 'Document was modified while waiting for approval.' }));
					return;
				}

				editor.setValue(approval.content);
				new Notice(t('uiMessages.qaCompleted', { name: action.name }));
				return;
			}

			// 파일 정보가 없는 특수 에디터 폴백
			if (action.actionType === 'replace') {
				editor.replaceRange(resultText, initialFrom, initialTo);
			} else if (action.actionType === 'append') {
				editor.replaceRange(`\n\n${resultText}`, initialTo);
			}

			new Notice(t('uiMessages.qaCompleted', { name: action.name }));
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : t('uiMessages.qaUnknownError');
			if (requestId) {
				debugLogger.logResponse(requestId, {
					model: modelId,
					content: fullResponse || `❌ [Error] ${msg}`,
					durationMs: Date.now() - llmStart,
					usage: tokenUsage,
					stopReason: msg === 'REASONING_DETECTED' ? 'reasoning_detected' : 'error',
				});
			}
			if (msg === 'REASONING_DETECTED') {
				new Notice(t('uiMessages.qaReasoningDetected'), 10000);
				return;
			}

			debugLogger.logError('llm', normalizeError(err));
			new Notice(t('uiMessages.qaError', { msg: formatLlmError(err) }));
		}
	}
}