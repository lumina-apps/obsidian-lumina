/**
 * indexPersistence.ts
 *
 * RAG 인덱스의 디스크 영속화를 담당합니다.
 *
 * - JSON 형태로 .obsidian/plugins/lumina/storage/index.json에 저장/로드
 * - schemaVersion + modelName 조합으로 모델 변경 시 자동 무효화
 * - checkpoint.json을 통한 인덱싱 중간 저장 및 재개 지원
 */

import { App, normalizePath } from 'obsidian';
import type { DocumentChunk, PersistedIndex, IndexingCheckpoint } from '../../shared/types/rag.types';
import { SCHEMA_VERSION } from '../../shared/types/rag.types';
import { debugLogger } from '../../shared/debugLogger';

/** 플러그인 스토리지 경로 (볼트 configDir 기준 상대경로) */
const STORAGE_SUBPATH = 'plugins/lumina/storage';

export interface LoadResult {
	chunks: DocumentChunk[];
	indexedPaths: Set<string>;
	fileMtimes: Record<string, number>;
	fileHashes: Record<string, number>;
	/** true = 스키마/모델 변경으로 전체 재인덱싱 필요 */
	needsFullReindex: boolean;
}

/**
 * 디스크에서 기존 인덱스를 로드합니다.
 *
 * @returns 로드된 인덱스 데이터. 최초 실행 시 빈 상태 반환.
 *          needsFullReindex=true 이면 스키마 버전 또는 모델명 불일치로 전체 재인덱싱 필요.
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
		debugLogger.logSystem('rag', '인덱스 로드 실패 (최초 실행이면 정상)');
		return emptyResult;
	}
}

/**
 * 인덱스를 JSON으로 직렬화하여 디스크에 저장합니다.
 */
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

		const data: PersistedIndex = {
			version: SCHEMA_VERSION,
			modelName,
			chunks,
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
 * 옵시디언 종료 후 재시작 시 이어서 인덱싱할 수 있도록 처리 완료된 파일 경로를 기록합니다.
 *
 * @param processedPaths 현재까지 처리 완료된 파일 경로 목록
 * @param totalFiles     전체 대상 파일 수
 * @param startedAt      인덱싱 시작 시각 (ms)
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
		// 체크포인트 저장 실패는 치명적이지 않음 — 인덱싱은 계속 진행
		debugLogger.logError(
			'rag',
			err instanceof Error ? err : new Error(`체크포인트 저장 실패: ${err}`),
		);
	}
}

/**
 * 디스크에서 체크포인트를 로드합니다.
 *
 * @returns 저장된 체크포인트, 없으면 null
 */
export async function loadCheckpoint(app: App): Promise<IndexingCheckpoint | null> {
	const checkpointPath = normalizePath(
		`${app.vault.configDir}/${STORAGE_SUBPATH}/checkpoint.json`,
	);

	try {
		const exists = await app.vault.adapter.exists(checkpointPath);
		if (!exists) return null;

		const raw = await app.vault.adapter.read(checkpointPath);
		const checkpoint = JSON.parse(raw) as IndexingCheckpoint;

		// 기본 필드 검증
		if (
			!Array.isArray(checkpoint.processedPaths) ||
			typeof checkpoint.totalFiles !== 'number' ||
			typeof checkpoint.startedAt !== 'number'
		) {
			debugLogger.logSystem('rag', '체크포인트 데이터 손상 → 무시');
			return null;
		}

		return checkpoint;
	} catch {
		debugLogger.logSystem('rag', '체크포인트 로드 실패 (없으면 정상)');
		return null;
	}
}

/**
 * 체크포인트 파일을 삭제합니다.
 * 인덱싱이 완전히 완료된 후 호출하여 더 이상 이어할 필요가 없음을 표시합니다.
 */
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
		// 삭제 실패는 무시 — 다음 인덱싱 시 체크포인트 검증에서 처리됨
	}
}