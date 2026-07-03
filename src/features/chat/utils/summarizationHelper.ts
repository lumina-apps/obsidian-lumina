import type LuminaPlugin from '../../../main';
import { get } from 'svelte/store';
import { messages, sessionSummary, summaryUpToMessageId, currentSessionId, currentSessionTitle } from '../../../core/store/chatStore';
import { createProvider } from '../../../core/llm-providers';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import type { ChatMessage, ChatOptions } from '../../../shared/types/llm.types';

import { debugLogger } from '../../../shared/debugLogger';
import { saveSession } from '../history';
import type { ChatSession } from '../../../shared/types/chat.types';
import { t } from '../../../shared/locales/helpers';

/**
 * 대화가 특정 턴 수를 초과하면 가장 최근 2턴을 제외한 나머지 이전 대화를 백그라운드에서 요약합니다.
 */
export async function triggerAutoSummarization(
	plugin: LuminaPlugin,
	providerConfig: LLMProviderConfig,
	modelId: string,
	contextWindowTurns: number
): Promise<void> {
	const msgs = get(messages);
	const currentSummary = get(sessionSummary);
	const upToId = get(summaryUpToMessageId);

	// 요약 안 된 부분의 시작점 찾기
	let startIndex = 0;
	if (upToId) {
		const idx = msgs.findIndex(m => m.id === upToId);
		if (idx !== -1) {
			startIndex = idx + 1;
		}
	}

	// 시스템 메시지를 제외한 실제 대화 턴(user, assistant) 필터링
	const unsummarized = msgs.slice(startIndex).filter(m => m.role !== 'system');

	// 사용자가 설정한 contextWindowTurns (기본 10)의 2배 = 20개 메시지가 되면 요약 발동
	const thresholdMessages = contextWindowTurns * 2;
	if (unsummarized.length < thresholdMessages) {
		return;
	}

	// 최신 2턴(4개 메시지)는 원문으로 유지하기 위해 남겨둠
	const targetCount = unsummarized.length - 4;
	if (targetCount <= 0) return;

	const targetMessagesToSummarize = unsummarized.slice(0, targetCount);
	const newUpToId = targetMessagesToSummarize[targetMessagesToSummarize.length - 1].id;

	// 프롬프트 구성
	let prompt = t('summarization.prompt.intro') || `다음은 사용자와 AI 간의 채팅 기록입니다.\n\n`;
	
	if (currentSummary) {
		prompt += (t('summarization.prompt.previousSummary') || `[이전 대화 요약]\n`) + `${currentSummary}\n\n`;
		prompt += (t('summarization.prompt.instructionWithSummary') || `위의 이전 대화 요약에 이어서, 아래의 추가 대화를 포함하여 전체 대화의 핵심 내용, 문맥, 사용자의 목적 등을 종합적으로 요약해 주세요. 요약은 다른 AI가 읽었을 때 이전 대화 흐름을 완벽히 이해할 수 있도록 명확하게 작성해야 합니다.\n\n`);
	} else {
		prompt += (t('summarization.prompt.instructionWithoutSummary') || `아래 대화 기록의 핵심 내용, 문맥, 사용자의 목적 등을 종합적으로 요약해 주세요. 요약은 다른 AI가 읽었을 때 대화 흐름을 완벽히 이해할 수 있도록 명확하게 작성해야 합니다.\n\n`);
	}

	prompt += (t('summarization.prompt.additionalConversation') || `[추가 대화]\n`);
	for (const m of targetMessagesToSummarize) {
		const roleName = m.role === 'user' 
			? (t('summarization.prompt.roleUser') || '사용자')
			: (t('summarization.prompt.roleAI') || 'AI');
		prompt += `${roleName}: ${m.content}\n\n`;
	}

	const llmMessages: ChatMessage[] = [
		{ role: 'user', content: prompt.trim() }
	];

	// 태스크 모델이 설정되어 있다면 우선 사용하고, 없으면 전달받은 메인 모델 사용
	let actualProviderConfig = providerConfig;
	let actualModelId = modelId;
	const { taskProviderId, taskModelId, providers } = plugin.settings.connections;
	
	if (taskProviderId && taskModelId) {
		const tpConfig = providers.find(p => p.id === taskProviderId);
		if (tpConfig) {
			actualProviderConfig = tpConfig;
			actualModelId = taskModelId;
		}
	}

	const chatOptions: ChatOptions = {
		model: actualModelId,
		temperature: 0.3, // 요약은 비교적 정확성을 요구하므로 낮게 설정
		maxOutputTokens: 2000,
	};

	try {
		debugLogger.logMcp('AutoSummary', 'Background summarization started', {
			currentSummaryExists: !!currentSummary,
			targetMessageCount: targetMessagesToSummarize.length
		});

		const provider = createProvider(actualProviderConfig);
		const response = await provider.chat(llmMessages, chatOptions);
		const newSummary = response.content.trim();

		if (newSummary) {
			// 스토어 업데이트
			sessionSummary.set(newSummary);
			summaryUpToMessageId.set(newUpToId);

			debugLogger.logMcp('AutoSummary', 'Background summarization completed', {
				newSummaryLength: newSummary.length
			});

			// 히스토리 파일에 변경사항 저장
			const { chat } = plugin.settings;
			if (chat.autoSaveHistory) {
				const sessionId = get(currentSessionId);
				if (sessionId) {
					const session: ChatSession = {
						id: sessionId,
						title: get(currentSessionTitle) || '새 대화',
						messages: get(messages),
						createdAt: get(messages)[0]?.timestamp || Date.now(),
						updatedAt: Date.now(),
						providerId: providerConfig.id, // 원래 세션의 provider를 유지하려면 chatStore에서 관리해야 하나, 현재는 마지막 요청 provider 사용
						modelId: modelId,
						sessionSummary: newSummary,
						summaryUpToMessageId: newUpToId,
					};
					saveSession(plugin.app, session, chat.historyPath).catch((e: unknown) => {
						debugLogger.logError('AutoSummary', e instanceof Error ? e : new Error(String(e)));
					});
				}
			}
		}
	} catch (error) {
		// 오류 시 로그만 남기고, 다음 메시지 전송 시 재시도되도록 함
		debugLogger.logError('AutoSummary', error as Error);
	}
}
