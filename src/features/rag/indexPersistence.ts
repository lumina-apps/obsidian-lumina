/**
 * RAG 인덱스의 디스크 영속화 담당.
 * index.json에 JSON 저장/로드, schemaVersion+modelName 변경 시 자동 무효화,
 * checkpoint.json으로 중간 저장 및 재개를 지원합니다.
 */

import { App, normalizePath } from 'obsidian';
import type { DocumentChunk, PersistedIndex, IndexingCheckpoint } from '../../shared/types/rag.types';
import { SCHEMA_VERSION } from '../../shared/types/rag.types';
import { debugLogger } from '../../shared/debugLogger';

/** 플러그인 스토리지 경로 */
const STORAGE_SUBPATH = 'plugins/lumina/storage';

export interface LoadResult {
	chunks: DocumentChunk[];
	indexedPaths: Set<string>;
	fileMtimes: Record<string, number>;
	fileHashes: Record<string, number>;
	/** 스키마/모델 변경 시 전체 재인덱싱 필요 */
	needsFullReindex: boolean;
}

/**
 * 디스크에서 기존 인덱스를 로드합니다.
 * 최초 실행 시 빈 상태, needsFullReindex=true면 전체 재인덱싱 필요.
 */
export async function loadIndex(
	app: App,
	currentModelName: string,
): Promise<LoadResult> {
	const indexPath = normalizePath(
		`${app.vault.configDir}/${STORAGE_SUBPATH}/index.json`,
	);

	const emptyResult: LoadResult = {
		chunks: [],
		indexedPaths: new Set(),
		fileMtimes: {},
		fileHashes: {},
		needsFullReindex: false,
	};

	try {
		const exists = await app.vault.adapter.exists(indexPath);
		if (!exists) return emptyResult;

		const raw = await app.vault.adapter.read(indexPath);
		const data = JSON.parse(raw) as PersistedIndex;

		if (data.version !== SCHEMA_VERSION || data.modelName !== currentModelName) {
			debugLogger.logSystem(
				'rag',
				`인덱스 무효화: schema(${data.version}→${SCHEMA_VERSION}) or 모델 변경(${data.modelName}→${currentModelName}). 전체 재인덱싱 시작.`,
			);
			return { ...emptyResult, needsFullReindex: true };
		}

		const chunks = data.chunks ?? [];
		return {
			chunks,
			indexedPaths: new Set(chunks.map(c => c.path)),
			fileMtimes: data.fileMtimes ?? {},
			fileHashes: data.fileHashes ?? {},
			needsFullReindex: false,
		};
	} catch {
		return emptyResult;
	}
}

/** 인덱스를 JSON으로 직렬화하여 디스크에 저장합니다. */
export async function saveIndex(
	app: App,
	modelName: string,
	chunks: DocumentChunk[],
	fileMtimes: Record<string, number>,
	fileHashes: Record<string, number>,
): Promise<void> {
	const storageDirPath = normalizePath(
		`${app.vault.configDir}/${STORAGE_SUBPATH}`,
	);
	const indexPath = normalizePath(
		`${app.vault.configDir}/${STORAGE_SUBPATH}/index.json`,
	);

	try {
		if (!(await app.vault.adapter.exists(storageDirPath))) {
			await app.vault.adapter.mkdir(storageDirPath);
		}

		// embedding은 IndexedDB에서 별도 관리되므로 JSON에서 제외
		const chunksWithoutEmbedding = chunks.map(({ embedding, ...rest }) => rest);

		const data: PersistedIndex = {
			version: SCHEMA_VERSION,
			modelName,
			chunks: chunksWithoutEmbedding,
			fileMtimes,
			fileHashes,
		};

		await app.vault.adapter.write(indexPath, JSON.stringify(data));
	} catch (err) {
		debugLogger.logError(
			'rag',
			err instanceof Error ? err : new Error(`인덱스 저장 실패: ${err}`),
		);
	}
}

// ─── Checkpoint (Resume) ─────────────────────────────────────────────────────

/**
 * 인덱싱 중간 체크포인트를 저장합니다.
 * 처리 완료된 파일 경로를 기록하여 재시작 시 이어서 인덱싱 가능하게 합니다.
 */
export async function saveCheckpoint(
	app: App,
	processedPaths: string[],
	totalFiles: number,
	startedAt: number,
): Promise<void> {
	const storageDirPath = normalizePath(
		`${app.vault.configDir}/${STORAGE_SUBPATH}`,
	);
	const checkpointPath = normalizePath(
		`${app.vault.configDir}/${STORAGE_SUBPATH}/checkpoint.json`,
	);

	try {
		if (!(await app.vault.adapter.exists(storageDirPath))) {
			await app.vault.adapter.mkdir(storageDirPath);
		}

		const checkpoint: IndexingCheckpoint = {
			processedPaths,
			totalFiles,
			startedAt,
			lastSavedAt: Date.now(),
		};

		await app.vault.adapter.write(checkpointPath, JSON.stringify(checkpoint));
	} catch (err) {
		debugLogger.logError(
			'rag',
			err instanceof Error ? err : new Error(`체크포인트 저장 실패: ${err}`),
		);
	}
}

/** 디스크에서 체크포인트를 로드합니다. 없으면 null. */
export async function loadCheckpoint(app: App): Promise<IndexingCheckpoint | null> {
	const checkpointPath = normalizePath(
		`${app.vault.configDir}/${STORAGE_SUBPATH}/checkpoint.json`,
	);

	try {
		const exists = await app.vault.adapter.exists(checkpointPath);
		if (!exists) return null;

		const raw = await app.vault.adapter.read(checkpointPath);
		const checkpoint = JSON.parse(raw) as IndexingCheckpoint;

		if (
			!Array.isArray(checkpoint.processedPaths) ||
			typeof checkpoint.totalFiles !== 'number' ||
			typeof checkpoint.startedAt !== 'number'
		) {
			return null;
		}

		return checkpoint;
	} catch {
		return null;
	}
}

/** 체크포인트 파일을 삭제합니다. 인덱싱 완료 후 호출. */
export async function deleteCheckpoint(app: App): Promise<void> {
	const checkpointPath = normalizePath(
		`${app.vault.configDir}/${STORAGE_SUBPATH}/checkpoint.json`,
	);

	try {
		const exists = await app.vault.adapter.exists(checkpointPath);
		if (exists) {
			await app.vault.adapter.remove(checkpointPath);
		}
	} catch {
		// 삭제 실패는 무시
	}
}
