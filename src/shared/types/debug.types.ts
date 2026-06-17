// ─── Log Entry Types ──────────────────────────

export type DebugLogType = 'llm-request' | 'llm-response' | 'rag' | 'system' | 'error' | 'mcp';

/** 모든 로그 엔트리 공통 */
export interface BaseLogEntry {
	id: string;
	type: DebugLogType;
	timestamp: number; // Date.now()
}

// ─── LLM Request ────────────────────────────────

export interface LLMRequestLog extends BaseLogEntry {
	type: 'llm-request';
	provider: string;
	model: string;
	temperature: number;
	maxTokens: number;
	topP?: number;
	stream: boolean;
	systemPrompt: string;
	messages: Array<{ role: string; content: string }>;
	ragChunks?: RagChunkMeta[];
	estimatedInputTokens?: number;
}

// ─── LLM Response ───────────────────────────────

export interface LLMResponseLog extends BaseLogEntry {
	type: 'llm-response';
	requestId: string;
	model: string;
	content: string;
	durationMs: number;
	usage?: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
	};
	stopReason?: string;
}

// ─── RAG Search ─────────────────────────────────

export interface RagChunkMeta {
	filePath: string;
	score: number;
	preview: string;
	fullContent: string;
}

export interface RAGSearchLog extends BaseLogEntry {
	type: 'rag';
	query: string;
	topK: number;
	chunks: RagChunkMeta[];
	durationMs: number;
}

// ─── System / Error ─────────────────────────────

export interface SystemLog extends BaseLogEntry {
	type: 'system';
	event: string;
	message: string;
	meta?: Record<string, unknown>;
}

export interface ErrorLog extends BaseLogEntry {
	type: 'error';
	domain: string;
	message: string;
	stack?: string;
}

// ─── MCP ────────────────────────────────────────

export interface MCPLog extends BaseLogEntry {
	type: 'mcp';
	action: string;
	message: string;
	data?: unknown;
}

// ─── Union ──────────────────────────────────────

export type DebugLogEntry = LLMRequestLog | LLMResponseLog | RAGSearchLog | SystemLog | ErrorLog | MCPLog;
