/** 채팅 런타임 전역 상태. chatController가 액션 호출, ChatPanel.svelte가 구독 */

import { writable, get } from 'svelte/store';
import type { UIChatMessage, ContextAttachment, ChatRagSource, RagPipelineStep } from '../../shared/types/chat.types';
import { t } from '../../shared/locales/helpers';

// ─── State ────────────────────────────────────────────────────────────────────

export const messages = writable<UIChatMessage[]>([]);
export const isLoading = writable<boolean>(false);
export const currentSessionId = writable<string | null>(null);
export const currentSessionTitle = writable<string | null>(null);
export const sessionSummary = writable<string | undefined>(undefined);
export const summaryUpToMessageId = writable<string | undefined>(undefined);

export const pendingAttachments = writable<ContextAttachment[]>([]);
export const activeSidebarTab = writable<'chat' | 'discovery'>('chat');

// ─── Actions ──────────────────────────────────────────────────────────────────

export function resetChat(): void {
	messages.set([]);
	isLoading.set(false);
	currentSessionId.set(null);
	currentSessionTitle.set(null);
	sessionSummary.set(undefined);
	summaryUpToMessageId.set(undefined);
}

/** 특정 세션으로 대화 상태 덮어쓰기 (히스토리에서 불러오기) */
export function setSession(session: import('../../shared/types/chat.types').ChatSession): void {
	messages.set(session.messages);
	isLoading.set(false);
	currentSessionId.set(session.id);
	currentSessionTitle.set(session.title);
	sessionSummary.set(session.sessionSummary);
	summaryUpToMessageId.set(session.summaryUpToMessageId);
}

/** 현재 세션 제목 업데이트 */
export function setSessionTitle(title: string): void {
	currentSessionTitle.set(title);
}

/** 메시지 추가 */
export function addMessage(msg: UIChatMessage): void {
	messages.update(ms => [...ms, msg]);
}

/**
 * 스트리밍 청크를 특정 메시지에 누적
 * @returns 업데이트 성공 여부
 */
export function appendChunk(messageId: string, delta: string): boolean {
	let found = false;
	messages.update(ms =>
		ms.map(m => {
			if (m.id !== messageId) return m;
			found = true;
			return { ...m, content: m.content + delta };
		}),
	);
	return found;
}

/** 스트리밍 완료/취소 표시 */
export function setMessageStreaming(messageId: string, streaming: boolean): void {
	messages.update(ms =>
		ms.map(m => (m.id === messageId ? {
			...m,
			isStreaming: streaming,
			...(streaming ? {} : { ragPipelineStep: null })
		} : m)),
	);
}

/** 메시지에 토큰 사용량 정보 추가 */
export function setMessageTokenUsage(
	messageId: string,
	usage: NonNullable<UIChatMessage['tokenUsage']>
): void {
	messages.update(ms =>
		ms.map(m => (m.id === messageId ? { ...m, tokenUsage: usage } : m)),
	);
}

/** 메시지에 RAG 출처 추가 */
export function setMessageSources(messageId: string, sources: ChatRagSource[]): void {
	messages.update(ms =>
		ms.map(m => (m.id === messageId ? { ...m, ragSources: sources } : m)),
	);
}

/** RAG 파이프라인 단계 업데이트 */
export function setMessageRagStep(messageId: string, step: RagPipelineStep): void {
	messages.update(ms =>
		ms.map(m => (m.id === messageId ? { ...m, ragPipelineStep: step } : m)),
	);
}

/** 메시지를 오류 상태로 변경 */
export function setMessageError(messageId: string, errMsg: string): void {
	messages.update(ms =>
		ms.map(m =>
			m.id === messageId
				? { ...m, content: `⚠️ ${t('common.error')}: ${errMsg}`, isStreaming: false, ragPipelineStep: null }
				: m,
		),
	);
}

/** 현재 메시지 배열 스냅샷 (store 구독 없이 한 번만 읽을 때) */
export function getMessages(): UIChatMessage[] {
	return get(messages);
}

/**
 * 특정 메시지의 content를 직접 교체한다.
 * streaming 중 tool call 정리 후 UI 동기화에 사용.
 */
export function syncMessageContent(messageId: string, content: string): void {
	messages.update(ms =>
		ms.map(m => (m.id === messageId ? { ...m, content } : m)),
	);
}

/** 대기 중인 컨텍스트 첨부 추가 */
export function addPendingAttachment(attachment: ContextAttachment): void {
	pendingAttachments.update(arr => [...arr, attachment]);
}
