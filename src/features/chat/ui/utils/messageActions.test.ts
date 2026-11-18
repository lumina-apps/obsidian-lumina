import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, TFolder, Notice, Modal, MarkdownView, type App } from 'obsidian';
import {
	openFile,
	openAttachment,
	insertToNote,
	appendToActiveNote,
	suggestNoteTitle,
	getDefaultNewNoteFolder,
	normalizeFolderInput,
	resolveUniqueNotePath,
	createAndOpenNote,
	FolderSuggestModal,
	SaveAsNoteModal,
	AttachmentPreviewModal,
} from './messageActions';
import type { ContextAttachment } from '../../../../shared/types/chat.types';

describe('messageActions', () => {
	let mockApp: App;
	let mockLeaf: { openFile: ReturnType<typeof vi.fn> };
	let mockVault: {
		getAbstractFileByPath: ReturnType<typeof vi.fn>;
		getAllLoadedFiles: ReturnType<typeof vi.fn>;
		cachedRead: ReturnType<typeof vi.fn>;
		process: ReturnType<typeof vi.fn>;
		create: ReturnType<typeof vi.fn>;
		createFolder: ReturnType<typeof vi.fn>;
	};
	let mockMetadataCache: {
		getFirstLinkpathDest: ReturnType<typeof vi.fn>;
	};
	let mockFileManager: {
		getNewFileParent: ReturnType<typeof vi.fn>;
	};
	let mockWorkspace: {
		getLeaf: ReturnType<typeof vi.fn>;
		activeEditor: { editor: { replaceSelection: ReturnType<typeof vi.fn> }; file?: TFile } | null;
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
			getAllLoadedFiles: vi.fn().mockReturnValue([]),
			cachedRead: vi.fn(),
			process: vi.fn(),
			create: vi.fn(),
			createFolder: vi.fn().mockResolvedValue(undefined),
		};

		mockMetadataCache = {
			getFirstLinkpathDest: vi.fn(),
		};

		mockFileManager = {
			getNewFileParent: vi.fn().mockReturnValue(new TFolder()),
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
			fileManager: mockFileManager,
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
			let capturedNotice = '';
			const obsidian = await import('obsidian');
			const noticeSpy = vi.spyOn(obsidian, 'Notice').mockImplementation(function (this: unknown, msg: string | DocumentFragment) {
				capturedNotice = typeof msg === 'string' ? msg : 'fragment';
				return {} as Notice;
			});

			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockMetadataCache.getFirstLinkpathDest.mockReturnValue(null);

			const mouseEvt = new MouseEvent('click');
			await openFile(mockApp, 'nonexistent.md', mouseEvt);

			expect(mockLeaf.openFile).not.toHaveBeenCalled();
			expect(capturedNotice).toBeTruthy();
			noticeSpy.mockRestore();
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

	describe('AttachmentPreviewModal', () => {
		it('이미지 첨부파일일 경우 h3 타이틀과 img 태그를 올바르게 렌더링하고 onClose 시 정리한다', () => {
			const modal = new AttachmentPreviewModal(mockApp, {
				type: 'external_file',
				name: 'photo.png',
				path: '',
				content: 'data:image/png;base64,abcdef123456',
			});

			modal.onOpen();

			const titleEl = modal.contentEl.querySelector('h3');
			expect(titleEl?.textContent).toBe('photo.png');
			const imgEl = modal.contentEl.querySelector('img');
			expect(imgEl).not.toBeNull();
			expect(imgEl?.src).toBe('data:image/png;base64,abcdef123456');
			expect(imgEl?.alt).toBe('photo.png');

			modal.onClose();
			expect(modal.contentEl.children.length).toBe(0);
		});

		it('텍스트 첨부파일일 경우 h3 타이틀과 pre 태그에 내용을 렌더링한다', () => {
			const modal = new AttachmentPreviewModal(mockApp, {
				type: 'file',
				name: 'snippet.txt',
				path: 'snippet.txt',
				content: 'Hello World Attachment Text Content',
			});

			modal.onOpen();

			const titleEl = modal.contentEl.querySelector('h3');
			expect(titleEl?.textContent).toBe('snippet.txt');
			const preEl = modal.contentEl.querySelector('pre');
			expect(preEl).not.toBeNull();
			expect(preEl?.textContent).toBe('Hello World Attachment Text Content');

			modal.onClose();
			expect(modal.contentEl.children.length).toBe(0);
		});
	});

	describe('appendToActiveNote', () => {
		it('활성 마크다운 노트의 끝에 개행을 맞춰 내용을 추가한다', async () => {
			const activeFile = new TFile();
			activeFile.path = 'Notes/Daily.md';
			activeFile.extension = 'md';
			mockWorkspace.getActiveFile.mockReturnValue(activeFile);

			let currentContent = 'Existing line';
			mockVault.process.mockImplementation(async (_file: TFile, fn: (data: string) => string) => {
				currentContent = fn(currentContent);
				return currentContent;
			});

			const result = await appendToActiveNote(mockApp, 'Appended answer');
			expect(result).toBe(true);
			expect(currentContent).toBe('Existing line\n\nAppended answer');
		});

		it('기존 내용이 단일 개행으로 끝나면 개행을 1개만 추가한다', async () => {
			const activeFile = new TFile();
			activeFile.path = 'Notes/Daily.md';
			activeFile.extension = 'md';
			mockWorkspace.getActiveFile.mockReturnValue(activeFile);

			let currentContent = 'Existing line\n';
			mockVault.process.mockImplementation(async (_file: TFile, fn: (data: string) => string) => {
				currentContent = fn(currentContent);
				return currentContent;
			});

			await appendToActiveNote(mockApp, 'Appended answer');
			expect(currentContent).toBe('Existing line\n\nAppended answer');
		});

		it('활성 파일이 비마크다운(.canvas 등)이면 내용을 추가하지 않고 false를 반환한다', async () => {
			const canvasFile = new TFile();
			canvasFile.path = 'Board.canvas';
			canvasFile.extension = 'canvas';
			mockWorkspace.getActiveFile.mockReturnValue(canvasFile);

			const result = await appendToActiveNote(mockApp, 'Should not append');
			expect(result).toBe(false);
			expect(mockVault.process).not.toHaveBeenCalled();
		});

		it('활성 마크다운 노트가 없으면 false를 반환한다', async () => {
			const result = await appendToActiveNote(mockApp, 'Some content');
			expect(result).toBe(false);
			expect(mockVault.process).not.toHaveBeenCalled();
		});
	});

	describe('Save as Note 유틸 및 모달', () => {
		it('suggestNoteTitle은 링크 URL·위키링크·마크다운 기호를 제거하고 깔끔한 제목을 추출한다', () => {
			expect(suggestNoteTitle('\n# 회의 요약: API/설계?\n본문')).toBe('회의 요약_ API_설계_');
			expect(
				suggestNoteTitle(
					'참고 문서: [사과 및 직접 링크](file:///Users/name/Documents/Vault/%EC%82%AC%EA%B3%BC.md)\n세부 내용',
				),
			).toBe('참고 문서_ 사과 및 직접 링크');
			expect(suggestNoteTitle('[[폴더/원본 노트|표시 이름]] 설명')).toBe('표시 이름 설명');
			expect(suggestNoteTitle('---\n> 참고: [링크](https://example.com)\n\n## 핵심 정리\n본문')).toBe('핵심 정리');
			expect(suggestNoteTitle('   \n   ')).toMatch(/^Lumina Note \d{4}-\d{2}-\d{2} \d{4}$/);
		});

		it('getDefaultNewNoteFolder는 Obsidian getNewFileParent 결과를 정규화한다', () => {
			const folder = new TFolder();
			folder.path = 'Inbox/Notes';
			mockFileManager.getNewFileParent.mockReturnValue(folder);

			expect(getDefaultNewNoteFolder(mockApp)).toBe('Inbox/Notes');

			const rootFolder = new TFolder();
			rootFolder.path = '/';
			mockFileManager.getNewFileParent.mockReturnValue(rootFolder);

			expect(getDefaultNewNoteFolder(mockApp)).toBe('');
		});

		it('resolveUniqueNotePath는 중복 파일이 존재할 경우 번호 접미사를 붙인다', () => {
			const existing = new TFile();
			mockVault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'Inbox/Summary.md' || p === 'Inbox/Summary (1).md') return existing;
				return null;
			});

			expect(resolveUniqueNotePath(mockApp, 'Inbox', 'Summary')).toBe('Inbox/Summary (2).md');
		});

		it('createAndOpenNote는 폴더를 보장하고 노트를 생성한 뒤 새 탭으로 연다', async () => {
			const createdFile = new TFile();
			createdFile.path = 'Inbox/My Note.md';
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.create.mockResolvedValue(createdFile);

			const result = await createAndOpenNote(mockApp, 'Inbox', 'My Note', 'Body content');
			expect(mockVault.createFolder).toHaveBeenCalledWith('Inbox');
			expect(mockVault.create).toHaveBeenCalledWith('Inbox/My Note.md', 'Body content');
			expect(mockWorkspace.getLeaf).toHaveBeenCalledWith('tab');
			expect(mockLeaf.openFile).toHaveBeenCalledWith(createdFile);
			expect(result).toBe(createdFile);
		});

		it('normalizeFolderInput은 루트·슬래시·상위경로 순회를 안전하게 정제한다', () => {
			expect(normalizeFolderInput('')).toBe('');
			expect(normalizeFolderInput('/')).toBe('');
			expect(normalizeFolderInput('/Inbox/Notes/')).toBe('Inbox/Notes');
			expect(normalizeFolderInput('../Secret/Sub')).toBe('Secret/Sub');
		});

		it('SaveAsNoteModal은 제목과 저장 폴더를 수정해 저장할 수 있다', async () => {
			const createdFile = new TFile();
			createdFile.path = 'Projects/커스텀 제목.md';
			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockVault.create.mockResolvedValue(createdFile);

			const modal = new SaveAsNoteModal(mockApp, '# 제목 테스트\n내용입니다.');
			modal.open();

			const titleInput = modal.contentEl.querySelector('#lumina-save-note-title-input') as HTMLInputElement | null;
			const folderInput = modal.contentEl.querySelector('#lumina-save-note-folder-input') as HTMLInputElement | null;
			expect(titleInput).not.toBeNull();
			expect(folderInput).not.toBeNull();
			expect(titleInput?.value).toBe('제목 테스트');

			if (titleInput) {
				titleInput.value = '커스텀 제목';
				titleInput.dispatchEvent(new Event('input'));
			}
			if (folderInput) {
				folderInput.value = 'Projects';
				folderInput.dispatchEvent(new Event('input'));
			}

			const saveBtn = modal.contentEl.querySelector('.lumina-save-note-modal__btn-save') as HTMLButtonElement;
			saveBtn.click();

			await vi.waitFor(() => {
				expect(mockVault.create).toHaveBeenCalledWith('Projects/커스텀 제목.md', '# 제목 테스트\n내용입니다.');
			});
			modal.close();
		});

		it('FolderSuggestModal은 볼트 폴더 목록을 정렬하고 선택 시 콜백을 호출한다', () => {
			const root = Object.assign(new TFolder(), { path: '/' });
			const notes = Object.assign(new TFolder(), { path: 'Notes' });
			const archive = Object.assign(new TFolder(), { path: 'Archive' });
			const file = Object.assign(new TFile(), { path: 'readme.md' });
			mockVault.getAllLoadedFiles.mockReturnValue([notes, file, archive, root]);

			const onSelect = vi.fn();
			const folderModal = new FolderSuggestModal(mockApp, onSelect);
			const items = folderModal.getItems();

			expect(items.map((f) => f.path)).toEqual(['/', 'Archive', 'Notes']);

			folderModal.onChooseItem(root);
			expect(onSelect).toHaveBeenCalledWith('');

			folderModal.onChooseItem(notes);
			expect(onSelect).toHaveBeenCalledWith('Notes');
		});
	});
});
