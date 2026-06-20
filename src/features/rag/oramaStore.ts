import { create, insertMultiple, search, removeMultiple, type AnyOrama } from '@orama/orama';
import type { ChildChunk } from '../../shared/types/rag.types';

export class OramaStore {
	private db: AnyOrama | null = null;
	private dimension: number;

	constructor(dimension: number) {
		this.dimension = dimension;
	}

	/** Orama DB를 초기화합니다. */
	async init(): Promise<void> {
		this.db = create({
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

	/** 특정 ID 목록에 해당하는 하위 청크들을 삭제합니다. */
	async deleteByIds(ids: string[]): Promise<void> {
		if (!this.db || ids.length === 0) return;
		await removeMultiple(this.db, ids);
	}

	/** 쿼리 벡터와 유사한 하위 청크들을 검색합니다. */
	async search(queryEmbedding: number[] | Float32Array, limit: number, activeFilePath?: string | null): Promise<{ id: string; score: number; activeDocument: Record<string, unknown> }[]> {
		if (!this.db) throw new Error('OramaStore not initialized');

		const searchParams: Parameters<typeof search>[1] = {
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

		return results.hits.map(hit => ({
			id: hit.id,
			score: hit.score,
			activeDocument: hit.document as Record<string, unknown>,
		}));
	}

	/** DB 초기화 */
	async clear(): Promise<void> {
		await this.init(); // 새 인스턴스로 덮어쓰기
	}
}
