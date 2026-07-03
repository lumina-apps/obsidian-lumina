/**
 * debugLogger.ts
 *
 * 전역 싱글턴 로거. debugMode가 꺼져 있으면 모든 메서드가 no-op으로 동작.
 * LLM 요청/응답, RAG 검색, 시스템 이벤트, 에러를 링 버퍼에 쌓고 구독자에게 전달.
 */

import { get } from 'svelte/store';
import { settingsStore } from '../core/store/settingsStore';
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

const MAX_ENTRIES = 200;

type LogListener = (entry: DebugLogEntry) => void;
type ClearListener = () => void;

class DebugLogger {
	private entries: DebugLogEntry[] = [];
	private logListeners: Set<LogListener> = new Set();
	private clearListeners: Set<ClearListener> = new Set();
	private counter = 0;

	get isEnabled(): boolean {
		const settings = get(settingsStore);
		return settings?.misc.debugMode ?? false;
	}

	private nextId(): string {
		return `dbg-${Date.now()}-${++this.counter}`;
	}

	/** 항목을 링 버퍼에 추가 (초과 시 가장 오래된 항목 제거) */
	private push(entry: DebugLogEntry): void {
		if (this.entries.length >= MAX_ENTRIES) {
			this.entries.shift();
		}
		this.entries.push(entry);
		this.logListeners.forEach(fn => fn(entry));
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

	/** 에러 기록 */
	logError(domain: string, error: Error | string): void {
		if (!this.isEnabled) return;
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
