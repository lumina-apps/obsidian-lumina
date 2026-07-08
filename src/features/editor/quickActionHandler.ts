import { getActiveProject } from "../../core/store/projectStore";

import { Notice, Editor, MarkdownView } from 'obsidian';
import type { MarkdownFileInfo } from 'obsidian';
import type LuminaPlugin from '../../main';
import { createProvider } from '../../core/llm-providers';
import { formatLlmError } from '../../shared/utils/llmErrorFormatter';
import { ChatController } from '../chat/chatController';
import type { QuickAction } from '../../shared/types/settings.types';
import { t } from '../../shared/locales/helpers';
import { debugLogger } from '../../shared/debugLogger';
import type { ChatMessage, TokenUsage } from '../../shared/types/llm.types';
import { activateView } from '../../core/views/viewHelper';
import { CHAT_VIEW_TYPE } from '../chat/chatView';

export class QuickActionHandler {
	private plugin: LuminaPlugin;

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
	}

	async executeAction(action: QuickAction, editor: Editor, _view: MarkdownView | MarkdownFileInfo) {
		const selection = editor.getSelection();
		if (!selection) {
			new Notice(t('uiMessages.qaEmptySel'));
			return;
		}

		const { connections, chat } = this.plugin.settings;
		
		let providerId = connections.quickActionProviderId;
		let modelId = connections.quickActionModelId;

		if (action.actionType === 'chat') {
			const activeProject = getActiveProject();
			providerId = activeProject.defaultProviderId || providerId;
			modelId = activeProject.defaultModelId || modelId;

			if (!providerId || !modelId) {
				const verified = connections.providers.filter(p => p.isVerified);
				if (verified.length > 0 && verified[0].availableModels.length > 0) {
					providerId = verified[0].id;
					modelId = verified[0].availableModels[0];
				}
			}
		}

		if (!providerId || !modelId) {
			new Notice(action.actionType === 'chat' ? t('settings.translation.noValidModel') : t('uiMessages.qaNotConfigured'));
			const appWithSetting = this.plugin.app as unknown as {
				setting: {
					open(): void;
					openTabById(id: string): void;
				};
			};
			appWithSetting.setting.open();
			appWithSetting.setting.openTabById(this.plugin.manifest.id);
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
			// 채팅 전송 (채팅창 이력에 남김)
			await controller.sendMessage(
				action.prompt,
				[{ type: 'selection', path: `selection-${Date.now()}`, name: t('uiMessages.qaSelectedText'), content: selection }],
				providerId,
				modelId,
				{ useRagContext: false }
			);
			return;
		}

		// replace 또는 append 동작: 에디터 텍스트 수정 및 로딩 표시
		new Notice(t('uiMessages.qaExecuting', { name: action.name }));
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

			const llmStart = Date.now();
			let tokenUsage: TokenUsage | undefined;
			let fullResponse = '';

			const requestId = debugLogger.logRequest({
				provider: providerConfig.type,
				model: modelId,
				temperature: chat.temperature,
				maxTokens: chat.maxOutputTokens,
				stream: chat.streaming,
				systemPrompt: sysPrompt,
				messages: llmMessages.map(m => ({ role: m.role, content: m.content as string })),
			});

			// 스트리밍 응답 중 로딩 표시
			const indicatorText = t('uiMessages.qaWaitingAI');
			let isFirstChunk = true;

			if (chat.streaming) {
				let currentOffset: number;
				if (action.actionType === 'replace') {
					const from = editor.getCursor('from');
					const to = editor.getCursor('to');
					editor.replaceRange(indicatorText, from, to);
					currentOffset = editor.posToOffset(from);
				} else { // append
					const to = editor.getCursor('to');
					editor.replaceRange(`\n\n${indicatorText}`, to);
					currentOffset = editor.posToOffset(to) + 2;
				}

				let chunkCount = 0;
				// 청크 단위로 UI에 점진적 출력
				const streamRes = await provider.stream(
					llmMessages,
					{
						model: modelId,
						temperature: chat.temperature,
						maxOutputTokens: chat.maxOutputTokens || undefined
					},
					(chunk) => {
						if (!chunk) return;
						fullResponse += chunk;

						// <think> 태그 감지 시 중단 (추론형 모델)
						if (fullResponse.includes('<think>') || fullResponse.includes('&lt;think&gt;')) {
							throw new Error('REASONING_DETECTED');
						}

						const cleanChunk = chunk.replace(/\r/g, '');
						if (cleanChunk) {
							chunkCount++;
							if (isFirstChunk) {
								isFirstChunk = false;
								const startPos = editor.offsetToPos(currentOffset);
								const endPos = editor.offsetToPos(currentOffset + indicatorText.length);
								editor.replaceRange('', startPos, endPos); // 인디케이터 제거
							}
							const pos = editor.offsetToPos(currentOffset);
							editor.replaceRange(cleanChunk, pos);
							currentOffset += cleanChunk.length;
						}
					}
				);
				tokenUsage = streamRes?.usage;

				// 스트리밍 청크가 없으면 일반 chat 요청으로 폴백
				if (chunkCount === 0) {
					const response = await provider.chat(
						llmMessages,
						{
							model: modelId,
							temperature: chat.temperature,
							maxOutputTokens: chat.maxOutputTokens || undefined
						}
					);
					const resultText = response.content;
					fullResponse = resultText;
					tokenUsage = response?.usage;

					if (fullResponse.includes('<think>') || fullResponse.includes('&lt;think&gt;')) {
						throw new Error('REASONING_DETECTED');
					}

					// 인디케이터 제거
					const startPos = editor.offsetToPos(currentOffset);
					const endPos = editor.offsetToPos(currentOffset + indicatorText.length);
					editor.replaceRange('', startPos, endPos);

					if (resultText && resultText.trim() !== '') {
						const pos = editor.offsetToPos(currentOffset);
						editor.replaceRange(resultText, pos);
					} else {
						new Notice(t('uiMessages.qaEmptyResponse'));
					}
				}

			} else {
				const response = await provider.chat(
					llmMessages,
					{
						model: modelId,
						temperature: chat.temperature,
						maxOutputTokens: chat.maxOutputTokens || undefined
					}
				);

				const resultText = response.content;
				fullResponse = resultText;
				tokenUsage = response?.usage;

				if (fullResponse.includes('<think>') || fullResponse.includes('&lt;think&gt;')) {
					throw new Error('REASONING_DETECTED');
				}

				if (action.actionType === 'replace') {
					const from = editor.getCursor('from');
					const to = editor.getCursor('to');
					editor.replaceRange(resultText, from, to);
				} else if (action.actionType === 'append') {
					const to = editor.getCursor('to');
					editor.replaceRange(`\n\n${resultText}`, to);
				}
			}

			debugLogger.logResponse(requestId, {
				model: modelId,
				content: fullResponse,
				durationMs: Date.now() - llmStart,
				usage: tokenUsage,
			});

			new Notice(t('uiMessages.qaCompleted', { name: action.name }));
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : t('uiMessages.qaUnknownError');
			if (msg === 'REASONING_DETECTED') {
				new Notice(t('uiMessages.qaReasoningDetected'), 10000);
				// 에디터 상태 복구
				if (action.actionType === 'replace') {
					editor.undo();
					editor.undo(); // 선택 영역 제거와 indicator 삽입이 2단계일 수 있으므로 안전하게 복구
				} else {
					editor.undo();
				}
				return;
			}

			debugLogger.logError('llm', err as Error);
			new Notice(t('uiMessages.qaError', { msg: formatLlmError(err) }));
		}
	}
}