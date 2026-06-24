import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	ensureFolderExists,
	isMarkdownFile,
	getFileExtension,
	sanitizeFilename,
	enforceMarkdownExt,
	sanitizeFilePath,
	extractFileName
} from './fileUtils';
import { TFile, App } from 'obsidian';

describe('fileUtils', () => {
	let mockApp: App;
	
	beforeEach(() => {
		mockApp = {
			vault: {
				getAbstractFileByPath: vi.fn(),
				createFolder: vi.fn().mockResolvedValue(undefined),
			}
		} as unknown as App;
	});

	describe('ensureFolderExists', () => {
		it('최상위 경로인 경우 아무 것도 하지 않는다', async () => {
			await ensureFolderExists(mockApp, 'rootFile.md');
			expect(mockApp.vault.getAbstractFileByPath).not.toHaveBeenCalled();
		});

		it('폴더가 이미 존재하면 아무 것도 하지 않는다', async () => {
			vi.mocked(mockApp.vault.getAbstractFileByPath).mockReturnValue({} as any);
			await ensureFolderExists(mockApp, 'folder/file.md');
			expect(mockApp.vault.getAbstractFileByPath).toHaveBeenCalledWith('folder');
			expect(mockApp.vault.createFolder).not.toHaveBeenCalled();
		});

		it('폴더가 존재하지 않으면 생성한다', async () => {
			vi.mocked(mockApp.vault.getAbstractFileByPath).mockReturnValue(null);
			await ensureFolderExists(mockApp, 'folder/file.md');
			expect(mockApp.vault.createFolder).toHaveBeenCalledWith('folder');
		});

		it('중첩된 폴더가 존재하지 않으면 재귀적으로 생성한다', async () => {
			// 처음에는 두 폴더 모두 존재하지 않음
			vi.mocked(mockApp.vault.getAbstractFileByPath).mockReturnValue(null);
			
			await ensureFolderExists(mockApp, 'folder1/folder2/file.md');
			
			expect(mockApp.vault.createFolder).toHaveBeenCalledWith('folder1');
			expect(mockApp.vault.createFolder).toHaveBeenCalledWith('folder1/folder2');
		});
	});

	describe('isMarkdownFile', () => {
		it('TFile 인스턴스이고 확장자가 md이면 true를 반환한다', () => {
			const file = new TFile();
			file.extension = 'md';
			expect(isMarkdownFile(file)).toBe(true);
		});

		it('TFile 인스턴스이지만 확장자가 md가 아니면 false를 반환한다', () => {
			const file = new TFile();
			file.extension = 'png';
			expect(isMarkdownFile(file)).toBe(false);
		});

		it('TFile 인스턴스가 아니면 false를 반환한다', () => {
			expect(isMarkdownFile({ extension: 'md' })).toBe(false);
			expect(isMarkdownFile(null)).toBe(false);
		});
	});

	describe('getFileExtension', () => {
		it('파일 확장자를 소문자로 반환한다', () => {
			expect(getFileExtension('image.PNG')).toBe('png');
			expect(getFileExtension('document.txt')).toBe('txt');
		});

		it('확장자가 없는 경우 빈 문자열을 반환한다', () => {
			expect(getFileExtension('filename')).toBe('filename');
		});
	});

	describe('sanitizeFilename', () => {
		it('특수문자를 _로 치환한다', () => {
			expect(sanitizeFilename('file*name?.md')).toBe('file_name_.md');
			expect(sanitizeFilename('my<new>file|')).toBe('my_new_file_');
		});

		it('정상적인 파일명은 그대로 반환한다', () => {
			expect(sanitizeFilename('my_file-name.md')).toBe('my_file-name.md');
		});
	});

	describe('enforceMarkdownExt', () => {
		it('.md 확장자가 없으면 추가한다', () => {
			expect(enforceMarkdownExt('folder/file')).toBe('folder/file.md');
		});

		it('이미 .md 확장자가 있으면 추가하지 않는다', () => {
			expect(enforceMarkdownExt('folder/file.md')).toBe('folder/file.md');
			expect(enforceMarkdownExt('folder/file.MD')).toBe('folder/file.MD');
		});
	});

	describe('sanitizeFilePath', () => {
		it('경로 순회(..)를 방지한다', () => {
			expect(sanitizeFilePath('../folder/file.md')).toBe('folder/file.md');
			expect(sanitizeFilePath('folder/../file.md')).toBe('folder/file.md');
		});

		it('파일명 특수문자를 치환한다', () => {
			expect(sanitizeFilePath('folder/file*name?.md')).toBe('folder/file_name_.md');
		});

		it('enforceMd가 true이면 .md 확장자를 보장한다', () => {
			expect(sanitizeFilePath('folder/file')).toBe('folder/file.md');
		});

		it('enforceMd가 false이면 .md 확장자를 보장하지 않는다', () => {
			expect(sanitizeFilePath('folder/file', false)).toBe('folder/file');
		});

		it('대괄호로 감싸진 경로를 정제한다', () => {
			expect(sanitizeFilePath('[[folder/file]]')).toBe('folder/file.md');
			expect(sanitizeFilePath('[[folder/file.md]]')).toBe('folder/file.md');
		});

		it('짝이 맞지 않는 대괄호를 정제한다', () => {
			expect(sanitizeFilePath('[[folder/file.md')).toBe('folder/file.md');
			expect(sanitizeFilePath('folder/file.md]]')).toBe('folder/file.md');
		});
	});

	describe('extractFileName', () => {
		it('경로에서 확장자가 제외된 파일명만 추출한다', () => {
			expect(extractFileName('folder/subfolder/my-file.md')).toBe('my-file');
			expect(extractFileName('my-file.md')).toBe('my-file');
		});

		it('.md 확장자가 없는 경우 파일명 전체를 반환한다', () => {
			expect(extractFileName('folder/my-file.txt')).toBe('my-file.txt');
		});
	});
});
