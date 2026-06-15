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

import { App, TFile, normalizePath } from 'obsidian';
import type { DocumentChunk, RawDocument } from '../../shared/types/rag.types';
import type { RagSettings } from '../../core/settings/settings.types';
import {
	setIndexingStatus,
	setTotalFiles,
	incrementProcessed,
	incrementProcessedBy,
	resetIndexing,
} from '../../core/store/ragStore';
import { isExcluded, isIncluded } from './exclusions';
import { DocumentParserRouter, SUPPORTED_EXTENSIONS } from './parsers/DocumentParserRouter';
import { debugLogger } from '../../shared/debugLogger';

/** 간단하고 빠른 문자열 해시 함수 (DJB2) */
function hashString(str: string): number {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash) + str.charCodeAt(i); // hash * 33 + c
	}
	return hash >>> 0;
}

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
/**
 * 인덱스 파일 스키마 버전.
 * 청크 구조 변경 시 증가 → 기존 인덱스 자동 무효화.
 */
const SCHEMA_VERSION = 2;
/** 플러그인 스토리지 경로 (볼트 configDir 기준 상대경로) */
const STORAGE_SUBPATH = 'plugins/lumina/storage';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PersistedIndex {
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

// ─── VaultIndexer ─────────────────────────────────────────────────────────────

export class VaultIndexer {
	private app: App;
	private embedFn: (texts: string[]) => Promise<number[][]>;
	private parseBinaryFn: (buffer: ArrayBuffer, ext: string) => Promise<string>;
	private settings: RagSettings;
	/** 현재 인덱싱에 사용 중인 모델명 */
	private modelName: string;

	/** 인덱싱된 청크 (메모리) */
	private _chunks: DocumentChunk[] = [];
	/** 청크가 1개 이상 존재하는 파일 경로 Set — O(1) 존재 여부 확인 */
	private _indexedPaths: Set<string> = new Set();
	/** 파일별 마지막 수정 시각 (증분 업데이트 추적) */
	private fileMtimes: Record<string, number> = {};
	/** 파일별 본문 해시 */
	private fileHashes: Record<string, number> = {};

	private isDestroyed: boolean = false;
	private currentProcessId: number = 0;

	private readonly storageDirPath: string;
	private readonly indexPath: string;

	constructor(
		app: App,
		embedFn: (texts: string[]) => Promise<number[][]>,
		parseBinaryFn: (buffer: ArrayBuffer, ext: string) => Promise<string>,
		settings: RagSettings,
		modelName: string
	) {
		this.app = app;
		this.embedFn = embedFn;
		this.parseBinaryFn = parseBinaryFn;
		this.settings = settings;
		this.modelName = modelName;
		this.storageDirPath = normalizePath(
			`${app.vault.configDir}/${STORAGE_SUBPATH}`,
		);
		this.indexPath = normalizePath(
			`${app.vault.configDir}/${STORAGE_SUBPATH}/index.json`,
		);
	}

	// ─── Public API ──────────────────────────────────────────────────────────

	public destroy(): void {
		this.isDestroyed = true;
	}

	/** 현재 인덱싱된 청크 목록 (search.ts에서 사용) */
	get indexedChunks(): DocumentChunk[] {
		return this._chunks;
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
		this._chunks = [];
		this._indexedPaths = new Set();
		this.fileMtimes = {};
		this.fileHashes = {};

		const files = this.getTargetFiles();
		setTotalFiles(files.length);
		await this.processFiles(files);

		setIndexingStatus('ready', {
			totalFiles: files.length,
			processedFiles: files.length,
		});

		await this.saveIndex();
	}

	/**
	 * 변경된 파일만 증분 업데이트.
	 * 기존 인덱스를 먼저 로드한 뒤, mtime이 다른 파일만 재인덱싱합니다.
	 * 모델명이 다르면 전체 재인덱싱으로 폴백합니다.
	 */
	async updateIndex(): Promise<void> {
		await this.loadIndex();

		const files = this.getTargetFiles();

		// [안전장치] 시작 시점에 옵시디언 캐시 문제로 파일 목록이 비어있을 수 있음.
		// 기존 인덱스에 파일이 존재하는데 읽어온 files가 0개라면 인덱스 초기화를 방지함.
		if (files.length === 0 && Object.keys(this.fileMtimes).length > 0) {
			debugLogger.logSystem('rag', '파일 목록 로드 지연으로 인덱스 초기화 방지.');
			setIndexingStatus('ready', { 
				totalFiles: Object.keys(this.fileMtimes).length,
				processedFiles: Object.keys(this.fileMtimes).length 
			});
			return;
		}

		// 삭제된 파일 처리 (볼트에서 제거되었지만 인덱스에 남아있는 파일)
		const currentPaths = new Set(files.map(f => f.path));
		const pathsToDelete = new Set<string>();
		
		for (const path of Object.keys(this.fileMtimes)) {
			if (!currentPaths.has(path)) {
				// 옵시디언 캐시 로딩 지연으로 인해 누락된 것일 수 있으므로 실제 존재 여부 확인
				const actuallyExists = await this.app.vault.adapter.exists(path);
				if (!actuallyExists) {
					pathsToDelete.add(path);
					delete this.fileMtimes[path];
					delete this.fileHashes[path];
				}
			}
		}

		if (pathsToDelete.size > 0) {
			this._chunks = this._chunks.filter(c => !pathsToDelete.has(c.path));
			pathsToDelete.forEach(p => this._indexedPaths.delete(p));
		}

		// 변경된 파일 감지
		const changed = files.filter(f => {
			const prev = this.fileMtimes[f.path];
			return prev === undefined || f.stat.mtime !== prev;
		});

		if (changed.length === 0) {
			setIndexingStatus('ready', { 
				totalFiles: files.length,
				processedFiles: files.length 
			});
			return;
		}

		setTotalFiles(changed.length);
		await this.processFiles(changed);

		setIndexingStatus('ready', {
			totalFiles: files.length,
			processedFiles: files.length,
		});

		await this.saveIndex();
	}

	/** 디스크에서 기존 인덱스 로드 (최초 실행 시 파일 없으면 빈 상태 유지) */
	async loadIndex(): Promise<void> {
		try {
			const exists = await this.app.vault.adapter.exists(this.indexPath);
			if (!exists) return;

			const raw = await this.app.vault.adapter.read(this.indexPath);
			const data = JSON.parse(raw) as PersistedIndex;

			// 스키마 버전 또는 모델명이 다르면 인덱스 무효화 → 전체 재인덱싱
			if (data.version !== SCHEMA_VERSION || data.modelName !== this.modelName) {
				debugLogger.logSystem('rag', `인덱스 무효화: schema(${data.version}→${SCHEMA_VERSION}) or 모델 변경(${data.modelName}→${this.modelName}). 전체 재인덱싱 시작.`);
				this._chunks = [];
				this._indexedPaths = new Set();
				this.fileMtimes = {};
				this.fileHashes = {};
				return;
			}

			this._chunks = data.chunks ?? [];
			this._indexedPaths = new Set(this._chunks.map(c => c.path));
			this.fileMtimes = data.fileMtimes ?? {};
			this.fileHashes = data.fileHashes ?? {};
		} catch {
			debugLogger.logSystem('rag', '인덱스 로드 실패 (최초 실행이면 정상)');
		}
	}

	/** 인덱스 전체 초기화 (디스크 + 메모리) */
	async resetIndex(): Promise<void> {
		this._chunks = [];
		this._indexedPaths = new Set();
		this.fileMtimes = {};
		this.fileHashes = {};
		resetIndexing();
		await this.saveIndex();
	}

	// ─── Internals ───────────────────────────────────────────────────────────

	private getTargetFiles(): TFile[] {
		const { excludedPaths, includedPaths } = this.settings;
		const configDir = this.app.vault.configDir;
		const finalExcludedPaths = [...excludedPaths];
		if (configDir && !finalExcludedPaths.includes(configDir)) {
			finalExcludedPaths.push(configDir);
		}
		
		// 전체 파일 중 지원되는 확장자만 필터링
		const files = this.app.vault.getFiles().filter(f => {
			return SUPPORTED_EXTENSIONS.has(f.extension.toLowerCase());
		});

		// exclusions.ts의 isIncluded, isExcluded로 화이트리스트/블랙리스트 동시 적용
		return files.filter(f => isIncluded(f.path, includedPaths) && !isExcluded(f.path, finalExcludedPaths));
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

		for (let batchStart = 0; batchStart < files.length; batchStart += FILE_READ_CONCURRENCY) {
			if (this.isDestroyed || this.currentProcessId !== processId) return;

			const fileBatch = files.slice(batchStart, batchStart + FILE_READ_CONCURRENCY);

			// ① 파일 읽기 + 청킹을 FILE_READ_CONCURRENCY 단위로 병렬 실행
			const readResults = await Promise.allSettled(
				fileBatch.map(file => this.readAndPrepareFile(file)),
			);

			// ② 결과 분류: 에러 / 스킵 / 임베딩 필요
			type PendingEmbed = { file: TFile; chunks: DocumentChunk[]; contentHash: number };
			const toEmbed: PendingEmbed[] = [];

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
						this._chunks = this._chunks.filter(c => c.path !== file.path);
						this._indexedPaths.delete(file.path);
						toEmbed.push({ file, chunks, contentHash });
					}
				}
			}

			// ③ 수집된 모든 청크를 CHUNK_EMBED_BATCH 단위로 일괄 임베딩
			if (toEmbed.length > 0 && !this.isDestroyed && this.currentProcessId === processId) {
				const allChunks = toEmbed.flatMap(e => e.chunks);
				try {
					for (let i = 0; i < allChunks.length; i += CHUNK_EMBED_BATCH) {
						if (this.isDestroyed || this.currentProcessId !== processId) return;
						const batch = allChunks.slice(i, i + CHUNK_EMBED_BATCH);
						const embeddings = await this.embedFn(batch.map(c => c.text));
						for (let j = 0; j < batch.length; j++) {
							batch[j].embedding = embeddings[j];
						}
					}
					// 임베딩 완료 → 인덱스에 추가 및 메타데이터 갱신
					for (const { file, chunks, contentHash } of toEmbed) {
						this._chunks.push(...chunks);
						this._indexedPaths.add(file.path);
						this.fileHashes[file.path] = contentHash;
						this.fileMtimes[file.path] = file.stat.mtime;
					}
				} catch (embedErr) {
					// 임베딩 실패 시 mtime만 기록 → 다음 실행에서 재시도
					debugLogger.logError(
						'rag',
						embedErr instanceof Error ? embedErr : new Error(`배치 임베딩 실패: ${embedErr}`),
					);
					for (const { file } of toEmbed) {
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

	/**
	 * 파일 1개를 읽고 청킹까지 준비합니다. processFiles에서 병렬로 호출됩니다.
	 *
	 * @returns
	 *   - skip=true  : 본문 해시 동일 → mtime만 갱신하면 됨
	 *   - skip=false, chunks=[] : 빈 파일 → mtime만 기록
	 *   - skip=false, chunks≠[] : 임베딩 필요
	 */
	private async readAndPrepareFile(file: TFile): Promise<{
		chunks: DocumentChunk[];
		contentHash: number;
		skip: boolean;
	}> {
		const ext = file.extension.toLowerCase();
		let content = '';

		if (['pdf', 'docx', 'xlsx', 'xls'].includes(ext)) {
			const buffer = await this.app.vault.readBinary(file);
			content = await this.parseBinaryFn(buffer, ext);
		} else {
			const textContent = await this.app.vault.read(file);
			content = await DocumentParserRouter.parseText(textContent, ext);
		}

		if (!content || !content.trim()) {
			return { chunks: [], contentHash: 0, skip: false };
		}

		// 프론트매터 등 전처리 후 해시 계산
		const preprocessedText = this.preprocessMarkdown(content);
		const contentHash = hashString(preprocessedText);

		// 해시 동일 + 기존 청크 존재 → 재임베딩 불필요 (mtime만 변경된 경우)
		if (this.fileHashes[file.path] === contentHash && this._indexedPaths.has(file.path)) {
			return { chunks: [], contentHash, skip: true };
		}

		const chunks = this.chunkDocument({
			path: file.path,
			content,
			mtime: file.stat.mtime,
		});

		return { chunks, contentHash, skip: false };
	}

	/**
	 * 마크다운 문서를 overlap이 있는 청크로 분할.
	 * chunkSize/chunkOverlap은 문자 수 기준 (토큰 수 근사값으로 사용).
	 */
	private chunkDocument(doc: RawDocument): DocumentChunk[] {
		const { chunkSize, chunkOverlap } = this.settings;
		const text = this.preprocessMarkdown(doc.content);

		if (!text.trim()) return [];

		const chunks: DocumentChunk[] = [];
		let start = 0;
		let index = 0;

		while (start < text.length) {
			const end = Math.min(start + chunkSize, text.length);
			const chunkText = text.slice(start, end).trim();

			if (chunkText) {
				chunks.push({
					id: `${doc.path}::chunk_${index}`,
					path: doc.path,
					text: chunkText,
					chunkIndex: index,
				});
				index++;
			}

			if (end >= text.length) break;
			// 다음 청크 시작점 = 현재 끝 - overlap (최소 1자 전진 보장)
			start = Math.max(start + 1, end - chunkOverlap);
		}

		return chunks;
	}

	/**
	 * 마크다운 전처리:
	 * - YAML frontmatter 제거
	 * - 위키링크 텍스트 추출 ([[링크|텍스트]] → 텍스트)
	 */
	preprocessMarkdown(content: string): string {
		return content
			.replace(/^---[\s\S]*?---\n?/, '')            // frontmatter
			.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // [[link|text]] → text
			.replace(/\[\[([^\]]+)\]\]/g, '$1')            // [[link]] → link
			.trim();
	}

	/** 인덱스를 JSON으로 직렬화하여 디스크에 저장 */
	private async saveIndex(): Promise<void> {
		try {
			if (!(await this.app.vault.adapter.exists(this.storageDirPath))) {
				await this.app.vault.adapter.mkdir(this.storageDirPath);
			}

			const data: PersistedIndex = {
				version: SCHEMA_VERSION,
				modelName: this.modelName,
				chunks: this._chunks,
				fileMtimes: this.fileMtimes,
				fileHashes: this.fileHashes,
			};

			await this.app.vault.adapter.write(
				this.indexPath,
				JSON.stringify(data),
			);
		} catch (err) {
			debugLogger.logError('rag', err instanceof Error ? err : new Error(`인덱스 저장 실패: ${err}`));
		}
	}
}
