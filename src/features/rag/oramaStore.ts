import { create, insertMultiple, search, removeMultiple, type AnyOrama } from '@orama/orama';
import type { ChildChunk } from '../../shared/types/rag.types';

export class OramaStore {
	private db: AnyOrama | null = null;
	private dimension: number;

	private koreanBigramTokenizer(this: void, raw: string): string[] {
		if (typeof raw !== 'string') return [String(raw)];
		const text = raw.normalize('NFC').toLowerCase();
		const tokens = new Set<string>();
		const words = text.match(/[\p{L}\p{N}_]+/gu) || [];
		
		for (const word of words) {
			tokens.add(word);
			for (let i = 0; i < word.length - 1; i++) {
				const char1 = word.charCodeAt(i);
				const char2 = word.charCodeAt(i+1);
				if (char1 >= 0xAC00 && char1 <= 0xD7A3 && char2 >= 0xAC00 && char2 <= 0xD7A3) {
					tokens.add(word.substring(i, i+2));
				}
			}
		}
		return Array.from(tokens);
	}

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
			components: {
				tokenizer: {
					language: 'ko',
					normalizationCache: new Map(),
					tokenize: this.koreanBigramTokenizer
				}
			}
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

	/** 쿼리 텍스트에 기반해 BM25/Full-text 검색을 수행하여 하위 청크들을 찾습니다. */
	async searchFulltext(query: string, limit: number, activeFilePath?: string | null): Promise<{ id: string; parentId: string }[]> {
		if (!this.db) throw new Error('OramaStore not initialized');
		
		const searchParams: Parameters<typeof search>[1] = {
			term: query,
			limit,
			properties: ['text'],
		};

		if (activeFilePath) {
			searchParams.where = { path: { eq: activeFilePath } };
		}

		const results = await search(this.db, searchParams);

		return results.hits.map(hit => ({
			id: hit.id,
			parentId: (hit.document as Record<string, unknown>).parentId as string,
		}));
	}

	/** DB 초기화 */
	async clear(): Promise<void> {
		await this.init(); // 새 인스턴스로 덮어쓰기
	}
}
