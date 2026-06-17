/**
 * indexer.ts
 *
 * 볼트의 마크다운 파일을 청킹 + 임베딩하여 벡터 인덱스를 관리합니다.
 *
 * 주요 기능:
 * - mtime 기반 증분 업데이트 (변경된 파일만 재인덱싱)
 * - CHUNK_EMBED_BATCH 단위로 임베딩 워커에 배치 전송
 * - JSON 형태로 .obsidian/plugins/lumina/storage/index.json에 영속화
 * - schemaVersion + modelName 조합으로 모델 변경 시 자동 무효화
 * - exclusions.ts를 통한 기본+커스텀 제외 경로 필터링
 *
 * ⚠️ 이 파일은 메인 스레드에서만 실행됩니다.
 *    Node.js fs 직접 사용 불가 → Obsidian vault.adapter API 사용.
 */

import { App, TFile } from 'obsidian';
import type { DocumentChunk } from '../../shared/types/rag.types';
import type { RagSettings } from '../../core/settings/settings.types';
import {
	setIndexingStatus,
	setTotalFiles,
	incrementProcessedBy,
	resetIndexing,
} from '../../core/store/ragStore';
import { debugLogger } from '../../shared/debugLogger';
import { loadIndex, saveIndex } from './indexPersistence';
import { getTargetFiles, detectDeletedPaths } from './fileFilter';
import { readAndPrepareFile } from './fileProcessor';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * 한 번에 워커에 보낼 최대 청크 수.
 * 값이 클수록 Worker 왕복 횟수가 줄어 전체 임베딩 속도가 빨라짐.
 */
const CHUNK_EMBED_BATCH = 64;
/** store 업데이트를 배치로 묶을 파일 수. 10,000개 이상 파일에서 UI 업데이트 폭주 방지 */
const PROGRESS_BATCH_SIZE = 20;
/**
 * 파일 읽기/청킹을 동시에 처리할 최대 파일 수.
 * I/O 대기 시간을 겹쳐 실행해 전체 인덱싱 시간을 단축함.
 * Worker는 여전히 1개이므로 메모리 부담 증가 없음.
 */
const FILE_READ_CONCURRENCY = 32;

// ─── VaultIndexer ─────────────────────────────────────────────────────────────

export class VaultIndexer {
	private readonly app: App;
	private embedFn: (texts: string[]) => Promise<number[][]>;
	private parseBinaryFn: (buffer: ArrayBuffer, ext: string) => Promise<string>;
	private settings: RagSettings;
	/** 현재 인덱싱에 사용 중인 모델명 */
	private modelName: string;

	/** 인덱싱된 청크 (메모리) */
	private chunks: DocumentChunk[] = [];
	/** 청크가 1개 이상 존재하는 파일 경로 Set — O(1) 존재 여부 확인 */
	private indexedPaths: Set<string> = new Set();
	/** 파일별 마지막 수정 시각 (증분 업데이트 추적) */
	private fileMtimes: Record<string, number> = {};
	/** 파일별 본문 해시 */
	private fileHashes: Record<string, number> = {};

	private isDestroyed: boolean = false;
	private currentProcessId: number = 0;

	constructor(
		app: App,
		embedFn: (texts: string[]) => Promise<number[][]>,
		parseBinaryFn: (buffer: ArrayBuffer, ext: string) => Promise<string>,
		settings: RagSettings,
		modelName: string,
	) {
		this.app = app;
		this.embedFn = embedFn;
		this.parseBinaryFn = parseBinaryFn;
		this.settings = settings;
		this.modelName = modelName;
	}

	// ─── Public API ──────────────────────────────────────────────────────────

	public destroy(): void {
		this.isDestroyed = true;
	}

	/** 현재 인덱싱된 청크 목록 (search.ts에서 사용) */
	get indexedChunks(): DocumentChunk[] {
		return this.chunks;
	}

	/** 인덱싱된 파일 수 */
	get indexedFileCount(): number {
		return Object.keys(this.fileMtimes).length;
	}

	/** 외부에서 임베딩 함수를 호출할 수 있도록 제공 */
	async embed(texts: string[]): Promise<number[][]> {
		return this.embedFn(texts);
	}

