import { describe, it, expect, vi } from 'vitest';
import { extractToolResultText, truncateToolResult, MAX_TOOL_RESULT_CHARS } from './toolResultFormatter';

vi.mock('../locales/helpers', () => ({
	t: vi.fn((key, params) => `[truncated ${params?.total ?? 0}]`),
}));

describe('toolResultFormatter', () => {
	describe('extractToolResultText', () => {
		it('should return empty string for null or undefined', () => {
			expect(extractToolResultText(null)).toBe('');
			expect(extractToolResultText(undefined)).toBe('');
		});

		it('should return string as-is', () => {
			expect(extractToolResultText('hello world')).toBe('hello world');
		});

		it('should extract text from content array', () => {
			const mcpResult = {
				content: [
					{ type: 'text', text: 'line 1' },
					{ type: 'text', text: 'line 2' },
				],
			};
			expect(extractToolResultText(mcpResult)).toBe('line 1\nline 2');
		});

		it('should serialize arbitrary objects to JSON', () => {
			const obj = { foo: 'bar', count: 42 };
			expect(extractToolResultText(obj)).toBe(JSON.stringify(obj));
		});
	});

	describe('truncateToolResult', () => {
		it('should return text untouched if within limit', () => {
			const shortText = 'short tool result';
			expect(truncateToolResult(shortText, 'test_tool')).toBe(shortText);
		});

		it('should truncate text and append note if exceeding limit', () => {
			const longText = 'a'.repeat(MAX_TOOL_RESULT_CHARS + 50);
			const truncated = truncateToolResult(longText, 'test_tool');
			expect(truncated).toContain(`[truncated ${MAX_TOOL_RESULT_CHARS + 50}]`);
			expect(truncated.startsWith('a'.repeat(MAX_TOOL_RESULT_CHARS))).toBe(true);
		});
	});
});

