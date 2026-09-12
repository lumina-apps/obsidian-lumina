import { describe, it, expect } from 'vitest';

describe('executeHandlers code block regex', () => {
	// executeHandlers.ts의 blockRegex와 동일한 정규식
	const blockRegex = /^[\t ]*```[a-zA-Z0-9_-]*[^\n]*\r?\n([\s\S]*?)^[\t ]*```/gm;

	function extractCodeBlocks(content: string): string[] {
		const matches = [...content.matchAll(blockRegex)];
		return matches.map((m) => m[1]);
	}

	it('표준 자바스크립트 코드 블록을 추출한다', () => {
		const content = 'Some text\n```javascript\nconst a = 1;\nconsole.log(a);\n```\nAfter text';
		const blocks = extractCodeBlocks(content);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toBe('const a = 1;\nconsole.log(a);\n');
	});

	it('언어 태그에 숫자나 하이픈이 포함된 경우(es2024, c-sharp)도 올바르게 매칭한다', () => {
		const content = '```es2024\nlet x = 10;\n```\n\n```c-sharp\nint y = 20;\n```';
		const blocks = extractCodeBlocks(content);
		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toBe('let x = 10;\n');
		expect(blocks[1]).toBe('int y = 20;\n');
	});

	it('언어 식별자 뒤에 속성(e.g. ```python run)이 붙어 있어도 올바르게 매칭한다', () => {
		const content = '```python run title="test"\nprint("hello")\n```';
		const blocks = extractCodeBlocks(content);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toBe('print("hello")\n');
	});

	it('들여쓰기된 코드 블록(리스트 내부 등)도 올바르게 매칭한다', () => {
		const content = '1. Step 1\n   ```bash\n   echo "inside list"\n   ```';
		const blocks = extractCodeBlocks(content);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toBe('   echo "inside list"\n');
	});

	it('언어가 지정되지 않은 코드 블록(```)도 올바르게 매칭한다', () => {
		const content = '```\nplain code\n```';
		const blocks = extractCodeBlocks(content);
		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toBe('plain code\n');
	});

	it('복수의 코드 블록 인덱스를 순서대로 정확하게 추출한다', () => {
		const content = [
			'# Title',
			'```js',
			'block 0',
			'```',
			'middle text',
			'```python',
			'block 1',
			'```',
			'```bash',
			'block 2',
			'```',
		].join('\n');

		const blocks = extractCodeBlocks(content);
		expect(blocks).toHaveLength(3);
		expect(blocks[0].trim()).toBe('block 0');
		expect(blocks[1].trim()).toBe('block 1');
		expect(blocks[2].trim()).toBe('block 2');
	});
});