	/**
	 * 전체 볼트 재인덱싱 (기존 인덱스 완전히 교체).
	 * 초기화 버튼 or 강제 재인덱싱 시 사용.
	 */
	async indexVault(): Promise<void> {
		this.clearState();

		const files = getTargetFiles(this.app, this.settings);
		setTotalFiles(files.length);
		await this.processFiles(files);

		setIndexingStatus('ready', {
			totalFiles: files.length,
			processedFiles: files.length,
		});

		await this.persist();
	}

	/**
	 * 변경된 파일만 증분 업데이트.
	 * 기존 인덱스를 먼저 로드한 뒤, mtime이 다른 파일만 재인덱싱합니다.
	 * 모델명이 다르면 전체 재인덱싱으로 폴백합니다.
	 */
	async updateIndex(): Promise<void> {
		const loadResult = await loadIndex(this.app, this.modelName);

		if (loadResult.needsFullReindex) {
			// 스키마 또는 모델 변경 → 전체 재인덱싱
			this.clearState();
			await this.indexVault();
			return;
		}

		this.chunks = loadResult.chunks;
		this.indexedPaths = loadResult.indexedPaths;
		this.fileMtimes = loadResult.fileMtimes;
		this.fileHashes = loadResult.fileHashes;

		const files = getTargetFiles(this.app, this.settings);

		// [안전장치] 시작 시점에 옵시디언 캐시 문제로 파일 목록이 비어있을 수 있음.
		// 기존 인덱스에 파일이 존재하는데 읽어온 files가 0개라면 인덱스 초기화를 방지함.
		if (files.length === 0 && Object.keys(this.fileMtimes).length > 0) {
			debugLogger.logSystem('rag', '파일 목록 로드 지연으로 인덱스 초기화 방지.');
			setIndexingStatus('ready', {
				totalFiles: Object.keys(this.fileMtimes).length,
				processedFiles: Object.keys(this.fileMtimes).length,
			});
			return;
		}

		// 삭제된 파일 처리
		const currentPaths = new Set(files.map(f => f.path));
		const pathsToDelete = await detectDeletedPaths(
			this.app,
			currentPaths,
			Object.keys(this.fileMtimes),
		);

		if (pathsToDelete.size > 0) {
			this.removePaths(pathsToDelete);
		}

		// 변경된 파일 감지
		const changed = files.filter(f => {
			const prev = this.fileMtimes[f.path];
			return prev === undefined || f.stat.mtime !== prev;
		});

		if (changed.length === 0) {
			setIndexingStatus('ready', {
				totalFiles: files.length,
				processedFiles: files.length,
			});
			return;
		}

		setTotalFiles(changed.length);
		await this.processFiles(changed);

		setIndexingStatus('ready', {
			totalFiles: files.length,
			processedFiles: files.length,
		});

		await this.persist();
	}

	/** 인덱스 전체 초기화 (디스크 + 메모리) */
	async resetIndex(): Promise<void> {
		this.clearState();
		resetIndexing();
		await this.persist();
	}

	// ─── Internals ───────────────────────────────────────────────────────────

	private clearState(): void {
		this.chunks = [];
		this.indexedPaths = new Set();
		this.fileMtimes = {};
		this.fileHashes = {};
	}

	private removePaths(paths: Set<string>): void {
		this.chunks = this.chunks.filter(c => !paths.has(c.path));
		paths.forEach(p => {
			this.indexedPaths.delete(p);
			delete this.fileMtimes[p];
			delete this.fileHashes[p];
		});
	}

