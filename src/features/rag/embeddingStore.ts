/**
 * IndexedDB 기반 임베딩 벡터 저장소.
 *
 * index.json에서 embedding: number[] 필드를 분리하여
 * 각 청크의 임베딩 벡터를 Float32Array → ArrayBuffer로 IndexedDB에 저장합니다.
 *
 * - DB 이름: lumina-embeddings
 * - ObjectStore: embeddings (key = chunk.id, in-line key)
 * - 저장 데이터: { id, modelName, embedding: ArrayBuffer, dim }
 */

const DB_NAME = 'lumina-embeddings';
const STORE_NAME = 'embeddings';
const DB_VERSION = 1;

import { debugLogger } from '../../shared/debugLogger';

interface EmbeddingRecord {
	id: string;
	modelName: string;
	embedding: ArrayBuffer;
	dim: number;
}

export class EmbeddingStore {
	private db: IDBDatabase | null = null;
	private modelName: string | null = null;
	private dbName: string = DB_NAME;
	private projectId: string | undefined = undefined;
	private vaultId: string | undefined = undefined;
	private checkedLegacyDb = false;

	constructor(projectId?: string, vaultId?: string) {
		this.projectId = projectId;
		this.vaultId = vaultId;
		this.dbName = this.buildDbName(this.vaultId, this.projectId);
	}

	private buildDbName(vaultId?: string, projectId?: string): string {
		if (vaultId && projectId) return `${DB_NAME}-${vaultId}-${projectId}`;
		if (vaultId) return `${DB_NAME}-${vaultId}`;
		if (projectId) return `${DB_NAME}-${projectId}`;
		return DB_NAME;
	}

