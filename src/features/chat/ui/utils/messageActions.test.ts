import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, Notice, Modal, MarkdownView, type App } from 'obsidian';
import { openFile, openAttachment, insertToNote, AttachmentPreviewModal } from './messageActions';
import type { ContextAttachment } from '../../../../shared/types/chat.types';

describe('messageActions', () => {
	let mockApp: App;
	let mockLeaf: { openFile: ReturnType<typeof vi.fn> };
	let mockVault: {
		getAbstractFileByPath: ReturnType<typeof vi.fn>;
		cachedRead: ReturnType<typeof vi.fn>;
	};
	let mockMetadataCache: {
		getFirstLinkpathDest: ReturnType<typeof vi.fn>;
	};
	let mockWorkspace: {
		getLeaf: ReturnType<typeof vi.fn>;
		activeEditor: { editor: { replaceSelection: ReturnType<typeof vi.fn> } } | null;
		getActiveViewOfType: ReturnType<typeof vi.fn>;
		getActiveFile: ReturnType<typeof vi.fn>;
		getLeavesOfType: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		vi.clearAllMocks();

		mockLeaf = {
			openFile: vi.fn().mockResolvedValue(undefined),
		};

		mockVault = {
			getAbstractFileByPath: vi.fn(),
			cachedRead: vi.fn(),
		};

		mockMetadataCache = {
			getFirstLinkpathDest: vi.fn(),
		};

		mockWorkspace = {
			getLeaf: vi.fn().mockReturnValue(mockLeaf),
			activeEditor: null,
			getActiveViewOfType: vi.fn().mockReturnValue(null),
			getActiveFile: vi.fn().mockReturnValue(null),
			getLeavesOfType: vi.fn().mockReturnValue([]),
		};

		mockApp = {
			vault: mockVault,
			metadataCache: mockMetadataCache,
			workspace: mockWorkspace,
		} as unknown as App;
	});

	describe('openFile', () => {
		it('직접 일치하는 파일이 존재할 경우 해당 파일을 연다', async () => {
			const testFile = new TFile();
			testFile.path = 'Notes/test.md';
			mockVault.getAbstractFileByPath.mockReturnValue(testFile);

			const mouseEvt = new MouseEvent('click');
			await openFile(mockApp, 'Notes/test.md', mouseEvt);

			expect(mockWorkspace.getLeaf).toHaveBeenCalledWith(false);
			expect(mockLeaf.openFile).toHaveBeenCalledWith(testFile, undefined);
		});

		it('Ctrl/Cmd 키 또는 마우스 휠 클릭 시 새 탭("tab")으로 연다', async () => {
			const testFile = new TFile();
			testFile.path = 'Notes/test.md';
			mockVault.getAbstractFileByPath.mockReturnValue(testFile);

			const ctrlEvt = new MouseEvent('click', { ctrlKey: true });
			await openFile(mockApp, 'Notes/test.md', ctrlEvt);
			expect(mockWorkspace.getLeaf).toHaveBeenCalledWith('tab');

			const metaEvt = new MouseEvent('click', { metaKey: true });
			await openFile(mockApp, 'Notes/test.md', metaEvt);
			expect(mockWorkspace.getLeaf).toHaveBeenCalledWith('tab');

			const middleClickEvt = new MouseEvent('auxclick', { button: 1 });
			await openFile(mockApp, 'Notes/test.md', middleClickEvt);
			expect(mockWorkspace.getLeaf).toHaveBeenCalledWith('tab');
		});

		it('직접 경로가 없으면 metadataCache.getFirstLinkpathDest를 통해 찾는다', async () => {
			const fallbackFile = new TFile();
			fallbackFile.path = 'Subfolder/FoundNote.md';
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockMetadataCache.getFirstLinkpathDest.mockReturnValue(fallbackFile);

			const mouseEvt = new MouseEvent('click');
			await openFile(mockApp, 'FoundNote', mouseEvt);

			expect(mockMetadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('FoundNote', '');
			expect(mockLeaf.openFile).toHaveBeenCalledWith(fallbackFile, undefined);
		});

		it('linkpathDest도 없으면 .md 확장자를 붙여 검색한다', async () => {
			const mdExtFile = new TFile();
			mdExtFile.path = 'Notes/AutoExt.md';
			mockVault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'Notes/AutoExt.md') return mdExtFile;
				return null;
			});
			mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

			const mouseEvt = new MouseEvent('click');
			await openFile(mockApp, 'Notes/AutoExt', mouseEvt);

			expect(mockLeaf.openFile).toHaveBeenCalledWith(mdExtFile, undefined);
		});

		it('chunkText가 제공되면 해당 청크의 줄 번호를 계산하여 openFile eState로 전달한다', async () => {
			const testFile = new TFile();
			testFile.path = 'doc.md';
			mockVault.getAbstractFileByPath.mockReturnValue(testFile);
			mockVault.cachedRead.mockResolvedValue('line 0\nline 1\n# Title\nThis is chunk content for testing\nline 4');

			const mouseEvt = new MouseEvent('click');
			await openFile(mockApp, 'doc.md', mouseEvt, 'This is chunk content for testing');

			expect(mockLeaf.openFile).toHaveBeenCalledWith(testFile, {
				eState: { line: 3 },
			});
		});

		it('파일을 찾지 못하면 Notice를 띄운다', async () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

			const mouseEvt = new MouseEvent('click');
			await openFile(mockApp, 'nonexistent.md', mouseEvt);

			expect(mockLeaf.openFile).not.toHaveBeenCalled();
		});
	});

	describe('openAttachment', () => {
		it('type이 file / active_note / canvas인 경우 openFile을 호출한다', () => {
			const testFile = new TFile();
			testFile.path = 'Diagram.canvas';
			mockVault.getAbstractFileByPath.mockReturnValue(testFile);

			const att: ContextAttachment = {
				type: 'canvas',
				path: 'Diagram.canvas',
				name: 'Diagram',
			};

			openAttachment(mockApp, att, new MouseEvent('click'));
			expect(mockVault.getAbstractFileByPath).toHaveBeenCalledWith('Diagram.canvas');
		});

		it('type이 url인 경우 window.open을 호출한다', () => {
			const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

			const att: ContextAttachment = {
				type: 'url',
				path: 'https://example.com/docs',
				name: 'Docs',
			};

			openAttachment(mockApp, att, new MouseEvent('click'));
			expect(openSpy).toHaveBeenCalledWith('https://example.com/docs', '_blank', 'noopener,noreferrer');
			openSpy.mockRestore();
		});

		it('type이 tag인 경우 global-search 플러그인이 있으면 검색을 실행한다', () => {
			const searchSpy = vi.fn();
			(mockApp as unknown as { internalPlugins: unknown }).internalPlugins = {
				getPluginById: (id: string) => {
					if (id === 'global-search') {
						return { instance: { openGlobalSearch: searchSpy } };
					}
					return null;
				},
			};

			const att: ContextAttachment = {
				type: 'tag',
				path: '',
				name: 'obsidian/tag',
			};

			openAttachment(mockApp, att, new MouseEvent('click'));
			expect(searchSpy).toHaveBeenCalledWith('tag:obsidian/tag');
		});

		it('type이 external_file이고 path가 비어있어도(히스토리 복원 상황) 파일명으로 볼트 파일을 찾아 연다', () => {
			const savedFile = new TFile();
			savedFile.path = 'Attachments/Pasted_Image_123.png';
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockMetadataCache.getFirstLinkpathDest.mockReturnValue(savedFile);

			// path가 비어 있는 과거 히스토리 복원 attachment
			const att: ContextAttachment = {
				type: 'external_file',
				path: '',
				name: 'Pasted_Image_123.png',
			};

			openAttachment(mockApp, att, new MouseEvent('click'));

			// getFirstLinkpathDest를 통해 복원된 파일을 정상적으로 연다
			expect(mockMetadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('Pasted_Image_123.png', '');
			expect(mockLeaf.openFile).toHaveBeenCalledWith(savedFile, undefined);
		});

		it('type이 external_file이고 볼트에 파일이 없지만 content(base64)가 있으면 AttachmentPreviewModal을 연다', () => {
			const modalOpenSpy = vi.spyOn(Modal.prototype, 'open').mockImplementation(() => {});

			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

			const att: ContextAttachment = {
				type: 'external_file',
				path: '',
				name: 'temp_screen.png',
				content: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
			};

			openAttachment(mockApp, att, new MouseEvent('click'));

			expect(modalOpenSpy).toHaveBeenCalled();
			modalOpenSpy.mockRestore();
		});

		it('type이 external_file이고 볼트에 파일도 없고 content도 없으면 안전하게 종료된다 (무반응 크래시 방지)', () => {
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

			const att: ContextAttachment = {
				type: 'external_file',
				path: '',
				name: 'deleted_image.png',
			};

			expect(() => {
				openAttachment(mockApp, att, new MouseEvent('click'));
			}).not.toThrow();

			expect(mockLeaf.openFile).not.toHaveBeenCalled();
		});
	});

	describe('insertToNote', () => {
		it('activeEditor가 있으면 해당 에디터의 커서 위치에 내용을 삽입한다', () => {
			const replaceSpy = vi.fn();
			mockWorkspace.activeEditor = {
				editor: { replaceSelection: replaceSpy },
			};

			insertToNote(mockApp, 'Inserted text');
			expect(replaceSpy).toHaveBeenCalledWith('Inserted text');
		});

		it('activeEditor가 없지만 활성 마크다운 뷰가 있으면 해당 뷰 에디터에 삽입한다', () => {
			const replaceSpy = vi.fn();
			const mockView = {
				editor: { replaceSelection: replaceSpy },
			};
			mockWorkspace.getActiveViewOfType.mockReturnValue(mockView as unknown as MarkdownView);

			insertToNote(mockApp, 'Fallback text');
			expect(replaceSpy).toHaveBeenCalledWith('Fallback text');
		});

		it('에디터나 마크다운 뷰가 전혀 없어도 예외 없이 처리된다', () => {
			expect(() => {
				insertToNote(mockApp, 'Some text');
			}).not.toThrow();
		});
	});
});
