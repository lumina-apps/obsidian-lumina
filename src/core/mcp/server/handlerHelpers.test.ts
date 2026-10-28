import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	applyReadLimit,
	getStringArg,
	getNumberArg,
	getStringOptArg,
	getTodayString,
	getDailyNotePath,
	blockIfPathNotAllowed,
	getNormalizedFileTags,
	fileMatchesTags,
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

		it('숫자형 문자열 인수를 숫자로 파싱하여 반환한다', () => {
			expect(getNumberArg({ count: '42' }, 'count')).toBe(42);
			expect(getNumberArg({ count: '3.14' }, 'count')).toBe(3.14);
		});

		it('숫자가 아니거나 빈 문자열이면 undefined를 반환한다', () => {
			expect(getNumberArg({}, 'count')).toBeUndefined();
			expect(getNumberArg({ count: 'abc' }, 'count')).toBeUndefined();
			expect(getNumberArg({ count: '' }, 'count')).toBeUndefined();
			expect(getNumberArg({ count: '   ' }, 'count')).toBeUndefined();
			expect(getNumberArg({ count: NaN }, 'count')).toBeUndefined();
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
					configDir: '.obsidian',
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

		it('app.vault.configDir가 설정되어 있으면 해당 설정을 읽는다', async () => {
			mockApp.vault.configDir = '.custom-config';
			vi.mocked(mockApp.vault.adapter.exists).mockImplementation((filePath: string) => {
				return Promise.resolve(filePath === '.custom-config/daily-notes.json');
			});
			vi.mocked(mockApp.vault.adapter.read).mockResolvedValue(
				JSON.stringify({ folder: 'CustomDaily' }),
			);

			const path = await getDailyNotePath(mockApp);
			expect(path).toMatch(/^CustomDaily\/\d{4}-\d{2}-\d{2}\.md$/);
		});

		it('app.vault.configDir가 없으면 기본 경로로 폴백한다', async () => {
			mockApp.vault.configDir = '';

			const path = await getDailyNotePath(mockApp);
			expect(path).toMatch(/^\d{4}-\d{2}-\d{2}\.md$/);
		});

		it('targetDate 인자가 주어지면 해당 일자의 데일리 노트 경로를 반환한다', async () => {
			const path = await getDailyNotePath(mockApp, '2026-12-25');
			expect(path).toBe('2026-12-25.md');
		});
	});

	describe('getNormalizedFileTags and fileMatchesTags', () => {
		it('본문 해시태그와 프론트매터 태그를 소문자 # 접두사로 중복 없이 정규화한다', () => {
			const cache = {
				tags: [{ tag: '#Obsidian' }, { tag: '#AI/LLM' }],
				frontmatter: {
					tags: ['markdown', '#ai/llm', 'Productivity'],
				},
			} as any;

			const tags = getNormalizedFileTags(cache);
			expect(tags).toContain('#obsidian');
			expect(tags).toContain('#ai/llm');
			expect(tags).toContain('#markdown');
			expect(tags).toContain('#productivity');
			expect(tags.filter(t => t === '#ai/llm')).toHaveLength(1);
		});

		it('fileMatchesTags는 대소문자 및 # 접두사 유무와 무관하게 정확히 매칭한다', () => {
			const fileTags = ['#obsidian', '#ai/llm', '#notes'];

			expect(fileMatchesTags(fileTags, ['obsidian', '#AI/LLM'])).toBe(true);
			expect(fileMatchesTags(fileTags, ['#OBSIDIAN'])).toBe(true);
			expect(fileMatchesTags(fileTags, ['obsidian', 'missingTag'])).toBe(false);
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
