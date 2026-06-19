import { create, insertMultiple, search, removeMultiple } from '@orama/orama';
import type { ChildChunk } from '../../shared/types/rag.types';

export class OramaStore {
	private db: any;
	private dimension: number;

	constructor(dimension: number) {
		this.dimension = dimension;
	}

	/** Orama DB를 초기화합니다. */
	async init(): Promise<void> {
		this.db = await create({
			schema: {
				id: 'string',
				parentId: 'string',
				path: 'enum',
				text: 'string',
				embedding: `vector[${this.dimension}]`,
			},
		});
	}

	/** 여러 ChildChunk를 Orama DB에 일괄 삽입합니다. */
	async insertChunks(chunks: ChildChunk[]): Promise<void> {
		if (!this.db) throw new Error('OramaStore not initialized');

		const records = chunks
			.filter((c) => c.embedding && c.embedding.length > 0)
			.map((c) => ({
				id: c.id,
				parentId: c.parentId,
				path: c.path,
				text: c.text,
				embedding: Array.from(c.embedding!),
			}));

		if (records.length === 0) return;

		await insertMultiple(this.db, records);
	}

	/** 지정된 path prefix를 가진 모든 하위 청크를 삭제합니다. */
	async deleteByPathPrefix(prefix: string): Promise<void> {
		if (!this.db) throw new Error('OramaStore not initialized');

		// Orama에서 path 속성에 대해 exact 매치나 검색을 수행하여 삭제할 수 있습니다.
		// 이 구현에서는 검색을 통해 ID를 수집한 후 삭제합니다.
		// 참고: prefix 검색이 필요하므로 전체 문서를 순회하거나, 
		// 간단하게 db.data.docs를 직접 필터링할 수도 있습니다.
		
		const idsToRemove: string[] = [];
		// Orama 내부 데이터 구조에 접근하여 ID 수집 (안전한 방식)
		// @ts-ignore
		const docs = this.db.data?.docs?.docs ?? {};
		for (const id in docs) {
			const doc = docs[id];
			if (doc.path && doc.path.startsWith(prefix)) {
				idsToRemove.push(id);
			}
		}

		if (idsToRemove.length > 0) {
			await removeMultiple(this.db, idsToRemove);
		}
	}

	/** 특정 ID 목록에 해당하는 하위 청크들을 삭제합니다. */
	async deleteByIds(ids: string[]): Promise<void> {
		if (!this.db || ids.length === 0) return;
		await removeMultiple(this.db, ids);
	}

	/** 쿼리 벡터와 유사한 하위 청크들을 검색합니다. */
	async search(queryEmbedding: number[] | Float32Array, limit: number, activeFilePath?: string | null): Promise<{ id: string; score: number; document: any }[]> {
		if (!this.db) throw new Error('OramaStore not initialized');

		const searchParams: any = {
			mode: 'vector',
			vector: {
				value: Array.from(queryEmbedding),
				property: 'embedding',
			},
			limit,
			similarity: 0.0, // 필터링은 외부에서 수행
		};

		if (activeFilePath) {
			searchParams.where = { path: { eq: activeFilePath } };
		}

		const results = await search(this.db, searchParams);

		return results.hits;
	}

	/** DB 초기화 */
	async clear(): Promise<void> {
		await this.init(); // 새 인스턴스로 덮어쓰기
	}
}
