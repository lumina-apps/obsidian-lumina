/** 채팅 런타임 전역 상태. chatController가 액션 호출, ChatPanel.svelte가 구독 */

import { writable, get } from 'svelte/store';
import type { UIChatMessage, ContextAttachment, ChatRagSource, RagPipelineStep } from '../../shared/types/chat.types';
import type {
	AutopilotToolCallLog,
	AutopilotFileEditLog,
	AutopilotUsage,
	AutopilotExecution,
} from '../../shared/types/autopilot.types';
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
export const activeCliExecution = writable<AutopilotExecution | null>(null);

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

/** 실행 중인 도구 추가 */
export function addExecutingTool(messageId: string, tool: { id: string; name: string }): void {
	messages.update(ms =>
		ms.map(m => {
			if (m.id !== messageId) return m;
			const current = m.executingTools || [];
			return { ...m, executingTools: [...current, tool] };
		})
	);
}

/** 실행 완료된 도구 제거 */
export function removeExecutingTool(messageId: string, toolId: string): void {
	messages.update(ms =>
		ms.map(m => {
			if (m.id !== messageId) return m;
			const current = m.executingTools || [];
			return { ...m, executingTools: current.filter(t => t.id !== toolId) };
		})
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

// ─── CLI Agent Specific Actions ───────────────────────────────────────────────

/** CLI 에이전트 생각 과정 누적 */
export function appendThinking(messageId: string, delta: string): boolean {
	let found = false;
	messages.update(ms =>
		ms.map(m => {
			if (m.id !== messageId) return m;
			found = true;
			const currentThinking = m.thinking || '';
			return { ...m, thinking: currentThinking + delta };
		}),
	);
	return found;
}

/** CLI 에이전트 실시간 활동 상태 설정 */
export function setActivityStatus(messageId: string, status?: string): void {
	messages.update(ms =>
		ms.map(m => (m.id === messageId ? { ...m, activityStatus: status } : m)),
	);
}

/** CLI 에이전트 원시 로그 누적 */
export function appendRawLog(messageId: string, logLine: string): void {
	messages.update(ms =>
		ms.map(m => {
			if (m.id !== messageId) return m;
			const logs = m.rawLogs || [];
			return { ...m, rawLogs: [...logs, logLine] };
		}),
	);
}

/** CLI 에이전트 도구 호출 추가 */
export function addCliToolCall(messageId: string, toolCall: AutopilotToolCallLog): void {
	messages.update(ms =>
		ms.map(m => {
			if (m.id !== messageId) return m;
			const existing = m.cliToolCalls || [];
			return { ...m, cliToolCalls: [...existing, toolCall] };
		}),
	);
}

/** CLI 에이전트 도구 호출 상태 업데이트 */
export function updateCliToolCall(
	messageId: string,
	toolCallId: string,
	updates: Partial<AutopilotToolCallLog>,
): void {
	messages.update(ms =>
		ms.map(m => {
			if (m.id !== messageId) return m;
			const currentCalls = m.cliToolCalls || [];
			return {
				...m,
				cliToolCalls: currentCalls.map(tc =>
					tc.id === toolCallId ? { ...tc, ...updates } : tc,
				),
			};
		}),
	);
}

/** CLI 에이전트 파일 수정 내역 추가 */
export function addCliFileEdit(messageId: string, fileEdit: AutopilotFileEditLog): void {
	messages.update(ms =>
		ms.map(m => {
			if (m.id !== messageId) return m;
			const existing = m.cliFileEdits || [];
			return { ...m, cliFileEdits: [...existing, fileEdit] };
		}),
	);
}

/** CLI 에이전트 파일 수정 내역 업데이트 */
export function updateCliFileEdit(
	messageId: string,
	fileEditId: string,
	updates: Partial<AutopilotFileEditLog>,
): void {
	messages.update(ms =>
		ms.map(m => {
			if (m.id !== messageId) return m;
			const currentEdits = m.cliFileEdits || [];
			return {
				...m,
				cliFileEdits: currentEdits.map(fe =>
					fe.id === fileEditId ? { ...fe, ...updates } : fe,
				),
			};
		}),
	);
}

/** CLI 에이전트 토큰 사용량 기록 */
export function setCliUsage(messageId: string, usage: AutopilotUsage): void {
	messages.update(ms =>
		ms.map(m => (m.id === messageId ? { ...m, cliUsage: usage } : m)),
	);
}

