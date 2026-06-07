export interface ContextAttachment {
	type: 'file' | 'folder' | 'selection' | 'active_note' | 'canvas' | 'tag' | 'url' | 'external_file';
	path: string;     // 파일 경로, 폴더 경로, 태그 이름, 또는 URL
	name: string;     // UI에 표시될 이름 (칩에 보임)
	content?: string; // 실제 텍스트 내용 (전송 시점에 채워질 수 있음)
}

export interface ChatRagSource {
	filePath: string;
}

export interface UIChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	/** 첨부된 컨텍스트 목록 */
	attachments?: ContextAttachment[];
	/** RAG로 가져온 참조 문서 출처 목록 (어시스턴트 메시지에만) */
	ragSources?: ChatRagSource[];
	/** 스트리밍 진행 중 여부 */
	isStreaming: boolean;
	timestamp: number;
	/** 연결된 프로바이더/모델 (어시스턴트 메시지에만) */
	model?: string;
	/** 응답 시 소모된 토큰 정보 및 예상 금액 (어시스턴트 메시지에만) */
	tokenUsage?: {
		inputTokens: number;
		outputTokens: number;
		totalTokens: number;
		estimatedCost?: number; // 달러($) 단위
	};
}

// ─── Chat Session ─────────────────────────────────────────────────────────────

export interface ChatSession {
	id: string;
	/** 첫 사용자 메시지에서 자동 생성 */
	title: string;
	messages: UIChatMessage[];
	createdAt: number;
	updatedAt: number;
	/** 이 세션에서 사용한 프로바이더 ID */
	providerId: string;
	/** 이 세션에서 사용한 모델 ID */
	modelId: string;
}
