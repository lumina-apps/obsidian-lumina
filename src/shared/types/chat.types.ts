export interface ContextAttachment {
	type: 'file' | 'folder' | 'selection' | 'active_note' | 'canvas' | 'tag' | 'url' | 'external_file';
	path: string;
	name: string;
	content?: string;
}

export interface ChatRagSource {
	filePath: string;
}

export interface UIChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	attachments?: ContextAttachment[];
	/** RAG 참조 문서 출처 */
	ragSources?: ChatRagSource[];
	isStreaming: boolean;
	timestamp: number;
	model?: string;
	/** 토큰 사용량 및 예상 비용 ($) */
	tokenUsage?: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
		estimatedCost?: number;
	};
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
}
