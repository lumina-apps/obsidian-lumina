import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	applyReadLimit,
	getStringArg,
	getNumberArg,
	getStringOptArg,
	getTodayString,
	getDailyNotePath,
	blockIfPathNotAllowed,
} from './handlerHelpers';
import type { App } from 'obsidian';
import type { PathGuard } from './pathGuard';
import type { ToolHandlerContext } from './toolTypes';

describe('handlerHelpers', () => {
	describe('applyReadLimit', () => {
		it('내용이 제한 이하이면 원본 내용을 그대로 반환한다', () => {
			const text = 'Hello world';
			expect(applyReadLimit(text, 100)).toBe(text);
		});

		it('내용이 제한을 초과하면 자르고 안내 문구를 덧붙인다', () => {
			const text = 'Hello world, this is a long text';
			const result = applyReadLimit(text, 10);
			expect(result.startsWith('Hello worl')).toBe(true);
			expect(result).toContain('10');
		});
	});

	describe('getStringArg', () => {
		it('존재하는 문자열 인수를 반환한다', () => {
			expect(getStringArg({ path: 'note.md' }, 'path')).toBe('note.md');
		});

		it('인수가 없거나 문자열이 아니면 빈 문자열을 반환한다', () => {
			expect(getStringArg({}, 'path')).toBe('');
			expect(getStringArg({ path: 123 }, 'path')).toBe('');
		});
	});

	describe('getNumberArg', () => {
		it('존재하는 숫자 인수를 반환한다', () => {
			expect(getNumberArg({ count: 42 }, 'count')).toBe(42);
		});

		it('숫자가 아니면 undefined를 반환한다', () => {
			expect(getNumberArg({}, 'count')).toBeUndefined();
			expect(getNumberArg({ count: '42' }, 'count')).toBeUndefined();
		});
	});

	describe('getStringOptArg', () => {
		it('문자열 인수를 반환한다', () => {
			expect(getStringOptArg({ tag: 'daily' }, 'tag')).toBe('daily');
		});

		it('null 또는 undefined이면 undefined를 반환한다', () => {
			expect(getStringOptArg({}, 'tag')).toBeUndefined();
			expect(getStringOptArg({ tag: null }, 'tag')).toBeUndefined();
		});
	});

	describe('getTodayString', () => {
		it('YYYY-MM-DD 형태의 날짜 문자열을 반환한다', () => {
			const today = getTodayString();
			expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		});
	});

	describe('getDailyNotePath', () => {
		let mockApp: App;

		beforeEach(() => {
			mockApp = {
				vault: {
					adapter: {
						exists: vi.fn(),
						read: vi.fn(),
					},
				},
			} as unknown as App;
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it('데일리 노트 설정 파일이 없으면 기본값 YYYY-MM-DD.md를 반환한다', async () => {
			(mockApp.vault.adapter.exists as any).mockResolvedValue(false);

			const path = await getDailyNotePath(mockApp);
			expect(path).toMatch(/^\d{4}-\d{2}-\d{2}\.md$/);
		});

		it('데일리 노트 설정에 folder와 format이 있으면 반영된 경로를 반환한다', async () => {
			(mockApp.vault.adapter.exists as any).mockResolvedValue(true);
			(mockApp.vault.adapter.read as any).mockResolvedValue(
				JSON.stringify({ folder: 'Journal/Daily', format: 'YYYY/MM/DD' }),
			);

			// window.moment가 있는 경우 모킹
			(window as any).moment = () => ({
				format: (fmt: string) => (fmt === 'YYYY/MM/DD' ? '2026/09/12' : '2026-09-12'),
			});

			const path = await getDailyNotePath(mockApp);
			expect(path).toBe('Journal/Daily/2026/09/12.md');
			delete (window as any).moment;
		});

		it('설정 파일의 JSON이 손상되었어도 에러 없이 기본 경로로 폴백한다', async () => {
			(mockApp.vault.adapter.exists as any).mockResolvedValue(true);
			(mockApp.vault.adapter.read as any).mockResolvedValue('invalid json {{{');

			const path = await getDailyNotePath(mockApp);
			expect(path).toMatch(/\.md$/);
		});
	});

	describe('blockIfPathNotAllowed', () => {
		it('경로가 허용된 경우 null을 반환한다', () => {
			const mockPathGuard = {
				isAgentPathAllowed: vi.fn().mockReturnValue(true),
			} as unknown as PathGuard;

			const mockCtx = {
				plugin: {},
			} as unknown as ToolHandlerContext;

			const result = blockIfPathNotAllowed('notes/test.md', mockCtx, mockPathGuard);
			expect(result).toBeNull();
		});

		it('경로가 허용되지 않은 경우 오류 결과를 반환한다', () => {
			const mockPathGuard = {
				isAgentPathAllowed: vi.fn().mockReturnValue(false),
			} as unknown as PathGuard;

			const mockCtx = {
				plugin: {},
			} as unknown as ToolHandlerContext;

			const result = blockIfPathNotAllowed('private/secret.md', mockCtx, mockPathGuard);
			expect(result).not.toBeNull();
			expect(result?.isError).toBe(true);
		});
	});
});
