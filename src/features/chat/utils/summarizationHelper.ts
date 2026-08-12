import type LuminaPlugin from '../../../main';
import { get } from 'svelte/store';
import { messages, sessionSummary, summaryUpToMessageId, currentSessionId, currentSessionTitle } from '../../../core/store/chatStore';
import { createProvider } from '../../../core/llm-providers';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import type { ChatMessage, ChatOptions } from '../../../shared/types/llm.types';

import { debugLogger } from '../../../shared/debugLogger';
import { saveSession } from '../history';
import type { ChatSession, UIChatMessage } from '../../../shared/types/chat.types';
import { t } from '../../../shared/locales/helpers';
import { estimateTokens } from '../promptBuilder';

/** 디버그 로그에 남길 요약 본문 최대 길이 (과도한 메모리/표시 방지) */
const SUMMARY_LOG_MAX = 2000;

function truncateSummary(summary: string): string {
	return summary.length > SUMMARY_LOG_MAX ? summary.slice(0, SUMMARY_LOG_MAX) + '…' : summary;
}

/** 이전 요약 + 대상 메시지 목록 → 요약 요청 프롬프트 구성 */
function buildSummaryPrompt(currentSummary: string | null | undefined, targetMessages: UIChatMessage[]): string {
	let prompt = t('summarization.prompt.intro') || `다음은 사용자와 AI 간의 채팅 기록입니다.\n\n`;

	if (currentSummary) {
		prompt += (t('summarization.prompt.previousSummary') || `[이전 대화 요약]\n`) + `${currentSummary}\n\n`;
		prompt += (t('summarization.prompt.instructionWithSummary') || `위의 이전 대화 요약에 이어서, 아래의 추가 대화를 포함하여 전체 대화의 핵심 내용, 문맥, 사용자의 목적 등을 종합적으로 요약해 주세요. 요약은 다른 AI가 읽었을 때 이전 대화 흐름을 완벽히 이해할 수 있도록 명확하게 작성해야 합니다.\n\n`);
	} else {
		prompt += (t('summarization.prompt.instructionWithoutSummary') || `아래 대화 기록의 핵심 내용, 문맥, 사용자의 목적 등을 종합적으로 요약해 주세요. 요약은 다른 AI가 읽었을 때 대화 흐름을 완벽히 이해할 수 있도록 명확하게 작성해야 합니다.\n\n`);
	}

	prompt += (t('summarization.prompt.additionalConversation') || `[추가 대화]\n`);
	for (const m of targetMessages) {
		const roleName = m.role === 'user'
			? (t('summarization.prompt.roleUser') || '사용자')
			: (t('summarization.prompt.roleAI') || 'AI');
		prompt += `${roleName}: ${m.content}\n\n`;
	}
	return prompt.trim();
}

/** 태스크 모델 우선 사용, 없으면 메인 모델로 요약 LLM 호출 */
async function runSummaryLlm(
	plugin: LuminaPlugin,
	providerConfig: LLMProviderConfig,
	modelId: string,
	prompt: string,
): Promise<string | null> {
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
		const llmMessages: ChatMessage[] = [{ role: 'user', content: prompt }];
		const provider = createProvider(actualProviderConfig);
		const response = await provider.chat(llmMessages, chatOptions);
		return response.content.trim() || null;
	} catch (error) {
		debugLogger.logError('AutoSummary', error as Error);
		return null;
	}
}

