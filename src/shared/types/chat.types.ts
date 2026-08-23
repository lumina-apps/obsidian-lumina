export interface ContextAttachment {
	type: 'file' | 'folder' | 'selection' | 'active_note' | 'canvas' | 'tag' | 'url' | 'external_file';
	path: string;
	name: string;
	content?: string;
}

export interface ChatRagSource {
	filePath: string;
	chunkText?: string;
}

export type RagPipelineStep = 'searching' | 'reranking' | 'compressing' | 'generating' | null;

import type { TokenUsage } from './llm.types';

export interface UIChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	attachments?: ContextAttachment[];
	/** RAG 참조 문서 출처 */
	ragSources?: ChatRagSource[];
	/** RAG 파이프라인 진행 상태 (스트리밍 중 인디케이터 표시용) */
	ragPipelineStep?: RagPipelineStep;
	/** 현재 백그라운드에서 실행 중인 도구 목록 */
	executingTools?: { id: string; name: string }[];
	/** 수동 컨텍스트 압축으로 생성된 합성 요약 메시지 여부 */
	isContextSummary?: boolean;
	/** 압축 통계 (배너/Notice 표시용) */
	contextSummaryMeta?: { messages: number; tokens: number };
	isStreaming: boolean;
	timestamp: number;
	model?: string;
	/** 토큰 사용량 */
	tokenUsage?: TokenUsage;
}

export interface ChatSession {
	id: string;
	/** 첫 사용자 메시지에서 자동 생성 */
	title: string;
	messages: UIChatMessage[];
	createdAt: number;
	updatedAt: number;
	providerId: string;
	modelId: string;
	/** 대화 요약본 (auto_summary 모드에서 사용) */
	sessionSummary?: string;
	/** 요약이 완료된 마지막 메시지 ID (이후 메시지부터 컨텍스트에 포함) */
	summaryUpToMessageId?: string;
}
