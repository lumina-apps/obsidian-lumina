import { describe, it, expect, vi } from 'vitest';
import { insertLinkToActiveEditor } from './editorUtils';
import { TFile, type App } from 'obsidian';

describe('editorUtils - insertLinkToActiveEditor', () => {
	it('activeEditor가 있으면 generateMarkdownLink 결과를 커서 위치에 삽입한다', () => {
		const targetFile = new TFile();
		const mockEditor = {
			getCursor: vi.fn().mockReturnValue({ line: 1, ch: 0 }),
			replaceRange: vi.fn(),
		};
		const mockApp = {
			workspace: {
				activeEditor: { editor: mockEditor },
				getLeavesOfType: vi.fn().mockReturnValue([]),
			},
			vault: {
				getAbstractFileByPath: vi.fn().mockReturnValue(targetFile),
			},
			fileManager: {
				generateMarkdownLink: vi.fn().mockReturnValue('[[Notes/Target Note]]'),
			},
		} as unknown as App;

		const result = insertLinkToActiveEditor(mockApp, 'Notes/Target Note.md', 'Notes/Source.md');
		expect(result).toBe(true);
		expect(mockApp.fileManager.generateMarkdownLink).toHaveBeenCalledWith(targetFile, 'Notes/Source.md');
		expect(mockEditor.replaceRange).toHaveBeenCalledWith('[[Notes/Target Note]]', { line: 1, ch: 0 });
	});

	it('에디터가 없으면 false를 반환한다', () => {
		const mockApp = {
			workspace: {
				activeEditor: null,
				getLeavesOfType: vi.fn().mockReturnValue([]),
			},
			vault: {
				getAbstractFileByPath: vi.fn().mockReturnValue(null),
			},
		} as unknown as App;

		const result = insertLinkToActiveEditor(mockApp, 'Notes/Target.md');
		expect(result).toBe(false);
	});
});
