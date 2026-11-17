import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest';
import { moment } from 'obsidian';
import realMoment from 'moment';
import {
	DEFAULT_CHAT_HISTORY_ROOT,
	formatHistoryFolderPreview,
	hasUnsafeHistoryPathInput,
	normalizeHistoryRootPath,
	resolveHistoryBasePath,
	sanitizeHistorySubfolder,
	sanitizeProjectFolderName,
} from './historyPathUtils';

describe('historyPathUtils', () => {
	const sampleDate = new Date(2026, 10, 17, 21, 0, 0);
	const momentMock = moment as unknown as Mock;

	beforeEach(() => {
		momentMock.mockImplementation((inp?: unknown) => realMoment(inp as Date));
	});

	afterEach(() => {
		momentMock.mockReset();
	});

	describe('normalizeHistoryRootPath', () => {
		it('빈 값, 공백, 슬래시만 있는 입력은 기본값 chatHistory로 폴백한다', () => {
			expect(normalizeHistoryRootPath(undefined)).toBe(DEFAULT_CHAT_HISTORY_ROOT);
			expect(normalizeHistoryRootPath('')).toBe(DEFAULT_CHAT_HISTORY_ROOT);
			expect(normalizeHistoryRootPath('   ')).toBe(DEFAULT_CHAT_HISTORY_ROOT);
			expect(normalizeHistoryRootPath('///')).toBe(DEFAULT_CHAT_HISTORY_ROOT);
			expect(normalizeHistoryRootPath('..')).toBe(DEFAULT_CHAT_HISTORY_ROOT);
		});

		it('앞뒤 슬래시, 역슬래시, 상위 경로(..), OS 금지 문자를 안전하게 정제한다', () => {
			expect(normalizeHistoryRootPath('/chatHistory/')).toBe('chatHistory');
			expect(normalizeHistoryRootPath('Notes\\Chats\\')).toBe('Notes/Chats');
			expect(normalizeHistoryRootPath('../outside/my:chats*')).toBe('outside/my_chats_');
			expect(normalizeHistoryRootPath('CON/chats')).toBe('_CON/chats');
		});
	});

	describe('sanitizeHistorySubfolder', () => {
		it('중첩 상대 경로는 유지하되 위험 세그먼트와 금지 문자는 제거·치환한다', () => {
			expect(sanitizeHistorySubfolder('Work/Sub')).toBe('Work/Sub');
			expect(sanitizeHistorySubfolder('/Work\\Sub/')).toBe('Work/Sub');
			expect(sanitizeHistorySubfolder('///')).toBe('');
			expect(sanitizeHistorySubfolder('../Work/./Sub:1')).toBe('Work/Sub_1');
		});
	});

	describe('sanitizeProjectFolderName', () => {
		it('프로젝트 이름 내 슬래시는 단일 폴더 세그먼트 유지를 위해 _로 치환한다', () => {
			expect(sanitizeProjectFolderName('Work/A')).toBe('Work_A');
			expect(sanitizeProjectFolderName('CON')).toBe('_CON');
			expect(sanitizeProjectFolderName('MyProj... ')).toBe('MyProj');
			expect(sanitizeProjectFolderName('...')).toBe('');
		});
	});

	describe('hasUnsafeHistoryPathInput', () => {
		it('상위 경로 이동(..)과 금지 문자만 위험 입력으로 감지한다', () => {
			expect(hasUnsafeHistoryPathInput('/chatHistory/')).toBe(false);
			expect(hasUnsafeHistoryPathInput('Notes\\Chats')).toBe(false);
			expect(hasUnsafeHistoryPathInput('../outside')).toBe(true);
			expect(hasUnsafeHistoryPathInput('a/../b')).toBe(true);
			expect(hasUnsafeHistoryPathInput('my:chats')).toBe(true);
			expect(hasUnsafeHistoryPathInput('my*chats?')).toBe(true);
		});
	});

	describe('resolveHistoryBasePath & formatHistoryFolderPreview', () => {
		it('전역 루트, 프로젝트 하위 폴더, 날짜 포맷을 결합해 미리보기 경로를 반환한다', () => {
			expect(resolveHistoryBasePath('/MyChats/', 'Work/Sub')).toBe('MyChats/Work/Sub');

			const res = formatHistoryFolderPreview('/MyChats/', 'Work', '{{YYYY}}/{{MM}}', sampleDate);
			expect(res).toEqual({
				basePath: 'MyChats/Work',
				resolvedPath: 'MyChats/Work/2026/11',
				isFormatValid: true,
			});
		});

		it('잘못된 날짜 템플릿이면 isFormatValid=false와 basePath를 반환한다', () => {
			const res = formatHistoryFolderPreview('MyChats', 'Work', '{{YYYY', sampleDate);
			expect(res).toEqual({
				basePath: 'MyChats/Work',
				resolvedPath: 'MyChats/Work',
				isFormatValid: false,
			});
		});
	});
});
