import { describe, it, expect } from 'vitest';
import { preprocessMarkdown, compileExcludePattern } from './markdownPreprocessor';

describe('markdownPreprocessor', () => {
	describe('기본 전처리 (하위 호환성)', () => {
		it('frontmatter, LUMINA_HISTORY_DATA_V2 주석, base64 이미지, 위키링크를 기존과 동일하게 처리해야 한다', () => {
			const input = [
				'---',
				'title: My Note',
				'tags: [a, b]',
				'---',
				'# Heading',
				'<!-- LUMINA_HISTORY_DATA_V2:{"messages":[]} -->',
				'Inline base64: ![alt text](data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==)',
				'External image: ![diagram](https://example.com/diagram.png)',
				'Wikilink: [[Folder/Target|Alias Text]] and [[SimpleLink]]',
				'```ts',
				'const x = 1;',
				'```',
			].join('\n');

			const result = preprocessMarkdown(input);
			expect(result).not.toContain('title: My Note');
			expect(result).not.toContain('LUMINA_HISTORY_DATA_V2');
			expect(result).not.toContain('data:image/png;base64');
			expect(result).toContain('Inline base64: alt text');
			expect(result).toContain('External image: ![diagram](https://example.com/diagram.png)');
			expect(result).toContain('Wikilink: Alias Text and SimpleLink');
			expect(result).toContain('const x = 1;');
		});
	});

	describe('콘텐츠 필터 옵션 (MarkdownFilterOptions)', () => {
		it('excludeCodeBlocks=true 시 백틱(```) 및 물결(~~~) 펜스 코드 블록을 제거해야 한다', () => {
			const input = [
				'본문 시작',
				'```javascript',
				'console.log("hello");',
				'```',
				'중간 텍스트',
				'~~~python',
				'print("world")',
				'~~~',
				'본문 끝',
			].join('\n');

			const result = preprocessMarkdown(input, { excludeCodeBlocks: true });
			expect(result).toContain('본문 시작');
			expect(result).toContain('중간 텍스트');
			expect(result).toContain('본문 끝');
			expect(result).not.toContain('console.log');
			expect(result).not.toContain('print("world")');
		});

		it('excludeImages=true 시 마크다운 이미지, 옵시디언 이미지 임베드, HTML img, 레퍼런스 base64 이미지를 모두 제거하고 일반 위키링크는 보존해야 한다', () => {
			const input = [
				'텍스트 1 ![인라인](data:image/png;base64,AAAA)',
				'텍스트 2 ![외부이미지](https://example.com/pic.jpg)',
				'텍스트 3 ![[screenshot.png]] 및 ![[photo.webp|300]]',
				'텍스트 4 <img src="https://example.com/a.png" width="100" />',
				'[img-ref]: data:image/jpeg;base64,/9j/4AAQSkZJRg==',
				'일반 노트 링크 [[ 일반노트 ]] 및 [[Path/Note|별칭]]',
			].join('\n');

			const result = preprocessMarkdown(input, { excludeImages: true });
			expect(result).not.toContain('data:image');
			expect(result).not.toContain('https://example.com/pic.jpg');
			expect(result).not.toContain('screenshot.png');
			expect(result).not.toContain('photo.webp');
			expect(result).not.toContain('<img');
			expect(result).toContain('일반 노트 링크  일반노트  및 별칭');
		});

		it('excludeComments=true 시 옵시디언 주석(%%...%%)과 HTML 주석(<!--...-->)을 제거해야 한다', () => {
			const input = [
				'표시될 문장',
				'%%옵시디언 내부 주석',
				'여러 줄 주석%%',
				'<!-- HTML 주석 내용 -->',
				'마지막 문장',
			].join('\n');

			const result = preprocessMarkdown(input, { excludeComments: true });
			expect(result).toContain('표시될 문장');
			expect(result).toContain('마지막 문장');
			expect(result).not.toContain('옵시디언 내부 주석');
			expect(result).not.toContain('HTML 주석 내용');
		});

		it('excludeContentPatterns에 지정된 정규식 패턴을 제거하고 잘못된 정규식은 에러 없이 무시해야 한다', () => {
			const input = [
				'# 제목',
				'TODO: 나중에 지울 메모',
				'본문 핵심 내용입니다.',
				'/^SECRET:.*$/im 매칭 대상: SECRET: hidden123',
			].join('\n');

			const result = preprocessMarkdown(input, {
				excludeContentPatterns: [
					'^TODO:.*$',
					'/SECRET:\\s*\\w+/i',
					'([unclosed invalid regex',
					'   ',
				],
			});

			expect(result).toContain('# 제목');
			expect(result).toContain('본문 핵심 내용입니다.');
			expect(result).not.toContain('나중에 지울 메모');
			expect(result).not.toContain('hidden123');
		});
	});

	describe('compileExcludePattern', () => {
		it('유효한 정규식과 /pattern/flags 형식을 RegExp로 컴파일하고 무효한 패턴은 null을 반환해야 한다', () => {
			expect(compileExcludePattern('')).toBeNull();
			expect(compileExcludePattern('   ')).toBeNull();
			expect(compileExcludePattern('[invalid')).toBeNull();

			const r1 = compileExcludePattern('^TODO:');
			expect(r1).toBeInstanceOf(RegExp);
			expect(r1?.flags).toContain('g');
			expect(r1?.flags).toContain('m');

			const r2 = compileExcludePattern('/hello/i');
			expect(r2).toBeInstanceOf(RegExp);
			expect(r2?.flags).toContain('i');
			expect(r2?.flags).toContain('g');
		});
	});
});
