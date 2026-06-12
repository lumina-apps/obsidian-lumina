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

import { App, TFile, Notice, normalizePath } from 'obsidian';
import type { DocumentChunk, RawDocument } from '../../shared/types/rag.types';
import type { RagSettings } from '../../core/settings/settings.types';
import {
	setIndexingStatus,
	setTotalFiles,
	incrementProcessed,
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

/** 한 번에 워커에 보낼 최대 청크 수 */
const CHUNK_EMBED_BATCH = 16;
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
	private settings: RagSettings;
	/** 현재 인덱싱에 사용 중인 모델명 */
	private modelName: string;

	/** 인덱싱된 청크 (메모리) */
	private _chunks: DocumentChunk[] = [];
	/** 파일별 마지막 수정 시각 (증분 업데이트 추적) */
	private fileMtimes: Record<string, number> = {};
	/** 파일별 본문 해시 */
	private fileHashes: Record<string, number> = {};

	private isDestroyed: boolean = false;
	private currentProcessId: number = 0;

	private readonly storageDirPath: string;
	private readonly indexPath: string;

	constructor(app: App, embedFn: (texts: string[]) => Promise<number[][]>, settings: RagSettings, modelName: string) {
		this.app = app;
		this.embedFn = embedFn;
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
				this.fileMtimes = {};
				this.fileHashes = {};
				return;
			}

			this._chunks = data.chunks ?? [];
			this.fileMtimes = data.fileMtimes ?? {};
			this.fileHashes = data.fileHashes ?? {};
		} catch (err) {
			debugLogger.logSystem('rag', '인덱스 로드 실패 (최초 실행이면 정상)');
		}
	}

	/** 인덱스 전체 초기화 (디스크 + 메모리) */
	async resetIndex(): Promise<void> {
		this._chunks = [];
		this.fileMtimes = {};
		this.fileHashes = {};
		resetIndexing();
		await this.saveIndex();
	}

	// ─── Internals ───────────────────────────────────────────────────────────

	/** 설정(excludedPaths, includedPaths)에 따라 인덱싱 대상 파일 목록 반환 */
	private getTargetFiles(): TFile[] {
		const { excludedPaths, includedPaths } = this.settings;
		
		// 전체 파일 중 지원되는 확장자만 필터링
		const files = this.app.vault.getFiles().filter(f => {
			return SUPPORTED_EXTENSIONS.has(f.extension.toLowerCase());
		});

		// exclusions.ts의 isIncluded, isExcluded로 화이트리스트/블랙리스트 동시 적용
		return files.filter(f => isIncluded(f.path, includedPaths) && !isExcluded(f.path, excludedPaths));
	}

	/**
	 * 파일 목록을 순서대로 처리:
	 * 읽기 → 청킹 → CHUNK_EMBED_BATCH 단위 임베딩 → 인덱스 추가
	 */
	private async processFiles(files: TFile[]): Promise<void> {
		this.currentProcessId++;
		const processId = this.currentProcessId;

		for (const file of files) {
			if (this.isDestroyed || this.currentProcessId !== processId) {
				return;
			}
			try {
				const content = await DocumentParserRouter.parse(this.app, file);
				
				if (!content || !content.trim()) {
					this.fileMtimes[file.path] = file.stat.mtime;
					continue;
				}

				const doc: RawDocument = {
					path: file.path,
					content,
					mtime: file.stat.mtime,
				};

				// 프론트매터 등 전처리 후의 본문 해시 계산
				const preprocessedText = this.preprocessMarkdown(doc.content);
				const contentHash = hashString(preprocessedText);

				// 해시가 기존과 동일하고, 기존에 파싱된 청크가 존재한다면 재임베딩 생략 (mtime만 변경된 경우)
				if (this.fileHashes[file.path] === contentHash && this._chunks.some(c => c.path === file.path)) {
					this.fileMtimes[file.path] = file.stat.mtime;
					continue;
				}

				// 본문이 변경되었으므로 기존 청크 제거
				this._chunks = this._chunks.filter(c => c.path !== file.path);

				// 문서 청킹
				// (preprocessMarkdown은 chunkDocument 내부에서도 호출되지만, 중복 호출 비용은 미미함)
				const chunks = this.chunkDocument(doc);

				if (chunks.length > 0) {
					for (let i = 0; i < chunks.length; i += CHUNK_EMBED_BATCH) {
						const batch = chunks.slice(i, i + CHUNK_EMBED_BATCH);
						if (batch.length > 0) {
							const texts = batch.map(c => c.text);
							const embeddings = await this.embedFn(texts);
							for (let j = 0; j < batch.length; j++) {
								batch[j].embedding = embeddings[j];
							}
						}
					}
					this._chunks.push(...chunks);
				}

				this.fileHashes[file.path] = contentHash;
				this.fileMtimes[file.path] = file.stat.mtime;
			} catch (err) {
				debugLogger.logError('rag', err instanceof Error ? err : new Error(`파일 인덱싱 실패 (무한루프 방지를 위해 mtime 기록됨): ${file.path}`));
				this.fileMtimes[file.path] = file.stat.mtime;
			} finally {
				incrementProcessed();
			}
		}
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
