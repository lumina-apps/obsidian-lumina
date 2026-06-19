/**
 * chunker.test.ts
 * 문서 청크 분할: chunkDocument 검증
 * preprocessMarkdown 의존성 → markdownPreprocessor 실제 함수 사용
 */
import { describe, it, expect } from 'vitest';
import { chunkDocument } from './chunker';
import type { RawDocument } from '../../shared/types/rag.types';

// ── chunkDocument ──

describe('chunkDocument', () => {
	it('빈 문서는 빈 배열 반환', () => {
		const doc: RawDocument = { path: '/empty.md', content: '', mtime: Date.now() };
		const result = chunkDocument(doc, 100, 20, 50, 10);
		expect(result.parentChunks).toEqual([]);
		expect(result.childChunks).toEqual([]);
	});

	it('공백만 있는 문서는 빈 배열 반환', () => {
		const doc: RawDocument = { path: '/empty.md', content: '   \n  ', mtime: Date.now() };
		const result = chunkDocument(doc, 100, 20, 50, 10);
		expect(result.parentChunks).toEqual([]);
		expect(result.childChunks).toEqual([]);
	});

	it('chunkSize보다 짧은 문서는 단일 청크 생성', () => {
		const doc: RawDocument = { path: '/short.md', content: 'hello world', mtime: Date.now() };
		const result = chunkDocument(doc, 100, 20, 50, 10);
		const parentChunks = result.parentChunks;
		expect(parentChunks).toHaveLength(1);
		expect(parentChunks[0].text).toBe('hello world');
		expect(parentChunks[0].chunkIndex).toBe(0);
	});

	it('chunkSize 기준으로 여러 청크 분할', () => {
		const content = '0123456789'.repeat(5); // 50 chars
		const doc: RawDocument = { path: '/long.md', content, mtime: Date.now() };
		const result = chunkDocument(doc, 20, 0, 10, 0);
		const parentChunks = result.parentChunks;
		expect(parentChunks.length).toBeGreaterThanOrEqual(2);
		// 각 청크는 chunkSize 이하
		for (const c of parentChunks) {
			expect(c.text.length).toBeLessThanOrEqual(20);
		}
	});

	it('overlap이 있는 경우 이전 청크 내용이 일부 포함됨', () => {
		const content = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // 26 chars
		const doc: RawDocument = { path: '/abc.md', content, mtime: Date.now() };
		const result = chunkDocument(doc, 10, 4, 5, 2);
		const parentChunks = result.parentChunks;
		expect(parentChunks.length).toBeGreaterThan(1);
		// 두 번째 청크의 앞부분이 첫 번째 청크 뒷부분과 겹쳐야 함
		const tail1 = parentChunks[0].text.slice(-4);
		const head2 = parentChunks[1].text.slice(0, 4);
		expect(tail1).toBe(head2);
	});

	it('청크 id에 경로와 인덱스 포함', () => {
		const doc: RawDocument = { path: '/notes/myfile.md', content: 'hello world', mtime: Date.now() };
		const result = chunkDocument(doc, 100, 20, 50, 10);
		const parentChunks = result.parentChunks;
		const childChunks = result.childChunks;
		expect(parentChunks[0].id).toBe('/notes/myfile.md#parent_0');
		expect(parentChunks[0].path).toBe('/notes/myfile.md');
		expect(childChunks[0].id).toBe('/notes/myfile.md#parent_0#child_0');
	});

	it('frontmatter가 있는 마크다운은 --- 블록 제거 후 청크 분할', () => {
		const content = '---\ntitle: Test\n---\n# Hello\n\nWorld content';
		const doc: RawDocument = { path: '/fm.md', content, mtime: Date.now() };
		const result = chunkDocument(doc, 100, 20, 50, 10);
		const parentChunks = result.parentChunks;
		expect(parentChunks.length).toBeGreaterThanOrEqual(1);
		// frontmatter 내용이 청크에 포함되지 않아야 함
		const allText = parentChunks.map(c => c.text).join(' ');
		expect(allText).not.toContain('title:');
	});
});