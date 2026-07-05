/**
 * RAG 인덱스의 디스크 영속화 담당.
 * index.json에 JSON 저장/로드, schemaVersion+modelName 변경 시 자동 무효화,
 * checkpoint.json으로 중간 저장 및 재개를 지원합니다.
 */

import { App, normalizePath } from 'obsidian';
import type { ParentChunk, ChildChunk, PersistedIndex, IndexingCheckpoint } from '../../shared/types/rag.types';
import { SCHEMA_VERSION } from '../../shared/types/rag.types';
import { debugLogger } from '../../shared/debugLogger';

/** 플러그인 스토리지 경로 */
const STORAGE_SUBPATH = 'plugins/lumina/storage';

export interface LoadResult {
	chunks: ParentChunk[];
	childChunks: ChildChunk[];
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
	projectId: string,
): Promise<LoadResult> {
	const filename = projectId ? `index_${projectId}.json` : 'index.json';
	const indexPath = normalizePath(
		`${app.vault.configDir}/${STORAGE_SUBPATH}/${filename}`,
	);

	const emptyResult: LoadResult = {
		chunks: [],
		childChunks: [],
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
		const childChunks = data.childChunks ?? [];
		return {
			chunks,
			childChunks,
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
	chunks: ParentChunk[],
	childChunks: ChildChunk[],
	fileMtimes: Record<string, number>,
	fileHashes: Record<string, number>,
	projectId: string,
): Promise<void> {
	const storageDirPath = normalizePath(
		`${app.vault.configDir}/${STORAGE_SUBPATH}`,
	);
	const filename = projectId ? `index_${projectId}.json` : 'index.json';
	const indexPath = normalizePath(
		`${app.vault.configDir}/${STORAGE_SUBPATH}/${filename}`,
	);

	try {
		if (!(await app.vault.adapter.exists(storageDirPath))) {
			await app.vault.adapter.mkdir(storageDirPath);
		}

		// ParentChunk는 이미 embedding이 없고, ChildChunk의 embedding은 제외
		const childChunksWithoutEmbedding = childChunks.map(({ embedding, ...rest }) => rest);

		const data: PersistedIndex = {
			version: SCHEMA_VERSION,
			modelName,
			chunks,
			childChunks: childChunksWithoutEmbedding,
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
	projectId: string,
): Promise<void> {
	const storageDirPath = normalizePath(
		`${app.vault.configDir}/${STORAGE_SUBPATH}`,
	);
	const filename = projectId ? `checkpoint_${projectId}.json` : 'checkpoint.json';
	const checkpointPath = normalizePath(
		`${app.vault.configDir}/${STORAGE_SUBPATH}/${filename}`,
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
export async function loadCheckpoint(app: App, projectId: string): Promise<IndexingCheckpoint | null> {
	const filename = projectId ? `checkpoint_${projectId}.json` : 'checkpoint.json';
	const checkpointPath = normalizePath(
		`${app.vault.configDir}/${STORAGE_SUBPATH}/${filename}`,
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
export async function deleteCheckpoint(app: App, projectId: string): Promise<void> {
	const filename = projectId ? `checkpoint_${projectId}.json` : 'checkpoint.json';
	const checkpointPath = normalizePath(
		`${app.vault.configDir}/${STORAGE_SUBPATH}/${filename}`,
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
