/**
 * promptBuilder.ts
 *
 * UIChatMessage[] + 설정 정보 → LLM API로 전송할 ChatMessage[] 변환
 * - 시스템 프롬프트 삽입
 * - 대화 기억 제한 (턴 수 / 토큰 기반)
 * - 응답 언어 지정 주입
 * - RAG 컨텍스트 주입 (추후 연결)
 */

import type { ChatMessage } from '../../shared/types/llm.types';
import type { UIChatMessage } from '../../shared/types/chat.types';
import type { ChatSettings } from '../../core/settings/settings.types';
import { t } from '../../shared/locales/helpers';

const LANGUAGE_HINTS: Record<string, string> = {
	ko: 'Always respond in Korean (한국어).',
	en: 'Always respond in English.',
	ja: 'Always respond in Japanese (日本語).',
	zh: 'Always respond in Chinese (中文).',
	fr: 'Always respond in French (Français).',
	de: 'Always respond in German (Deutsch).',
	es: 'Always respond in Spanish (Español).',
	it: 'Always respond in Italian (Italiano).',
};

export interface PromptBuilderOptions {
	chat: ChatSettings;
	/** RAG 검색 결과 텍스트 (선택적) */
	ragContext?: string;
}

/**
 * UI 대화 기록 + 설정 → LLM API 메시지 배열 변환
 *
 * @param history  현재까지의 UI 메시지 (어시스턴트 placeholder 제외)
 * @param userText 방금 입력한 사용자 메시지
 */
export function buildMessages(
	history: UIChatMessage[],
	userText: string,
	opts: PromptBuilderOptions,
): ChatMessage[] {
	const { chat, ragContext } = opts;

	// ── 1. 시스템 프롬프트 구성 ───────────────────────────────────────────────
	const activePreset = chat.systemPrompts.find(p => p.id === chat.activeSystemPromptId);
	let systemContent = activePreset?.content ?? '';

	// 응답 언어 지정
	if (chat.responseLanguage !== 'auto') {
		const hint = LANGUAGE_HINTS[chat.responseLanguage];
		if (hint) systemContent = `${systemContent}\n\n${hint}`.trim();
	}

	// RAG 컨텍스트 주입은 이제 마지막 User 메시지에서 처리합니다.

	const messages: ChatMessage[] = [];

	if (systemContent) {
		messages.push({ role: 'system', content: systemContent });
	}

	// ── 2. 대화 기억 제한 적용 ─────────────────────────────────────────────────
	// system 메시지 제외, user/assistant 교환만 필터
	const turns = history.filter(m => m.role !== 'system');

	let trimmedTurns: UIChatMessage[];

	if (chat.useTokenLimit) {
		// 토큰 기반: 뒤에서부터 토큰 합산 (간이 추정: 4 chars ≈ 1 token)
		let tokenCount = 0;
		const maxTokens = chat.maxContextTokens;
		const collected: UIChatMessage[] = [];
		for (let i = turns.length - 1; i >= 0; i--) {
			const estimated = Math.ceil(turns[i].content.length / 4);
			if (tokenCount + estimated > maxTokens) break;
			tokenCount += estimated;
			collected.unshift(turns[i]);
		}
		trimmedTurns = collected;
	} else {
		// 턴 수 기반: 1턴 = user + assistant 1쌍
		const maxPairs = chat.contextWindowTurns;
		trimmedTurns = turns.slice(-maxPairs * 2);
	}

	// ── 3. 이전 대화 추가 ─────────────────────────────────────────────────────
	for (const m of trimmedTurns) {
		let content = m.content;
		// assistant 메시지의 경우 <think> 태그 내용 제거 (DeepSeek API 등 에러 방지)
		if (m.role === 'assistant') {
			content = content.replace(/<think>([\s\S]*?)(?:<\/think>|$)/gi, '').trim();
		}
		messages.push({
			role: m.role as 'user' | 'assistant',
			content: content,
		});
	}

	// ── 4. 현재 사용자 메시지 추가 (RAG 컨텍스트 병합) ─────────────────────────
	let finalUserText = userText;
	
	if (ragContext) {
		// RAG 컨텍스트 길이 최적화 (예: 최대 20000자, 약 5000토큰 분량)
		const MAX_RAG_CHARS = 20000;
		let optimizedRag = ragContext;
		if (optimizedRag.length > MAX_RAG_CHARS) {
			optimizedRag = optimizedRag.substring(0, MAX_RAG_CHARS) + '\n\n... (Context truncated due to length limits)';
			console.warn(t('uiMessages.ragTooLong', { max: MAX_RAG_CHARS }));
		}
		
		// User 메시지 상단에 컨텍스트를 주입
		finalUserText = `[Context from the vault]\n${optimizedRag}\n\n---\n\n${userText}`;
	}

	messages.push({ role: 'user', content: finalUserText });

	return messages;
}