	/** IndexedDB를 오픈하고 ObjectStore를 준비합니다. */
	async init(modelName: string, projectId?: string, vaultId?: string): Promise<void> {
		this.modelName = modelName;
		// 볼트 및 프로젝트별 격리: 각 볼트·프로젝트의 임베딩 벡터를 독립된 IndexedDB에 저장
		this.projectId = projectId ?? this.projectId;
		this.vaultId = vaultId ?? this.vaultId;
		this.dbName = this.buildDbName(this.vaultId, this.projectId);

		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, DB_VERSION);

			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: 'id' });
				}
			};

			request.onsuccess = () => {
				this.db = request.result;
				this.db.onversionchange = () => {
					this.close();
				};
				resolve();
			};

			request.onerror = () => {
				reject(new Error(`IndexedDB open failed: ${request.error?.message ?? 'unknown'}`));
			};
		});
	}

	/** Float32Array → ArrayBuffer 변환 */
	private float32ToBuffer(arr: Float32Array): ArrayBuffer {
		return (arr.buffer as ArrayBuffer).slice(arr.byteOffset, arr.byteOffset + arr.byteLength);
	}

	/** ArrayBuffer → Float32Array 변환 */
	private bufferToFloat32(buf: ArrayBuffer): Float32Array {
		return new Float32Array(buf);
	}

	/** 단일 청크의 임베딩을 저장합니다. (트랜잭션 내에서 호출됨) */
	private putEmbedding(
		store: IDBObjectStore,
		chunkId: string,
		embedding: Float32Array | number[],
	): void {
		const f32 = Array.isArray(embedding) ? new Float32Array(embedding) : embedding;
		const record: EmbeddingRecord = {
			id: chunkId,
			modelName: this.modelName!,
			embedding: this.float32ToBuffer(f32),
			dim: f32.length,
		};
		store.put(record);
	}

	/** 여러 청크의 임베딩을 벌크 저장합니다. */
	async storeEmbeddings(chunks: Array<{ id: string; embedding?: number[] | Float32Array }>): Promise<void> {
		if (!this.db && this.modelName) {
			if (this.vaultId !== undefined) {
				await this.init(this.modelName, this.projectId, this.vaultId);
			} else {
				await this.init(this.modelName, this.projectId);
			}
		}
		if (!this.db) throw new Error('EmbeddingStore not initialized');

		const chunksWithEmbedding = chunks.filter(c => c.embedding && c.embedding.length > 0);
		if (chunksWithEmbedding.length === 0) return;

		const BATCH_SIZE = 1000;
		for (let i = 0; i < chunksWithEmbedding.length; i += BATCH_SIZE) {
			const batch = chunksWithEmbedding.slice(i, i + BATCH_SIZE);
			await new Promise<void>((resolve, reject) => {
				const tx = this.db!.transaction(STORE_NAME, 'readwrite');
				const store = tx.objectStore(STORE_NAME);

				for (const chunk of batch) {
					this.putEmbedding(store, chunk.id, chunk.embedding!);
				}

				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(new Error(`storeEmbeddings batch failed: ${tx.error?.message ?? 'unknown'}`));
			});
		}
	}

	/** 여러 청크의 embedding 필드를 IndexedDB에서 로드하여 채웁니다. */
	async loadEmbeddings(chunks: Array<{ id: string; embedding?: number[] | Float32Array }>): Promise<void> {
		if (!this.db && this.modelName) {
			if (this.vaultId !== undefined) {
				await this.init(this.modelName, this.projectId, this.vaultId);
			} else {
				await this.init(this.modelName, this.projectId);
			}
		}
		if (!this.db) throw new Error('EmbeddingStore not initialized');
		if (chunks.length === 0) return;

		let loadedCount = 0;
		const BATCH_SIZE = 1000;
		for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
			const batch = chunks.slice(i, i + BATCH_SIZE);
			await new Promise<void>((resolve, reject) => {
				const tx = this.db!.transaction(STORE_NAME, 'readonly');
				const store = tx.objectStore(STORE_NAME);

				let remaining = batch.length;
				let hasError = false;
				let isResolved = false;

				for (const chunk of batch) {
					const req = store.get(chunk.id);
					req.onsuccess = () => {
						if (hasError) return;
						const record = req.result as EmbeddingRecord | undefined;
						if (record && record.modelName === this.modelName) {
							chunk.embedding = this.bufferToFloat32(record.embedding);
							loadedCount++;
						}
						remaining--;
						if (remaining === 0 && !isResolved) {
							isResolved = true;
							resolve();
						}
					};
					req.onerror = () => {
						if (hasError) return;
						hasError = true;
						reject(new Error(`loadEmbedding failed for ${chunk.id}: ${req.error?.message ?? 'unknown'}`));
					};
				}

				tx.oncomplete = () => {
					if (!hasError && !isResolved) {
						isResolved = true;
						resolve();
					}
				};
				tx.onerror = () => {
					if (hasError) return;
					hasError = true;
					reject(new Error(`loadEmbeddings transaction failed: ${tx.error?.message ?? 'unknown'}`));
				};
			});
		}

		// 볼트 격리 DB가 비어 있는 최초 전환 시 기존 레거시 DB에서 1회 마이그레이션 시도
		if (loadedCount === 0 && this.vaultId && !this.checkedLegacyDb) {
			this.checkedLegacyDb = true;
			await this.tryMigrateFromLegacyDb(chunks);
		}
	}

	private async tryMigrateFromLegacyDb(chunks: Array<{ id: string; embedding?: number[] | Float32Array }>): Promise<void> {
		const legacyDbName = this.buildDbName(undefined, this.projectId);
		if (legacyDbName === this.dbName || !this.modelName) return;

		try {
			const legacyStore = new EmbeddingStore(this.projectId);
			await legacyStore.init(this.modelName, this.projectId);
			try {
				await legacyStore.loadEmbeddings(chunks);
			} finally {
				legacyStore.close();
			}
			const migrated = chunks.filter(c => c.embedding && c.embedding.length > 0);
			if (migrated.length > 0) {
				await this.storeEmbeddings(migrated);
				debugLogger.logSystem('rag', `Migrated ${migrated.length} embeddings from legacy DB (${legacyDbName}) to ${this.dbName}`);
			}
		} catch {
			// 레거시 DB가 없거나 열 수 없는 경우 무시 (C3 자가 복구가 재임베딩 수행)
		}
	}

	/** 여러 ID의 임베딩을 삭제합니다. */
	async deleteEmbeddings(ids: string[]): Promise<void> {
		if (!this.db) throw new Error('EmbeddingStore not initialized');
		if (ids.length === 0) return;

		return new Promise((resolve, reject) => {
			const tx = this.db!.transaction(STORE_NAME, 'readwrite');
			const store = tx.objectStore(STORE_NAME);

			for (const id of ids) {
				store.delete(id);
			}

			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(new Error(`deleteEmbeddings failed: ${tx.error?.message ?? 'unknown'}`));
		});
	}

	/** DB 전체를 삭제합니다 (인덱스 초기화 시). */
	async clear(): Promise<void> {
		if (this.db) {
			this.db.close();
			this.db = null;
		}

		await new Promise<void>((resolve, reject) => {
			let settled = false;
			let blockedTimer: number | null = null;
			const finish = (cb: () => void) => {
				if (settled) return;
				settled = true;
				if (blockedTimer) window.clearTimeout(blockedTimer);
				cb();
			};

			const request = indexedDB.deleteDatabase(this.dbName);

			request.onsuccess = () => {
				finish(() => resolve());
			};

			request.onerror = () => {
				finish(() => reject(new Error(`IndexedDB delete failed: ${request.error?.message ?? 'unknown'}`)));
			};

			request.onblocked = () => {
				// 다른 연결이 DB를 사용 중이면 차단됨 (일정 시간 대기 후에도 해제되지 않으면 진행)
				debugLogger.logWarn('rag', 'IndexedDB delete blocked: waiting for other transactions to finish');
				blockedTimer = window.setTimeout(() => {
					finish(() => resolve());
				}, 1500);
			};
		});

		if (this.modelName) {
			if (this.vaultId !== undefined) {
				await this.init(this.modelName, this.projectId, this.vaultId);
			} else {
				await this.init(this.modelName, this.projectId);
			}
		}
	}

	/** DB 연결을 닫습니다. */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
		}
	}
}