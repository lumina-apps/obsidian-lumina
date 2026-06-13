/**
 * debugLogger.ts
 *
 * 전역 싱글턴 로거. EventEmitter 패턴으로 구현.
 *
 * - settingsStore의 misc.debugMode가 false이면 모든 메서드가 no-op
 * - LLM 요청/응답, RAG 검색, System 이벤트, 에러를 수집하여 구독자에게 emit
 * - DebugPanel.svelte가 subscribe하여 실시간 표시
 * - 링 버퍼: 최대 MAX_ENTRIES 개까지 유지 (메모리 안전)
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

// ─── Config ───────────────────────────────────────────────────────────────────

/** 링 버퍼 최대 항목 수 */
const MAX_ENTRIES = 200;

// ─── Types ────────────────────────────────────────────────────────────────────

type LogListener = (entry: DebugLogEntry) => void;
type ClearListener = () => void;

// ─── DebugLogger ──────────────────────────────────────────────────────────────

class DebugLogger {
	private entries: DebugLogEntry[] = [];
	private logListeners: Set<LogListener> = new Set();
	private clearListeners: Set<ClearListener> = new Set();
	private counter = 0;

	// ── 활성 여부 ────────────────────────────────────────────────────────────

	get isEnabled(): boolean {
		const settings = get(settingsStore);
		return settings?.misc.debugMode ?? false;
	}

	// ── ID 생성 ──────────────────────────────────────────────────────────────

	private nextId(): string {
		return `dbg-${Date.now()}-${++this.counter}`;
	}

	// ── 내부 emit ────────────────────────────────────────────────────────────

	private push(entry: DebugLogEntry): void {
		// 링 버퍼: 초과 시 가장 오래된 항목 제거
		if (this.entries.length >= MAX_ENTRIES) {
			this.entries.shift();
		}
		this.entries.push(entry);
		this.logListeners.forEach(fn => fn(entry));
	}

	// ── 공개 로깅 API ────────────────────────────────────────────────────────

	/**
	 * LLM 요청 직전 호출. 모델 설정 및 프롬프트 전체를 기록.
	 * @returns requestId — 응답 로그와 매칭에 사용
	 */
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

	/**
	 * LLM 응답 수신 완료 후 호출.
	 * @param requestId logRequest()가 반환한 ID
	 */
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

	/** RAG 벡터 검색 완료 후 호출 */
	logRagSearch(params: Omit<RAGSearchLog, 'id' | 'type' | 'timestamp'>): void {
		if (!this.isEnabled) return;
		this.push({
			id: this.nextId(),
			type: 'rag',
			timestamp: Date.now(),
			...params,
		});
	}

	/** 시스템 이벤트 (인덱싱 시작/완료, 워커 초기화 등) */
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

	/** 에러 로그 */
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

	/** MCP 로그 */
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

	// ── 조회 ─────────────────────────────────────────────────────────────────

	/** 현재까지 쌓인 모든 로그 (읽기 전용 복사본) */
	getEntries(): readonly DebugLogEntry[] {
		return this.entries;
	}

	/** 로그 초기화 */
	clear(): void {
		this.entries = [];
		this.clearListeners.forEach(fn => fn());
	}

	// ── 구독 ─────────────────────────────────────────────────────────────────

	/** 새 로그 항목이 추가될 때마다 호출 */
	onLog(fn: LogListener): () => void {
		this.logListeners.add(fn);
		return () => this.logListeners.delete(fn);
	}

	/** clear() 호출 시 알림 */
	onClear(fn: ClearListener): () => void {
		this.clearListeners.add(fn);
		return () => this.clearListeners.delete(fn);
	}
}

// ─── 싱글턴 export ────────────────────────────────────────────────────────────

export const debugLogger = new DebugLogger();
