/**
 * indexPersistence.ts
 *
 * RAG 인덱스의 디스크 영속화를 담당합니다.
 *
 * - JSON 형태로 .obsidian/plugins/lumina/storage/index.json에 저장/로드
 * - schemaVersion + modelName 조합으로 모델 변경 시 자동 무효화
 */

import { App, normalizePath } from 'obsidian';
import type { DocumentChunk, PersistedIndex } from '../../shared/types/rag.types';
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