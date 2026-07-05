import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	applyReadLimit,
	getStringArg,
	getNumberArg,
	getStringOptArg,
	getTodayString,
	blockIfPathNotAllowed
} from './handlerHelpers';
import type { ToolHandlerContext } from './toolTypes';
import type { PathGuard } from './pathGuard';

// Mock localization
vi.mock('../../../shared/locales/helpers', () => ({
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	t: vi.fn((key: string, vars?: any) => {
		if (key === 'mcpServerTools.common.truncated' && vars?.limit) {
			return `... (truncated at ${vars.limit})`;
		}
		if (key === 'mcpServerTools.common.pathExcluded' && vars?.path) {
			return `Path excluded: ${vars.path}`;
		}
		return key;
	})
}));

describe('handlerHelpers', () => {
	describe('applyReadLimit', () => {
		it('should return original content if within limit', () => {
			const content = 'hello world';
			expect(applyReadLimit(content, 50)).toBe(content);
			expect(applyReadLimit(content, 11)).toBe(content);
		});

		it('should truncate and append translation if exceeding limit', () => {
			const content = 'hello world';
			expect(applyReadLimit(content, 5)).toBe('hello... (truncated at 5)');
		});

		it('should handle empty string correctly', () => {
			expect(applyReadLimit('', 5)).toBe('');
		});
	});

	describe('getStringArg', () => {
		it('should return the string value if it exists and is a string', () => {
			expect(getStringArg({ key: 'value' }, 'key')).toBe('value');
		});

		it('should return empty string if the value is missing', () => {
			expect(getStringArg({}, 'key')).toBe('');
		});

		it('should return empty string if the value is not a string', () => {
			expect(getStringArg({ key: 123 }, 'key')).toBe('');
			expect(getStringArg({ key: null }, 'key')).toBe('');
		});
	});

	describe('getNumberArg', () => {
		it('should return the number value if it exists and is a number', () => {
			expect(getNumberArg({ key: 123 }, 'key')).toBe(123);
		});

		it('should return undefined if the value is missing', () => {
			expect(getNumberArg({}, 'key')).toBeUndefined();
		});

		it('should return undefined if the value is not a number', () => {
			expect(getNumberArg({ key: '123' }, 'key')).toBeUndefined();
			expect(getNumberArg({ key: null }, 'key')).toBeUndefined();
		});
	});

	describe('getStringOptArg', () => {
		it('should return the string value if it exists and is a string', () => {
			expect(getStringOptArg({ key: 'value' }, 'key')).toBe('value');
		});

		it('should return undefined if the value is missing', () => {
			expect(getStringOptArg({}, 'key')).toBeUndefined();
		});

		it('should return undefined if the value is null', () => {
			expect(getStringOptArg({ key: null }, 'key')).toBeUndefined();
		});

		it('should return undefined if the value is not a string', () => {
			expect(getStringOptArg({ key: 123 }, 'key')).toBeUndefined();
		});
	});

	describe('getTodayString', () => {
		it('should return a string in yyyy-MM-dd format', () => {
			const today = getTodayString();
			expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			
			// Verify it matches actual today
			const date = new Date().toISOString().split('T')[0];
			expect(today).toBe(date);
		});
	});

	describe('blockIfPathNotAllowed', () => {
		let mockCtx: ToolHandlerContext;
		let mockPathGuard: PathGuard;

		beforeEach(() => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			mockCtx = { plugin: {} as any } as ToolHandlerContext;
			mockPathGuard = {
				isAgentPathAllowed: vi.fn()
			} as unknown as PathGuard;
		});

		it('should return null if path is allowed', () => {
			vi.mocked(mockPathGuard.isAgentPathAllowed).mockReturnValue(true);
			const result = blockIfPathNotAllowed('test/path', mockCtx, mockPathGuard);
			expect(result).toBeNull();
			expect(mockPathGuard.isAgentPathAllowed).toHaveBeenCalledWith('test/path', mockCtx.plugin);
		});

		it('should return an error ToolResult if path is not allowed', () => {
			vi.mocked(mockPathGuard.isAgentPathAllowed).mockReturnValue(false);
			const result = blockIfPathNotAllowed('test/path', mockCtx, mockPathGuard);
			
			expect(result).toEqual({
				isError: true,
				content: [{ type: 'text', text: 'Path excluded: test/path' }]
			});
			expect(mockPathGuard.isAgentPathAllowed).toHaveBeenCalledWith('test/path', mockCtx.plugin);
		});
	});
});
