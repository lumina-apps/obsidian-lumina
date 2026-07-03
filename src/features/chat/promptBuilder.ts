/**
 * UIChatMessage[] + 설정 정보 → LLM API 전송용 ChatMessage[] 변환.
 * 시스템 프롬프트, 컨텍스트 길이 제한, RAG 컨텍스트 주입을 처리한다.
 */

import type { ChatMessage } from '../../shared/types/llm.types';
import type { UIChatMessage } from '../../shared/types/chat.types';
import type { ChatSettings } from '../../core/settings/settings.types';
import { t } from '../../shared/locales/helpers';
import { debugLogger } from '../../shared/debugLogger';

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
	/** 현재 세션의 요약본 (auto_summary 모드일 경우) */
	sessionSummary?: string;
	/** 요약이 완료된 메시지 ID (auto_summary 모드일 경우) */
	summaryUpToMessageId?: string;
	/** 치환될 활성 파일 경로 */
	activeFilePath?: string;
	/** 치환될 활성 파일 제목 (basename) */
	activeFileTitle?: string;
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
	const { chat, ragContext, sessionSummary, summaryUpToMessageId } = opts;

	// ── 1. 시스템 프롬프트 구성 ───────────────────────────────────────────────
	const activePreset = chat.systemPrompts.find(p => p.id === chat.activeSystemPromptId);
	let systemContent = activePreset?.content ?? '';

	if (systemContent) {
		// 옵시디언 환경에서는 window.moment가 사용 가능합니다. (테스트 환경 예외 처리 포함)
		const now = typeof window.moment !== 'undefined' ? window.moment() : new Date();
		const dateStr = typeof window.moment !== 'undefined' ? (now as any).format('YYYY-MM-DD') : (now as Date).toISOString().split('T')[0];
		const timeStr = typeof window.moment !== 'undefined' ? (now as any).format('HH:mm') : `${(now as Date).getHours()}:${(now as Date).getMinutes()}`;
		const activePathStr = opts.activeFilePath ?? 'No active file';
		const activeTitleStr = opts.activeFileTitle ?? 'No active file';

		systemContent = systemContent
			.replace(/\{\{date\}\}/g, dateStr)
			.replace(/\{\{time\}\}/g, timeStr)
			.replace(/\{\{activeFile\}\}/g, activePathStr)
			.replace(/\{\{title\}\}/g, activeTitleStr);
	}

	// 응답 언어 지정
	if (chat.responseLanguage !== 'auto') {
		const hint = LANGUAGE_HINTS[chat.responseLanguage];
		if (hint) systemContent = `${systemContent}\n\n${hint}`.trim();
	}

	// 읽기 모드 강제 안내 프롬프트 추가
	if (chat.agentExecutionMode === 'read') {
		const editModeLabel = t('settings.mcp.agentMode.editMode') || 'Edit Mode';
		systemContent = `${systemContent}\n\n[IMPORTANT STATUS]\nYou are currently in READ-ONLY mode. You cannot modify, delete, or execute any files or notes. If the user requests any modifying action, DO NOT say "I don't have the tool". Instead, politely inform them that they must click the "${editModeLabel}" toggle to enable modifications.`.trim();
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

	if (chat.memoryMethod === 'auto_summary') {
		// auto_summary 모드: summaryUpToMessageId 이후의 메시지만 포함
		if (summaryUpToMessageId) {
			const idx = turns.findIndex(m => m.id === summaryUpToMessageId);
			if (idx !== -1) {
				trimmedTurns = turns.slice(idx + 1);
			} else {
				trimmedTurns = turns;
			}
		} else {
			trimmedTurns = turns;
		}

		// 요약본이 있으면 시스템 프롬프트 맨 끝에 주입
		if (sessionSummary) {
			const summaryInstruction = `\n\n[이전 대화 요약]\n${sessionSummary}\n\n* 지시사항: 위의 대화 요약을 배경 지식으로 삼아 자연스럽게 대화의 문맥을 유지하세요.`;
			systemContent += summaryInstruction;
			// 시스템 프롬프트가 이미 생성되었으므로 재할당 (아래에서 messages[0] 확인)
			if (messages.length > 0 && messages[0].role === 'system') {
				messages[0].content = systemContent;
			} else if (systemContent) {
				messages.push({ role: 'system', content: systemContent });
			}
		}
	} else if (chat.memoryMethod === 'tokens') {
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
			role: m.role,
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
			const chunks = optimizedRag.split('\n\n---\n\n');
			let currentLen = 0;
			const validChunks: string[] = [];
			for (const chunk of chunks) {
				if (currentLen + chunk.length > MAX_RAG_CHARS && validChunks.length > 0) {
					validChunks.push('... (Context truncated due to length limits)');
					break;
				}
				validChunks.push(chunk);
				currentLen += chunk.length + 9; // 9 is length of separator
			}
			optimizedRag = validChunks.join('\n\n---\n\n');
			debugLogger.logWarn('rag', t('uiMessages.ragTooLong', { max: MAX_RAG_CHARS }) || `RAG context exceeded ${MAX_RAG_CHARS} chars`);
		}
		
		// User 메시지 상단에 컨텍스트를 주입
		finalUserText = `[Context from the vault]\n${optimizedRag}\n\n---\n\n${userText}`;
	}

	messages.push({ role: 'user', content: finalUserText });

	return messages;
}
