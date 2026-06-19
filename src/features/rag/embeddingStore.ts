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

interface EmbeddingRecord {
	id: string;
	modelName: string;
	embedding: ArrayBuffer;
	dim: number;
}

export class EmbeddingStore {
	private db: IDBDatabase | null = null;
	private modelName: string | null = null;

	/** IndexedDB를 오픈하고 ObjectStore를 준비합니다. */
	async init(modelName: string): Promise<void> {
		this.modelName = modelName;

		return new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: 'id' });
				}
			};

			request.onsuccess = () => {
				this.db = request.result;
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
			await this.init(this.modelName);
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
			await this.init(this.modelName);
		}
		if (!this.db) throw new Error('EmbeddingStore not initialized');
		if (chunks.length === 0) return;

		const chunkMap = new Map<string, { id: string; embedding?: number[] | Float32Array }>();
		for (const c of chunks) {
			chunkMap.set(c.id, c);
		}

		const BATCH_SIZE = 1000;
		for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
			const batch = chunks.slice(i, i + BATCH_SIZE);
			await new Promise<void>((resolve, reject) => {
				const tx = this.db!.transaction(STORE_NAME, 'readonly');
				const store = tx.objectStore(STORE_NAME);

				let remaining = batch.length;
				let hasError = false;

				for (const chunk of batch) {
					const req = store.get(chunk.id);
					req.onsuccess = () => {
						if (hasError) return;
						const record = req.result as EmbeddingRecord | undefined;
						if (record && record.modelName === this.modelName) {
							chunk.embedding = this.bufferToFloat32(record.embedding);
						}
						remaining--;
						if (remaining === 0) resolve();
					};
					req.onerror = () => {
						if (hasError) return;
						hasError = true;
						reject(new Error(`loadEmbedding failed for ${chunk.id}: ${req.error?.message ?? 'unknown'}`));
					};
				}
			});
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
			const request = indexedDB.deleteDatabase(DB_NAME);

			request.onsuccess = () => {
				resolve();
			};

			request.onerror = () => {
				reject(new Error(`IndexedDB delete failed: ${request.error?.message ?? 'unknown'}`));
			};

			request.onblocked = () => {
				// 다른 연결이 DB를 사용 중이면 차단됨
				reject(new Error('IndexedDB delete blocked: close other tabs using this DB'));
			};
		});

		if (this.modelName) {
			await this.init(this.modelName as string);
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