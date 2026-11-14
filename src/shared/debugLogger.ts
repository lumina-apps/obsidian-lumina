/**
 * debugLogger.ts
 *
 * 전역 싱글턴 로거. debugMode가 꺼져 있으면 모든 메서드가 no-op으로 동작.
 * LLM 요청/응답, RAG 검색, 시스템 이벤트, 에러를 링 버퍼에 쌓고 구독자에게 전달.
 */

import type {
	DebugLogEntry,
	LLMRequestLog,
	LLMResponseLog,
	RAGSearchLog,
	RagChunkMeta,
	SystemLog,
	ErrorLog,
	MCPLog,
} from './types/debug.types';

export type { DebugLogEntry, LLMRequestLog, LLMResponseLog, RAGSearchLog, RagChunkMeta, SystemLog, ErrorLog, MCPLog };

/** 링 버퍼 최대 보관 엔트리 수 */
export const MAX_DEBUG_ENTRIES = 200;

const DATA_IMAGE_REGEX = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;

/** 문자열 내 base64 이미지 데이터 URL을 크기 요약 표기로 치환 */
export function redactBase64Images(text: string): string {
	if (!text.includes('data:image/')) return text;
	return text.replace(DATA_IMAGE_REGEX, (match) => {
		const commaIdx = match.indexOf(',');
		const base64Len = commaIdx !== -1 ? match.length - commaIdx - 1 : match.length;
		const approxKb = Math.max(1, Math.round((base64Len * 3) / 4 / 1024));
		return `[image data: ~${approxKb}KB]`;
	});
}

/**
 * 디버그 로그 기록용 메시지 배열 직렬화 헬퍼.
 * 멀티모달 메시지 내 base64 이미지 데이터를 크기 요약으로 치환한다.
 */
export function formatMessagesForDebugLog(
	messages: ReadonlyArray<{ role: string; content: unknown }>,
): Array<{ role: string; content: string }> {
	return messages.map((m) => {
		const rawContent = typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
		return {
			role: m.role,
			content: redactBase64Images(rawContent),
		};
	});
}

type LogListener = (entry: DebugLogEntry) => void;
type ClearListener = () => void;

class DebugLogger {
	private entries: DebugLogEntry[] = [];
	private logListeners: Set<LogListener> = new Set();
	private clearListeners: Set<ClearListener> = new Set();
	private counter = 0;
	private _isEnabled = false;

	get isEnabled(): boolean {
		return this._isEnabled;
	}

	setEnabled(enabled: boolean): void {
		this._isEnabled = enabled;
	}

	private nextId(): string {
		return `dbg-${Date.now()}-${++this.counter}`;
	}

	/** 항목을 링 버퍼에 추가 (초과 시 가장 오래된 항목 제거) */
	private push(entry: DebugLogEntry): void {
		if (this.entries.length >= MAX_DEBUG_ENTRIES) {
			this.entries.shift();
		}
		this.entries.push(entry);
		this.logListeners.forEach(fn => {
			try {
				fn(entry);
			} catch (e) {
				console.error('[DebugLogger] Listener error:', e);
			}
		});
	}

	/** LLM 요청 기록. 응답과 매칭할 requestId 반환 */
	logRequest(params: Omit<LLMRequestLog, 'id' | 'type' | 'timestamp'>): string {
		if (!this.isEnabled) return '';
		const id = this.nextId();
		this.push({
			id,
			type: 'llm-request',
			timestamp: Date.now(),
			...params,
			systemPrompt: redactBase64Images(params.systemPrompt),
			messages: params.messages.map((m) => ({
				role: m.role,
				content: redactBase64Images(m.content),
			})),
		});
		return id;
	}

	/** LLM 응답 기록 */
	logResponse(requestId: string, params: Omit<LLMResponseLog, 'id' | 'type' | 'timestamp' | 'requestId'>): void {
		if (!this.isEnabled || !requestId) return;
		this.push({
			id: this.nextId(),
			type: 'llm-response',
			timestamp: Date.now(),
			requestId,
			...params,
		});
	}

	/** RAG 벡터 검색 기록 */
	logRagSearch(params: Omit<RAGSearchLog, 'id' | 'type' | 'timestamp'>): void {
		if (!this.isEnabled) return;
		this.push({
			id: this.nextId(),
			type: 'rag',
			timestamp: Date.now(),
			...params,
		});
	}

	/** 시스템 이벤트 기록 */
	logSystem(event: string, message: string, meta?: Record<string, unknown>): void {
		if (!this.isEnabled) return;
		const entry: SystemLog = {
			id: this.nextId(),
			type: 'system',
			timestamp: Date.now(),
			event,
			message,
			...(meta ? { meta } : {}),
		};
		this.push(entry);
	}

	/** Info 기록 */
	logInfo(domain: string, message: string): void {
		if (!this.isEnabled) return;
		const entry: SystemLog = {
			id: this.nextId(),
			type: 'system',
			timestamp: Date.now(),
			event: 'info',
			message: `[${domain}] ${message}`,
		};
		this.push(entry);
	}

	/** Warning 기록 */
	logWarn(domain: string, message: string): void {
		if (!this.isEnabled) return;
		const entry: SystemLog = {
			id: this.nextId(),
			type: 'system',
			timestamp: Date.now(),
			event: 'warn',
			message: `[${domain}] ${message}`,
		};
		this.push(entry);
	}

	/** Debug 기록 */
	logDebug(domain: string, message: string): void {
		if (!this.isEnabled) return;
		const entry: SystemLog = {
			id: this.nextId(),
			type: 'system',
			timestamp: Date.now(),
			event: 'debug',
			message: `[${domain}] ${message}`,
		};
		this.push(entry);
	}

	/** 에러 기록 - 프로덕션에서도 버퍼에 보존하며 콘솔에 출력 */
	logError(domain: string, error: Error | string): void {
		const msg = error instanceof Error ? error.message : error;
		const stack = error instanceof Error ? error.stack : undefined;
		const entry: ErrorLog = {
			id: this.nextId(),
			type: 'error',
			timestamp: Date.now(),
			domain,
			message: msg,
			...(stack ? { stack } : {}),
		};
		this.push(entry);

		// 디버그 모드가 비활성화되어 있더라도 프로덕션 에러는 콘솔에 출력하여 추적 보장
		if (!this.isEnabled) {
			console.error(`[Lumina:${domain}]`, error);
		}
	}

	/** MCP 로그 기록 */
	logMcp(action: string, message: string, data?: unknown): void {
		if (!this.isEnabled) return;
		const entry: MCPLog = {
			id: this.nextId(),
			type: 'mcp',
			timestamp: Date.now(),
			action,
			message,
			...(data !== undefined ? { data } : {}),
		};
		this.push(entry);
	}

	/** 현재까지 쌓인 모든 로그 반환 */
	getEntries(): readonly DebugLogEntry[] {
		return this.entries;
	}

	/** 로그 초기화 */
	clear(): void {
		this.entries = [];
		this.clearListeners.forEach(fn => fn());
	}

	/** 새 로그 항목 구독. 구독 해제 함수 반환 */
	onLog(fn: LogListener): () => void {
		this.logListeners.add(fn);
		return () => this.logListeners.delete(fn);
	}

	/** clear() 호출 시 알림 구독 */
	onClear(fn: ClearListener): () => void {
		this.clearListeners.add(fn);
		return () => this.clearListeners.delete(fn);
	}
}

export const debugLogger = new DebugLogger();
