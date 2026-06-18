/**
 * bm25.test.ts
 * BM25 검색 알고리즘: tokenize, calculateBM25 검증
 */
import { describe, it, expect } from 'vitest';
import { tokenize, calculateBM25 } from './bm25';
import type { DocumentChunk } from '../../shared/types/rag.types';

function chunk(id: string, path: string, text: string, index = 0): DocumentChunk {
	return { id, path, text, chunkIndex: index };
}

// ── tokenize ──

describe('tokenize', () => {
	it('빈 문자열은 빈 배열 반환', () => {
		expect(tokenize('')).toEqual([]);
	});

	it('공백만 있는 문자열은 빈 배열 반환', () => {
		expect(tokenize('   ')).toEqual([]);
	});

	it('영문 단어 분리', () => {
		expect(tokenize('hello world')).toContain('hello');
		expect(tokenize('hello world')).toContain('world');
	});

	it('대문자 → 소문자 정규화', () => {
		const tokens = tokenize('Hello WORLD');
		expect(tokens).toContain('hello');
		expect(tokens).toContain('world');
	});

	it('한글은 uni-gram + bi-gram 생성', () => {
		const tokens = tokenize('안녕하세요');
		expect(tokens).toContain('안녕하세요'); // uni-gram
		expect(tokens).toContain('안녕');       // bi-gram
		expect(tokens).toContain('녕하');
		expect(tokens).toContain('하세');
		expect(tokens).toContain('세요');
	});
});

// ── calculateBM25 ──

describe('calculateBM25', () => {
	it('빈 쿼리는 모든 청크 점수 0', () => {
		const chunks = [chunk('c0', '/a.md', 'hello world')];
		const results = calculateBM25('', chunks);
		expect(results).toHaveLength(1);
		expect(results[0].score).toBe(0);
	});

	it('빈 청크 배열은 빈 결과 반환', () => {
		expect(calculateBM25('query', [])).toEqual([]);
	});

	it('정확히 일치하는 문서가 가장 높은 점수', () => {
		const chunks = [
			chunk('c0', '/a.md', 'apple banana'),
			chunk('c1', '/b.md', 'hello world'),
			chunk('c2', '/c.md', 'hello banana'),
		];
		const results = calculateBM25('hello world', chunks);
		// 'hello world' 청크가 가장 점수가 높아야 함
		const sorted = [...results].sort((a, b) => b.score - a.score);
		expect(sorted[0].chunk.id).toBe('c1');
	});

	it('연관 없는 문서는 낮은 점수', () => {
		const chunks = [
			chunk('c0', '/a.md', 'apple banana cherry'),
			chunk('c1', '/b.md', 'hello world'),
		];
		const results = calculateBM25('xyz pdq abc', chunks);
		// 둘 다 거의 0에 가까워야 함
		for (const r of results) {
			expect(r.score).toBeLessThanOrEqual(0.1);
		}
	});

	it('한글 쿼리 검색', () => {
		const chunks = [
			chunk('c0', '/a.md', '안녕하세요 반갑습니다'),
			chunk('c1', '/b.md', 'BM25는 검색 알고리즘입니다'),
		];
		const results = calculateBM25('검색', chunks);
		// '검색'이 포함된 c1이 c0보다 높아야 함
		expect(results[1].score).toBeGreaterThan(results[0].score);
	});

	it('여러 문서에서 동일 토큰 빈도 차이 반영', () => {
		const chunks = [
			chunk('c0', '/a.md', 'cat cat cat dog'),
			chunk('c1', '/b.md', 'cat dog bird'),
		];
		// 'cat'이 3번 등장하는 c0가 더 높은 점수
		const results = calculateBM25('cat', chunks);
		expect(results[0].score).toBeGreaterThan(results[1].score);
	});

	it('k1, b 파라미터 영향', () => {
		const chunks = [
			chunk('c0', '/a.md', 'hello hello hello world'),
			chunk('c1', '/b.md', 'hello world world world'),
		];
		const defaultResult = calculateBM25('hello', chunks, 1.2, 0.75);
		const customK1 = calculateBM25('hello', chunks, 2.0, 0.75);
		// k1이 다르면 점수도 달라짐 (문서 수가 여러 개일 때 차이 발생)
		expect(defaultResult[0].score).not.toBe(customK1[0].score);
	});
});