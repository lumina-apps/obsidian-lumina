/**
 * chatStore.ts
 *
 * 채팅 도메인의 런타임 전역 상태.
 * - messages: 현재 대화 기록 (스트리밍 포함)
 * - isLoading: LLM 응답 대기 여부
 *
 * chatController가 직접 액션을 호출하여 업데이트.
 * ChatPanel.svelte는 $messages, $isLoading으로 반응형 구독.
 */

import { writable, get } from 'svelte/store';
import type { UIChatMessage, ContextAttachment, ChatRagSource } from '../../shared/types/chat.types';

// ─── State ────────────────────────────────────────────────────────────────────

export const messages = writable<UIChatMessage[]>([]);
export const isLoading = writable<boolean>(false);
export const currentSessionId = writable<string | null>(null);
export const currentSessionTitle = writable<string | null>(null);

export const pendingAttachments = writable<ContextAttachment[]>([]);
export const activeSidebarTab = writable<'chat' | 'discovery'>('chat');

// ─── Actions ──────────────────────────────────────────────────────────────────

/** 대화 초기화 */
export function resetChat(): void {
	messages.set([]);
	isLoading.set(false);
	currentSessionId.set(null);
	currentSessionTitle.set(null);
}

/** 특정 세션으로 대화 상태 덮어쓰기 (히스토리에서 불러오기) */
export function setSession(sessionId: string, loadedMessages: UIChatMessage[], title?: string): void {
	messages.set(loadedMessages);
	isLoading.set(false);
	currentSessionId.set(sessionId);
	if (title) currentSessionTitle.set(title);
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
		ms.map(m => (m.id === messageId ? { ...m, isStreaming: streaming } : m)),
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

/** 메시지를 오류 상태로 변경 */
export function setMessageError(messageId: string, errMsg: string): void {
	messages.update(ms =>
		ms.map(m =>
			m.id === messageId
				? { ...m, content: `⚠️ 오류: ${errMsg}`, isStreaming: false }
				: m,
		),
	);
}

/** 현재 메시지 배열 스냅샷 (store 구독 없이 한 번만 읽을 때) */
export function getMessages(): UIChatMessage[] {
	return get(messages);
}

/** 대기 중인 컨텍스트 첨부 추가 */
export function addPendingAttachment(attachment: ContextAttachment): void {
	pendingAttachments.update(arr => [...arr, attachment]);
}
