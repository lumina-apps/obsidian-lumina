import { describe, it, expect } from 'vitest';
import { parsePythonArgs, parsePythonCall } from './pythonArgsParser';

describe('pythonArgsParser', () => {
	describe('parsePythonArgs', () => {
		it('기본 문자열 인자(큰따옴표)를 정상 파싱한다', () => {
			const res = parsePythonArgs('path="notes/today.md", content="Hello world"');
			expect(res).toEqual({
				path: 'notes/today.md',
				content: 'Hello world',
			});
		});

		it('작은따옴표 문자열 인자를 정상 파싱한다', () => {
			const res = parsePythonArgs("path='notes/test.md', name='Lumina'");
			expect(res).toEqual({
				path: 'notes/test.md',
				name: 'Lumina',
			});
		});

		it('삼중 따옴표 내 줄바꿈을 포함한 멀티라인 문자열을 정상 파싱한다', () => {
			const input = 'path="doc.md", content="""Line 1\nLine 2\nLine 3"""';
			const res = parsePythonArgs(input);
			expect(res).toEqual({
				path: 'doc.md',
				content: 'Line 1\nLine 2\nLine 3',
			});
		});

		it('문자열 내 이스케이프 시퀀스(\\n, \\t, \\r)를 올바르게 처리한다', () => {
			const res = parsePythonArgs('text="line1\\nline2\\ttab"');
			expect(res).toEqual({
				text: 'line1\nline2\ttab',
			});
		});

		it('불리언(True, False) 및 None/null 값을 올바르게 변환한다', () => {
			const res = parsePythonArgs('a=True, b=False, c=true, d=false, e=None, f=null');
			expect(res).toEqual({
				a: true,
				b: false,
				c: true,
				d: false,
				e: null,
				f: null,
			});
		});

		it('정수 및 부동소수점 숫자를 변환한다', () => {
			const res = parsePythonArgs('count=42, ratio=3.14, negative=-10');
			expect(res).toEqual({
				count: 42,
				ratio: 3.14,
				negative: -10,
			});
		});

		it('중괄호 객체 및 대괄호 배열 인자를 파싱한다', () => {
			const res = parsePythonArgs('tags=["ai", "obsidian"], options={"autoSave": true, "mode": "fast"}');
			expect(res).toEqual({
				tags: ['ai', 'obsidian'],
				options: { autoSave: true, mode: 'fast' },
			});
		});

		it('불필요한 공백과 후행 쉼표를 허용한다', () => {
			const res = parsePythonArgs('  path =  "foo.md"  ,  count = 5 , ');
			expect(res).toEqual({
				path: 'foo.md',
				count: 5,
			});
		});

		it('빈 문자열이나 공백 입력 시 빈 객체를 반환한다', () => {
			expect(parsePythonArgs('')).toEqual({});
			expect(parsePythonArgs('   ')).toEqual({});
		});
	});

	describe('parsePythonCall', () => {
		it('표준 함수 호출 구문을 파싱한다', () => {
			const res = parsePythonCall('append_to_note(path="Inbox.md", content="New task")');
			expect(res).toEqual({
				name: 'append_to_note',
				arguments: {
					path: 'Inbox.md',
					content: 'New task',
				},
			});
		});

		it('인자가 없는 함수 호출을 파싱한다', () => {
			const res = parsePythonCall('read_active_note()');
			expect(res).toEqual({
				name: 'read_active_note',
				arguments: {},
			});
		});

		it('LLM이 흔히 출력하는 print(...) 래퍼를 자동으로 벗겨낸다', () => {
			const res = parsePythonCall('print(search_notes(query="Meeting notes", max_results=5))');
			expect(res).toEqual({
				name: 'search_notes',
				arguments: {
					query: 'Meeting notes',
					max_results: 5,
				},
			});
		});

		it('함수 호출 형태가 아닌 일반 텍스트는 null을 반환한다', () => {
			expect(parsePythonCall('Just some markdown text')).toBeNull();
			expect(parsePythonCall('{ "name": "tool" }')).toBeNull();
			expect(parsePythonCall('')).toBeNull();
		});
	});
});