/** 요약 완료 후 스토어/히스토리 반영 공통 처리 */
function applySummaryToStoreAndHistory(
	plugin: LuminaPlugin,
	providerConfig: LLMProviderConfig,
	modelId: string,
	newSummary: string,
	newUpToId: string,
	replaceInStore: { syntheticMsg: UIChatMessage; recentMsgs: UIChatMessage[] } | null,
): void {
	if (replaceInStore) {
		messages.set([replaceInStore.syntheticMsg, ...replaceInStore.recentMsgs]);
	}
	sessionSummary.set(newSummary);
	summaryUpToMessageId.set(newUpToId);

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
				providerId: providerConfig.id,
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

	const prompt = buildSummaryPrompt(currentSummary, targetMessagesToSummarize);

	debugLogger.logMcp('AutoSummary', 'Background summarization started', {
		currentSummaryExists: !!currentSummary,
		targetMessageCount: targetMessagesToSummarize.length
	});

	const newSummary = await runSummaryLlm(plugin, providerConfig, modelId, prompt);
	if (!newSummary) return;

	debugLogger.logMcp('AutoSummary', 'Background summarization completed', {
		newSummaryLength: newSummary.length,
		messagesCompressed: targetMessagesToSummarize.length,
		summary: truncateSummary(newSummary),
	});

	applySummaryToStoreAndHistory(plugin, providerConfig, modelId, newSummary, newUpToId, null);
}

/**
 * 수동 컨텍스트 압축: 최신 2턴을 제외한 이전 대화를 요약하고,
 * 스토어에서 요약 메시지로 실제 치환해 모든 메모리 모드(turns/tokens/auto_summary)에서 공간을 확보합니다.
 */
export type SummarizeResult =
	| { status: 'ok'; messages: number; tokens: number }
	| { status: 'too-short' }
	| { status: 'error' };

export async function summarizeConversation(
	plugin: LuminaPlugin,
	providerConfig: LLMProviderConfig,
	modelId: string,
): Promise<SummarizeResult> {
	const msgs = get(messages);
	const currentSummary = get(sessionSummary);
	const conversation = msgs.filter(m => m.role !== 'system');

	// 최소 2턴(4개 메시지) 이상일 때만 압축 가능
	if (conversation.length <= 4) {
		return { status: 'too-short' };
	}

	// 최신 2턴(4개 메시지)는 원문 유지
	const targetMessagesToSummarize = conversation.slice(0, conversation.length - 4);

	const prompt = buildSummaryPrompt(currentSummary, targetMessagesToSummarize);

	debugLogger.logMcp('AutoSummary', 'Manual context compression started', {
		currentSummaryExists: !!currentSummary,
		targetMessageCount: targetMessagesToSummarize.length
	});

	const newSummary = await runSummaryLlm(plugin, providerConfig, modelId, prompt);
	if (!newSummary) return { status: 'error' };

	// 압축 통계 (배너/Notice 표시용)
	const tokensSaved = targetMessagesToSummarize.reduce((acc, m) => acc + estimateTokens(m.content), 0);

	// 스토어에서 요약 대상 메시지를 요약 메시지 하나로 치환 (전 모드에서 실제 공간 확보)
	const targetIds = new Set(targetMessagesToSummarize.map(m => m.id));
	const recentMsgs = msgs.filter(m => !targetIds.has(m.id));
	const syntheticMsg: UIChatMessage = {
		id: crypto.randomUUID(),
		role: 'user',
		content: (t('uiMessages.compressedContextBlock') || '📋 [Previous conversation compressed]') + `\n\n${newSummary}`,
		isContextSummary: true,
		contextSummaryMeta: { messages: targetMessagesToSummarize.length, tokens: tokensSaved },
		isStreaming: false,
		timestamp: targetMessagesToSummarize[0].timestamp,
	};

	debugLogger.logMcp('AutoSummary', 'Manual context compression completed', {
		newSummaryLength: newSummary.length,
		messagesCompressed: targetMessagesToSummarize.length,
		tokensSaved,
		summary: truncateSummary(newSummary),
	});

	// auto_summary 모드에서 요약 중복을 막기 위해 기준점을 합성 메시지 id로 설정
	applySummaryToStoreAndHistory(plugin, providerConfig, modelId, newSummary, syntheticMsg.id, { syntheticMsg, recentMsgs });

	return { status: 'ok', messages: targetMessagesToSummarize.length, tokens: tokensSaved };
}
