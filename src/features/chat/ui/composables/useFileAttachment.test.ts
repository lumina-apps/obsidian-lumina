import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, TFolder } from 'obsidian';
import {
	createRemoveAttachment,
	handleFiles,
	createFileInputTrigger,
	createDragOverHandler,
} from './useFileAttachment';
import { normalizePastedFile } from '../../utils/fileAttachmentUtils';
import type { ContextAttachment } from '../../../../shared/types/chat.types';
import type LuminaPlugin from '../../../../main';
import * as fileAttachmentUtils from '../../utils/fileAttachmentUtils';

describe('useFileAttachment composable', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('createRemoveAttachment removes item at specified index', () => {
		const attachments: ContextAttachment[] = [
			{ type: 'file', path: 'a.md', name: 'a.md' },
			{ type: 'file', path: 'b.md', name: 'b.md' },
			{ type: 'file', path: 'c.md', name: 'c.md' },
		];
		let updated: ContextAttachment[] = [];
		const remove = createRemoveAttachment(attachments, (res) => {
			updated = res;
		});

		remove(1);
		expect(updated).toEqual([
			{ type: 'file', path: 'a.md', name: 'a.md' },
			{ type: 'file', path: 'c.md', name: 'c.md' },
		]);
	});

	it('normalizePastedFile renames image.png with timestamp', () => {
		const file = new File(['dummy'], 'image.png', { type: 'image/png' });
		const normalized = normalizePastedFile(file);
		expect(normalized.name).toMatch(/^Pasted_Image_\d+\.png$/);
	});

	it('createFileInputTrigger triggers click on file input element', () => {
		let clicked = false;
		const mockEl = {
			click: () => {
				clicked = true;
			},
		} as unknown as HTMLInputElement;

		const trigger = createFileInputTrigger(() => mockEl);
		trigger();
		expect(clicked).toBe(true);
	});

	it('createDragOverHandler prevents default event', () => {
		let prevented = false;
		const mockEvent = {
			preventDefault: () => {
				prevented = true;
			},
		} as unknown as DragEvent;

		const handler = createDragOverHandler();
		handler(mockEvent);
		expect(prevented).toBe(true);
	});

	it('handleFiles merges new attachments into latest attachments state without race condition', async () => {
		let currentAttachments: ContextAttachment[] = [
			{ type: 'external_file', path: '', name: 'initial.txt', content: 'init' },
		];

		const setAttachments = vi.fn((newVal: ContextAttachment[]) => {
			currentAttachments = newVal;
		});
		const onResizeTextarea = vi.fn();

		const ctx = {
			plugin: {} as unknown as LuminaPlugin,
			get attachments() {
				return currentAttachments;
			},
			setAttachments,
			t: (k: string) => k,
			onResizeTextarea,
		};

		// Mock processFiles to simulate async processing delay, during which user adds another attachment
		vi.spyOn(fileAttachmentUtils, 'processFiles').mockImplementation(async () => {
			// Simulate that user sent the message or added a note while processing
			currentAttachments = [
				{ type: 'file', path: 'note-added-meanwhile.md', name: 'note-added-meanwhile.md' },
			];
			return [
				{ type: 'external_file', path: '', name: 'new-uploaded.pdf', content: 'pdf text' },
			];
		});

		const dummyFile = new File(['test'], 'new-uploaded.pdf', { type: 'application/pdf' });
		await handleFiles([dummyFile], ctx);

		expect(setAttachments).toHaveBeenCalledTimes(1);
		expect(currentAttachments).toEqual([
			{ type: 'file', path: 'note-added-meanwhile.md', name: 'note-added-meanwhile.md' },
			{ type: 'external_file', path: '', name: 'new-uploaded.pdf', content: 'pdf text' },
		]);
		// initial.txt should NOT have revived!
		expect(currentAttachments.some((a) => a.name === 'initial.txt')).toBe(false);
	});

	it('createPasteHandler ignores virtual image.png when text/plain exists (Office paste)', async () => {
		const processFilesSpy = vi.spyOn(fileAttachmentUtils, 'processFiles').mockResolvedValue([]);
		const ctx = {
			plugin: {} as unknown as LuminaPlugin,
			attachments: [],
			setAttachments: vi.fn(),
			t: (k: string) => k,
			onResizeTextarea: vi.fn(),
		};

		const pasteHandler = (await import('./useFileAttachment')).createPasteHandler(ctx);

		const dummyImageFile = new File(['dummy'], 'image.png', { type: 'image/png' });
		const mockEvent = {
			clipboardData: {
				getData: (format: string) => {
					if (format === 'text/plain') return 'Copied cell text';
					if (format === 'text/html') return '<table><tr><td>Copied cell</td></tr></table>';
					return '';
				},
				items: [
					{ kind: 'string', type: 'text/plain' },
					{ kind: 'file', getAsFile: () => dummyImageFile },
				],
			},
		} as unknown as ClipboardEvent;

		pasteHandler(mockEvent);

		// processFiles should NOT be called because it was ignored as an Office paste
		expect(processFilesSpy).not.toHaveBeenCalled();
	});

	it('createPasteHandler attaches image when text/plain is empty (clean screenshot paste)', async () => {
		const processFilesSpy = vi.spyOn(fileAttachmentUtils, 'processFiles').mockResolvedValue([]);
		const ctx = {
			plugin: {} as unknown as LuminaPlugin,
			attachments: [],
			setAttachments: vi.fn(),
			t: (k: string) => k,
			onResizeTextarea: vi.fn(),
		};

		const pasteHandler = (await import('./useFileAttachment')).createPasteHandler(ctx);

		const dummyImageFile = new File(['dummy'], 'image.png', { type: 'image/png' });
		const mockEvent = {
			clipboardData: {
				getData: () => '',
				items: [
					{ kind: 'file', getAsFile: () => dummyImageFile },
				],
			},
		} as unknown as ClipboardEvent;

		pasteHandler(mockEvent);

		// Clean screenshot paste should proceed to processFiles
		expect(processFilesSpy).toHaveBeenCalled();
	});

	it('createDropHandler handles internal Obsidian note drop via [[Note Link]] text', async () => {
		const mockFile = Object.assign(new TFile(), {
			path: 'Notes/Project.md',
			basename: 'Project',
			name: 'Project.md',
			extension: 'md',
		});
		const mockPlugin = {
			app: {
				metadataCache: {
					getFirstLinkpathDest: vi.fn((link: string) => {
						if (link === 'Project') return mockFile;
						return null;
					}),
				},
				vault: {
					getAbstractFileByPath: vi.fn(),
				},
			},
		} as unknown as LuminaPlugin;

		let attachments: ContextAttachment[] = [];
		const setAttachments = vi.fn((updated: ContextAttachment[]) => {
			attachments = updated;
		});

		const ctx = {
			plugin: mockPlugin,
			get attachments() {
				return attachments;
			},
			setAttachments,
			t: (k: string) => k,
			onResizeTextarea: vi.fn(),
		};

		const dropHandler = (await import('./useFileAttachment')).createDropHandler(ctx);

		const mockEvent = {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			dataTransfer: {
				files: [],
				getData: (format: string) => (format === 'text/plain' ? '[[Project]]' : ''),
			},
		} as unknown as DragEvent;

		dropHandler(mockEvent);

		expect(mockEvent.preventDefault).toHaveBeenCalled();
		expect(setAttachments).toHaveBeenCalledWith([
			{
				type: 'file',
				path: 'Notes/Project.md',
				name: 'Project',
			},
		]);
	});

	it('createDropHandler handles Obsidian file explorer drag with obsidian:// URL', async () => {
		const mockFile = Object.assign(new TFile(), {
			path: '00_Guides/Prompting.md',
			basename: 'Prompting',
			name: 'Prompting.md',
			extension: 'md',
		});
		const mockPlugin = {
			app: {
				metadataCache: {
					getFirstLinkpathDest: vi.fn((link: string) => {
						if (link === '00_Guides/Prompting' || link === '00_Guides/Prompting.md') return mockFile;
						return null;
					}),
				},
				vault: {
					getAbstractFileByPath: vi.fn((path: string) => {
						if (path === '00_Guides/Prompting.md') return mockFile;
						return null;
					}),
				},
			},
		} as unknown as LuminaPlugin;

		let attachments: ContextAttachment[] = [];
		const setAttachments = vi.fn((updated: ContextAttachment[]) => {
			attachments = updated;
		});

		const ctx = {
			plugin: mockPlugin,
			get attachments() {
				return attachments;
			},
			setAttachments,
			t: (k: string) => k,
			onResizeTextarea: vi.fn(),
		};

		const dropHandler = (await import('./useFileAttachment')).createDropHandler(ctx);

		const mockEvent = {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			dataTransfer: {
				files: [],
				getData: (format: string) =>
					format === 'text/plain'
						? 'obsidian://open?vault=Vault&file=00_Guides%2FPrompting'
						: '',
			},
		} as unknown as DragEvent;

		dropHandler(mockEvent);

		expect(mockEvent.preventDefault).toHaveBeenCalled();
		expect(mockEvent.stopPropagation).toHaveBeenCalled();
		expect(setAttachments).toHaveBeenCalledWith([
			{
				type: 'file',
				path: '00_Guides/Prompting.md',
				name: 'Prompting',
			},
		]);
	});

	it('createDropHandler handles folder drop via path', async () => {
		const mockFolder = Object.assign(new TFolder(), {
			path: 'Projects/Lumina',
			name: 'Lumina',
			children: [],
		});
		const mockPlugin = {
			app: {
				metadataCache: {
					getFirstLinkpathDest: vi.fn().mockReturnValue(null),
				},
				vault: {
					getAbstractFileByPath: vi.fn((path: string) => {
						if (path === 'Projects/Lumina') return mockFolder;
						return null;
					}),
				},
			},
		} as unknown as LuminaPlugin;

		let attachments: ContextAttachment[] = [];
		const setAttachments = vi.fn((updated: ContextAttachment[]) => {
			attachments = updated;
		});

		const ctx = {
			plugin: mockPlugin,
			get attachments() {
				return attachments;
			},
			setAttachments,
			t: (k: string) => k,
			onResizeTextarea: vi.fn(),
		};

		const dropHandler = (await import('./useFileAttachment')).createDropHandler(ctx);

		const mockEvent = {
			preventDefault: vi.fn(),
			stopPropagation: vi.fn(),
			dataTransfer: {
				files: [],
				getData: (format: string) => (format === 'text/plain' ? 'Projects/Lumina' : ''),
			},
		} as unknown as DragEvent;

		dropHandler(mockEvent);

		expect(mockEvent.preventDefault).toHaveBeenCalled();
		expect(setAttachments).toHaveBeenCalledWith([
			{
				type: 'folder',
				path: 'Projects/Lumina',
				name: 'Lumina',
			},
		]);
	});

	it('createFileSelectHandler clones files before resetting input value', async () => {
		const processFilesSpy = vi.spyOn(fileAttachmentUtils, 'processFiles').mockResolvedValue([]);
		const dummyFile = new File(['text'], 'sample.txt', { type: 'text/plain' });
		const setAttachments = vi.fn();
		const ctx = {
			plugin: {} as LuminaPlugin,
			attachments: [],
			setAttachments,
			t: (k: string) => k,
			onResizeTextarea: vi.fn(),
		};

		const { createFileSelectHandler } = await import('./useFileAttachment');
		const handler = createFileSelectHandler(ctx);

		const input = document.createElement('input');
		input.type = 'file';
		Object.defineProperty(input, 'files', {
			value: [dummyFile],
			writable: true,
		});

		handler({ target: input } as unknown as Event);

		expect(processFilesSpy).toHaveBeenCalledWith(
			expect.arrayContaining([dummyFile]),
			[],
			expect.any(Function),
			expect.anything()
		);
		expect(input.value).toBe('');
	});
});
