import { describe, it, expect } from 'vitest';
import { parseTextToolCalls } from './textToolCallParser';
import { tryParseBlock } from './blockParsers';

describe('textToolCallParser', () => {
	describe('tryParseBlock', () => {
		it('JSON 포맷의 도구 호출 블록을 정상 파싱한다', () => {
			const block = '{"name": "read_note", "arguments": {"path": "Daily/2026-09-23.md"}}';
			const res = tryParseBlock(block);
			expect(res).not.toBeNull();
			expect(res?.name).toBe('read_note');
			expect(res?.arguments).toEqual({ path: 'Daily/2026-09-23.md' });
			expect(res?.id).toBeDefined();
		});

		it('Python 스타일의 도구 호출 블록을 정상 파싱한다', () => {
			const block = 'append_to_note(path="Notes/Ideas.md", content="New idea")';
			const res = tryParseBlock(block);
			expect(res).not.toBeNull();
			expect(res?.name).toBe('append_to_note');
			expect(res?.arguments).toEqual({
				path: 'Notes/Ideas.md',
				content: 'New idea',
			});
		});

		it('XML 태그 기반(<name>, <arguments>) 블록을 정상 파싱한다', () => {
			const block = `
				<name>search_notes</name>
				<arguments>{"query": "Obsidian Lumina", "limit": 10}</arguments>
			`;
			const res = tryParseBlock(block);
			expect(res).not.toBeNull();
			expect(res?.name).toBe('search_notes');
			expect(res?.arguments).toEqual({ query: 'Obsidian Lumina', limit: 10 });
		});

		it('Claude 네이티브 스타일(<parameter name="...">...</parameter>) 블록을 정상 파싱한다', () => {
			const block = `
				<name>read_note</name>
				<parameter name="path">Project/Roadmap.md</parameter>
			`;
			const res = tryParseBlock(block);
			expect(res).not.toBeNull();
			expect(res?.name).toBe('read_note');
			expect(res?.arguments).toEqual({ path: 'Project/Roadmap.md' });
		});

		it('빈 문자열이나 잘못된 구문은 null을 반환한다', () => {
			expect(tryParseBlock('')).toBeNull();
			expect(tryParseBlock('   ')).toBeNull();
			expect(tryParseBlock('just normal conversation text')).toBeNull();
		});
	});

	describe('parseTextToolCalls', () => {
		it('표준 <lumina_tool_call> 태그를 파싱하고 cleanContent를 분리한다', () => {
			const text = `
I will check your note now.
<lumina_tool_call>
{"name": "read_active_note", "arguments": {}}
</lumina_tool_call>
Please wait a moment.
			`.trim();

			const { toolCalls, cleanContent } = parseTextToolCalls(text);
			expect(toolCalls).toHaveLength(1);
			expect(toolCalls[0].name).toBe('read_active_note');
			expect(toolCalls[0].arguments).toEqual({});
			expect(cleanContent).toContain('I will check your note now.');
			expect(cleanContent).toContain('Please wait a moment.');
			expect(cleanContent).not.toContain('<lumina_tool_call>');
		});

		it('대안 태그 구분자($lumina_tool_call$)를 정규화하여 파싱한다', () => {
			const text = `
$lumina_tool_call$
{"name": "get_backlinks", "arguments": {"path": "Index.md"}}
$/lumina_tool_call$
			`.trim();

			const { toolCalls } = parseTextToolCalls(text);
			expect(toolCalls).toHaveLength(1);
			expect(toolCalls[0].name).toBe('get_backlinks');
			expect(toolCalls[0].arguments).toEqual({ path: 'Index.md' });
		});

		it('Qwen 등에서 발생하는 변형 태그 포맷(<tool_name><argument>...</argument>)을 파싱한다', () => {
			const text = `
<search_vault>
<argument>{"query": "quantum computing"}</argument>
</lumina_tool_call>
			`.trim();

			const { toolCalls } = parseTextToolCalls(text);
			expect(toolCalls).toHaveLength(1);
			expect(toolCalls[0].name).toBe('search_vault');
			expect(toolCalls[0].arguments).toEqual({ query: 'quantum computing' });
		});

		it('스트리밍 도중 잘린 닫는 태그 없는 오픈 태그를 폴백으로 복구한다', () => {
			const text = `
Let me search the vault for that.
<lumina_tool_call>
{"name": "search_vault", "arguments": {"query": "machine learning"}}
			`.trim();

			const { toolCalls, cleanContent } = parseTextToolCalls(text);
			expect(toolCalls).toHaveLength(1);
			expect(toolCalls[0].name).toBe('search_vault');
			expect(toolCalls[0].arguments).toEqual({ query: 'machine learning' });
			expect(cleanContent).toBe('Let me search the vault for that.');
		});

		it('도구 호출이 없는 일반 메시지는 원문 그대로 반환한다', () => {
			const text = 'Hello, how can I help you today?';
			const { toolCalls, cleanContent } = parseTextToolCalls(text);
			expect(toolCalls).toHaveLength(0);
			expect(cleanContent).toBe(text);
		});
	});
});