	/**
	 * 파일 목록을 FILE_READ_CONCURRENCY 단위로 병렬 읽기/청킹한 뒤,
	 * 수집된 청크를 CHUNK_EMBED_BATCH 단위로 일괄 임베딩합니다.
	 *
	 * [개선 전] 파일1 읽기 → 임베딩 → 파일2 읽기 → 임베딩 → ...
	 * [개선 후] (파일1,2,...32 동시 읽기) → 수집된 청크 일괄 임베딩 → 반복
	 *
	 * Worker는 여전히 1개이므로 모델 메모리 부담은 동일하며,
	 * I/O 대기 시간을 겹쳐 실행하는 것만으로 전체 소요 시간이 크게 단축됩니다.
	 */
	private async processFiles(files: TFile[]): Promise<void> {
		this.currentProcessId++;
		const processId = this.currentProcessId;
		let progressCounter = 0;

		const { chunkSize, chunkOverlap } = this.settings;

		for (let batchStart = 0; batchStart < files.length; batchStart += FILE_READ_CONCURRENCY) {
			if (this.isDestroyed || this.currentProcessId !== processId) return;

			const fileBatch = files.slice(batchStart, batchStart + FILE_READ_CONCURRENCY);

			// ① 파일 읽기 + 청킹을 FILE_READ_CONCURRENCY 단위로 병렬 실행
			const readResults = await Promise.allSettled(
				fileBatch.map(file =>
					readAndPrepareFile(
						file,
						this.parseBinaryFn,
						chunkSize,
						chunkOverlap,
						this.fileHashes,
						this.indexedPaths,
						f => this.app.vault.read(f),
						f => this.app.vault.readBinary(f),
					),
				),
			);

			// ② 결과 분류: 에러 / 스킵 / 임베딩 필요
			const toEmbedFiles: TFile[] = [];
			const toEmbedChunks: DocumentChunk[] = [];
			const toEmbedHashes: number[] = [];

			for (let i = 0; i < fileBatch.length; i++) {
				const file = fileBatch[i];
				const result = readResults[i];

				if (result.status === 'rejected') {
					debugLogger.logError(
						'rag',
						result.reason instanceof Error
							? result.reason
							: new Error(`파일 인덱싱 실패 (mtime 기록됨): ${file.path}`),
					);
					this.fileMtimes[file.path] = file.stat.mtime;
				} else {
					const { chunks, contentHash, skip } = result.value;
					if (skip) {
						// 본문 해시 동일 → mtime만 갱신, 임베딩 생략
						this.fileMtimes[file.path] = file.stat.mtime;
					} else if (chunks.length === 0) {
						// 빈 파일 → mtime만 기록
						this.fileMtimes[file.path] = file.stat.mtime;
					} else {
						// 임베딩 필요: 기존 청크 제거 후 큐에 추가
						this.chunks = this.chunks.filter(c => c.path !== file.path);
						this.indexedPaths.delete(file.path);
						toEmbedFiles.push(file);
						toEmbedChunks.push(...chunks);
						toEmbedHashes.push(contentHash);
					}
				}
			}

			// ③ 수집된 모든 청크를 CHUNK_EMBED_BATCH 단위로 일괄 임베딩
			if (toEmbedChunks.length > 0 && !this.isDestroyed && this.currentProcessId === processId) {
				try {
					for (let i = 0; i < toEmbedChunks.length; i += CHUNK_EMBED_BATCH) {
						if (this.isDestroyed || this.currentProcessId !== processId) return;
						const batch = toEmbedChunks.slice(i, i + CHUNK_EMBED_BATCH);
						const embeddings = await this.embedFn(batch.map(c => c.text));
						for (let j = 0; j < batch.length; j++) {
							batch[j].embedding = embeddings[j];
						}
					}
					// 임베딩 완료 → 인덱스에 추가 및 메타데이터 갱신
					this.chunks.push(...toEmbedChunks);
					for (let i = 0; i < toEmbedFiles.length; i++) {
						const file = toEmbedFiles[i];
						this.indexedPaths.add(file.path);
						this.fileHashes[file.path] = toEmbedHashes[i];
						this.fileMtimes[file.path] = file.stat.mtime;
					}
				} catch (embedErr) {
					// 임베딩 실패 시 mtime만 기록 → 다음 실행에서 재시도
					debugLogger.logError(
						'rag',
						embedErr instanceof Error ? embedErr : new Error(`배치 임베딩 실패: ${embedErr}`),
					);
					for (const file of toEmbedFiles) {
						this.fileMtimes[file.path] = file.stat.mtime;
					}
				}
			}

			// ④ 진행률 업데이트 (배치 단위)
			progressCounter += fileBatch.length;
			if (progressCounter >= PROGRESS_BATCH_SIZE) {
				incrementProcessedBy(progressCounter);
				progressCounter = 0;
			}
		}

		// 남은 카운터 처리
		if (progressCounter > 0) {
			incrementProcessedBy(progressCounter);
		}
	}

	private async persist(): Promise<void> {
		await saveIndex(
			this.app,
			this.modelName,
			this.chunks,
			this.fileMtimes,
			this.fileHashes,
		);
	}
}