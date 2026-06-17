// ─── Document ────────────────────────────────────────────────────────────────

export interface RawDocument {
	/** 볼트 내 상대 경로 (예: Notes/Daily/2024-01-01.md) */
	path: string;
	/** 마크다운 원문 */
	content: string;
	/** 파일 최종 수정 시각 (ms) */
	mtime: number;
}

export interface DocumentChunk {
	/** 청크 고유 ID: `{path}::chunk_{index}` */
	id: string;
	/** 원본 파일 경로 */
	path: string;
	/** 청크 텍스트 */
	text: string;
	/** 청크 인덱스 (0-based) */
	chunkIndex: number;
	/** 임베딩 벡터 (인덱싱 완료 후 채워짐) */
	embedding?: number[];
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/**
 * 인덱스 파일 스키마 버전.
 * 청크 구조 변경 시 증가 → 기존 인덱스 자동 무효화.
 */
export const SCHEMA_VERSION = 2;

export interface PersistedIndex {
	/** 스키마 버전 */
	version: number;
	/** 인덱싱에 사용된 임베딩 모델명 — 모델 변경 시 자동 무효화 */
	modelName: string;
	chunks: DocumentChunk[];
	/** 파일 경로 → 마지막 수정 시각 (ms) — 증분 업데이트 추적 */
	fileMtimes: Record<string, number>;
	/** 파일 경로 → 텍스트 본문 해시 — mtime이 변경되어도 본문이 같으면 임베딩 건너뜀 */
	fileHashes?: Record<string, number>;
}

// ─── Search ──────────────────────────────────────────────────────────────────

export interface SearchResult {
	chunk: DocumentChunk;
	/** 하이브리드 최종 점수 (또는 코사인 유사도 점수) */
	score: number;
	/** 벡터 기반 코사인 유사도 점수 */
	vectorScore?: number;
	/** BM25 점수 */
	bm25Score?: number;
}

// ─── Indexing State ──────────────────────────────────────────────────────────

export type IndexingStatus =
	| 'idle'
	| 'loading-model'
	| 'indexing'
	| 'ready'
	| 'error';

export interface IndexingState {
	status: IndexingStatus;
	/** 전체 파일 수 */
	totalFiles: number;
	/** 처리 완료 파일 수 */
	processedFiles: number;
	/** 인덱싱 시작 시각 (ms) — 예상 잔여 시간 계산용 */
	startTime?: number;
	/** 오류 메시지 (status='error' 일 때) */
	errorMessage?: string;
}

// ─── Worker Message Protocol ─────────────────────────────────────────────────

/** 메인 스레드 → 워커 */
export type WorkerRequest =
	| {
			type: 'init';
			/** 모델 캐시 저장 경로 (절대경로) */
			cacheDir: string;
			/** 사용할 임베딩 모델 이름 */
			modelName: string;
			/** 플러그인 로컬 디렉토리 URL (옵션) */
			pluginDir?: string;
	  }
	| {
			type: 'embed';
			/** 요청 추적용 ID */
			requestId: string;
			/** 임베딩할 텍스트 배열 */
			texts: string[];
	  }
	| {
			type: 'parse';
			requestId: string;
			buffer: ArrayBuffer;
			ext: string;
	  }
	| { type: 'terminate' };

/** 워커 → 메인 스레드 */
export type WorkerResponse =
	| { type: 'ready' }
	| {
			type: 'progress';
			/** 모델 로딩 진행률 (0 ~ 1) */
			progress: number;
			status: string;
	  }
	| {
			type: 'result';
			requestId: string;
			/** texts 순서와 동일한 임베딩 벡터 배열 */
			embeddings: number[][];
	  }
	| {
			type: 'parseResult';
			requestId: string;
			text: string;
	  }
	| {
			type: 'error';
			requestId: string;
			message: string;
	  };

// ─── Worker Abstraction ──────────────────────────────────────────────────────

/** 메인 스레드와 워커 스레드 간 공통 인터페이스 */
export interface IWorker {
	addEventListener(type: string, listener: (evt: MessageEvent) => void): void;
	terminate(): void;
	postMessage(message: unknown, transfer?: Transferable[]): void;
}

