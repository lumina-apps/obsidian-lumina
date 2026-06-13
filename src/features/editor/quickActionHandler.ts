import { Notice, Editor, MarkdownView } from 'obsidian';
import type { MarkdownFileInfo } from 'obsidian';
import type LuminaPlugin from '../../main';
import { createProvider } from '../../core/llm-providers';
import { ChatController } from '../chat/chatController';
import type { QuickAction } from '../../shared/types/settings.types';
import { t } from '../../shared/locales/helpers';
import { debugLogger } from '../../shared/debugLogger';
import type { ChatMessage, TokenUsage } from '../../shared/types/llm.types';

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

		const { connections, chat } = this.plugin.settings;
		const providerId = connections.quickActionProviderId;
		const modelId = connections.quickActionModelId;

		if (!providerId || !modelId) {
			new Notice(t('uiMessages.qaNotConfigured'));
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
			new Notice(t('uiMessages.qaInvalidProvider'));
			return;
		}

		if (action.actionType === 'chat') {
			await this.plugin.activateChatView();
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

			// 1. Assign strict system prompt to force output-only behavior for local/small models
			const sysPrompt = "You are a direct AI assistant. Execute the requested action on the provided text. Output ONLY the final result. Do not output spaces, conversational filler, or markdown blocks unless requested.";

			// 2. Format user prompt with explicit anchors to prevent trailing whitespace hallucinations
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
				messages: llmMessages.map(m => ({ role: m.role, content: m.content as string })) as { role: string; content: string }[],
			});

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

						// 추론형 모델(<think>) 감지 시 스트리밍 강제 중단
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
								editor.replaceRange('', startPos, endPos); // Remove indicator
							}
							const pos = editor.offsetToPos(currentOffset);
							editor.replaceRange(cleanChunk, pos);
							currentOffset += cleanChunk.length;
						}
					}
				);
				tokenUsage = streamRes?.usage;

				// Fallback: If the local server ignores stream: true or fails to yield chunks, 
				// we fall back to a standard chat request to ensure the action completes.
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

					// Remove indicator
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
				// 에디터 상태 원복 (indicator 또는 삽입된 텍스트 제거)
				if (action.actionType === 'replace') {
					editor.undo();
					editor.undo(); // 선택 영역 제거와 indicator 삽입이 2단계일 수 있으므로 안전하게 복구
				} else {
					editor.undo();
				}
				return;
			}

			debugLogger.logError('llm', err as Error);
			new Notice(t('uiMessages.qaError', { msg }));
		}
	}
}
