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

	it('overlap >= chunkSize 설정 시 무한 루프 없이 정상 클램프되어 처리됨', () => {
		const content = '0123456789'.repeat(10); // 100 chars
		const doc: RawDocument = { path: '/pathological.md', content, mtime: Date.now() };
		// overlap이 chunkSize보다 큼
		const result = chunkDocument(doc, 20, 50, 10, 30);
		expect(result.parentChunks.length).toBeGreaterThan(0);
		expect(result.childChunks.length).toBeGreaterThan(0);
	});

	it('filterOptions 전달 시 코드 블록과 이미지를 제외한 본문만 청킹해야 함', () => {
		const content = [
			'핵심 문서 텍스트입니다.',
			'```ts',
			'const secretCode = 42;',
			'```',
			'![image](https://example.com/banner.png)',
			'![[diagram.png]]',
		].join('\n');
		const doc: RawDocument = { path: '/filtered.md', content, mtime: Date.now() };
		const result = chunkDocument(doc, 200, 20, 100, 10, {
			excludeCodeBlocks: true,
			excludeImages: true,
		});
		expect(result.parentChunks).toHaveLength(1);
		expect(result.parentChunks[0].text).toBe('핵심 문서 텍스트입니다.');
	});

	it('마크다운 헤딩 계층별로 분할하고 headingPath와 contextPrefix를 분리 저장하며 text 원문을 오염시키지 않는다', () => {
		const content = [
			'---',
			'title: 아키텍처 가이드',
			'tags: [rag, obsidian]',
			'---',
			'# 개요',
			'시스템 소개 본문입니다.',
			'',
			'## 검색 파이프라인',
			'하이브리드 검색과 리랭킹을 수행합니다.',
		].join('\n');
		const doc: RawDocument = { path: 'docs/rag-design.md', content, mtime: Date.now() };
		const result = chunkDocument(doc, 1000, 100, 200, 20);

		expect(result.parentChunks).toHaveLength(2);
		expect(result.parentChunks[0].headingPath).toEqual(['개요']);
		expect(result.parentChunks[1].headingPath).toEqual(['개요', '검색 파이프라인']);
		// 원문 text에는 contextPrefix가 섞이지 않아야 함
		expect(result.parentChunks[1].text).not.toContain('rag-design (');
		expect(result.parentChunks[1].text).toContain('하이브리드 검색과 리랭킹을 수행합니다.');
		// contextPrefix에는 보일러플레이트 라벨 없이 파일명·제목·섹션·태그가 압축 포함됨
		expect(result.parentChunks[1].contextPrefix).toContain('rag-design (아키텍처 가이드)');
		expect(result.parentChunks[1].contextPrefix).toContain('개요 > 검색 파이프라인');
		expect(result.parentChunks[1].contextPrefix).toContain('#rag');
		expect(result.parentChunks[1].contextPrefix).not.toContain('문서:');
		expect(result.childChunks[1].contextPrefix).toBe(result.parentChunks[1].contextPrefix);
	});

	it('본문 없이 바로 하위 헤딩이 이어지는 단독 헤딩은 빈 청크로 남기지 않고 계층 경로만 승계한다', () => {
		const content = [
			'# 대제목',
			'',
			'## 소제목',
			'여기에만 실제 본문이 있습니다.',
		].join('\n');
		const doc: RawDocument = { path: 'nested.md', content, mtime: Date.now() };
		const result = chunkDocument(doc, 1000, 100, 300, 20);

		expect(result.parentChunks).toHaveLength(1);
		expect(result.parentChunks[0].headingPath).toEqual(['대제목', '소제목']);
		expect(result.parentChunks[0].text).toContain('여기에만 실제 본문이 있습니다.');
	});

	it('펜스 코드블록 내부의 # 주석을 마크다운 헤딩으로 오인하지 않는다', () => {
		const content = [
			'# 실제 섹션',
			'```python',
			'# 이것은 파이썬 주석입니다',
			'def hello():',
			'    return 1',
			'```',
		].join('\n');
		const doc: RawDocument = { path: 'code.md', content, mtime: Date.now() };
		const result = chunkDocument(doc, 1000, 100, 300, 20);

		expect(result.parentChunks).toHaveLength(1);
		expect(result.parentChunks[0].headingPath).toEqual(['실제 섹션']);
		expect(result.parentChunks[0].text).toContain('# 이것은 파이썬 주석입니다');
	});
});