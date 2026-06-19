// ─── Document ────────────────────────────────────

export interface RawDocument {
	path: string;
	content: string;
	mtime: number;
}

export interface ParentChunk {
	id: string;
	path: string;
	text: string;
	chunkIndex: number;
}

export interface ChildChunk {
	id: string;
	parentId: string;
	path: string;
	text: string;
	chunkIndex: number;
	embedding?: number[] | Float32Array;
}

// ─── Persistence ─────────────────────────────────

/** 스키마 버전. 청크 구조 변경 시 증가 → 기존 인덱스 자동 무효화 */
export const SCHEMA_VERSION = 4;

export interface PersistedIndex {
	version: number;
	modelName: string;
	chunks: ParentChunk[];
	childChunks?: ChildChunk[];
	fileMtimes: Record<string, number>;
	fileHashes?: Record<string, number>;
}

// ─── Search ──────────────────────────────────────

export interface SearchResult {
	chunk: ParentChunk;
	score: number;
	vectorScore?: number;
	bm25Score?: number;
}

// ─── Indexing State ──────────────────────────────

export type IndexingStatus =
	| 'idle'
	| 'loading-model'
	| 'indexing'
	| 'ready'
	| 'error';

export interface IndexingState {
	status: IndexingStatus;
	totalFiles: number;
	processedFiles: number;
	startTime?: number;
	errorMessage?: string;
}

// ─── Worker Message Protocol ─────────────────────

/** 메인 스레드 → 워커 */
export type WorkerRequest =
	| {
			type: 'init';
			cacheDir: string;
			modelName: string;
			pluginDir?: string;
	  }
	| {
			type: 'embed';
			requestId: string;
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
			progress: number;
			status: string;
	  }
	| {
			type: 'result';
			requestId: string;
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

// ─── Indexing Checkpoint ─────────────────────────

export interface IndexingCheckpoint {
	processedPaths: string[];
	totalFiles: number;
	startedAt: number;
	lastSavedAt: number;
}

// ─── Worker Abstraction ──────────────────────────

export interface IWorker {
	addEventListener(type: string, listener: (evt: MessageEvent) => void): void;
	terminate(): void;
	postMessage(message: unknown, transfer?: Transferable[]): void;
}

// ─── Indexer Type Aliases ────────────────────────

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

export type ParseBinaryFn = (buffer: ArrayBuffer, ext: string) => Promise<string>;

// ─── Indexer In-Memory State ─────────────────────

export interface IndexState {
	chunks: ParentChunk[];
	indexedPaths: Set<string>;
	fileMtimes: Record<string, number>;
	fileHashes: Record<string, number>;
}

