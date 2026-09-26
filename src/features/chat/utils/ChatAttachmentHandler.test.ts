import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App, TFile, TFolder, requestUrl, getAllTags } from 'obsidian';
import { ChatAttachmentHandler } from './ChatAttachmentHandler';
import type { ContextAttachment } from '../../../shared/types/chat.types';

vi.mock('../../../shared/locales/helpers', () => ({
	t: (key: string, vars?: Record<string, string | number>) => {
		if (vars?.name) return `${key}:${vars.name}`;
		return key;
	}
}));

vi.mock('../../../shared/debugLogger', () => ({
	debugLogger: {
		logWarn: vi.fn(),
		logError: vi.fn(),
	}
}));

describe('ChatAttachmentHandler', () => {
	let mockVault: {
		read: ReturnType<typeof vi.fn>;
		readBinary: ReturnType<typeof vi.fn>;
		getAbstractFileByPath: ReturnType<typeof vi.fn>;
		getMarkdownFiles: ReturnType<typeof vi.fn>;
	};
	let mockWorkspace: {
		getActiveFile: ReturnType<typeof vi.fn>;
		activeEditor: null;
	};
	let mockMetadataCache: {
		getFileCache: ReturnType<typeof vi.fn>;
	};
	let mockApp: App;

	beforeEach(() => {
		mockVault = {
			read: vi.fn(),
			readBinary: vi.fn(),
			getAbstractFileByPath: vi.fn(),
			getMarkdownFiles: vi.fn(),
		};
		mockWorkspace = {
			getActiveFile: vi.fn(),
			activeEditor: null,
		};
		mockMetadataCache = {
			getFileCache: vi.fn(),
		};
		mockApp = {
			vault: mockVault,
			workspace: mockWorkspace,
			metadataCache: mockMetadataCache,
		} as unknown as App;
		vi.clearAllMocks();
	});

	describe('parseFileAttachment', () => {
		it('should parse markdown file content', async () => {
			const file = new TFile();
			file.path = 'Notes/Doc.md';
			file.name = 'Doc.md';
			file.basename = 'Doc';
			file.extension = 'md';

			mockVault.getAbstractFileByPath.mockReturnValue(file);
			mockVault.read.mockResolvedValue('# Hello World\nContent here');

			const att: ContextAttachment = {
				type: 'file',
				path: 'Notes/Doc.md',
				name: 'Doc',
			};

			const result = await ChatAttachmentHandler.parseAttachment(mockApp, att);
			expect(result).not.toBeNull();
			expect(result?.type).toBe('text');
			expect(result?.content).toContain('[첨부 파일: Doc]');
			expect(result?.content).toContain('# Hello World\nContent here');
		});

		it('should parse image file to base64 data url', async () => {
			const file = new TFile();
			file.path = 'Images/photo.png';
			file.name = 'photo.png';
			file.basename = 'photo';
			file.extension = 'png';

			mockVault.getAbstractFileByPath.mockReturnValue(file);
			// 4 bytes buffer
			const uint8 = new Uint8Array([72, 101, 108, 108]);
			mockVault.readBinary.mockResolvedValue(uint8.buffer);

			const att: ContextAttachment = {
				type: 'file',
				path: 'Images/photo.png',
				name: 'photo.png',
			};

			const result = await ChatAttachmentHandler.parseAttachment(mockApp, att);
			expect(result).not.toBeNull();
			expect(result?.type).toBe('image');
			expect(result?.content).toContain('data:image/png;base64,');
		});

		it('should return null for unsupported extensions', async () => {
			const file = new TFile();
			file.path = 'data.xyz';
			file.extension = 'xyz';

			mockVault.getAbstractFileByPath.mockReturnValue(file);

			const att: ContextAttachment = {
				type: 'file',
				path: 'data.xyz',
				name: 'data.xyz',
			};

			const result = await ChatAttachmentHandler.parseAttachment(mockApp, att);
			expect(result).toBeNull();
		});
	});

	describe('parseCanvasAttachment', () => {
		it('should parse canvas with text cards, file cards, link cards, group labels, and connections', async () => {
			const file = new TFile();
			file.path = 'Canvas/Flow.canvas';
			file.basename = 'Flow';
			file.extension = 'canvas';

			const canvasJson = {
				nodes: [
					{ id: 'node1', type: 'text', text: 'Important concept' },
					{ id: 'node2', type: 'file', file: 'Notes/Ref.md' },
					{ id: 'node3', type: 'link', url: 'https://example.com' },
					{ id: 'node4', type: 'group', label: 'Backend' },
				],
				edges: [
					{ fromNode: 'node1', toNode: 'node2', label: 'relates to' }
				]
			};

			mockVault.getAbstractFileByPath.mockReturnValue(file);
			mockVault.read.mockResolvedValue(JSON.stringify(canvasJson));

			const att: ContextAttachment = {
				type: 'canvas',
				path: 'Canvas/Flow.canvas',
				name: 'Flow',
			};

			const result = await ChatAttachmentHandler.parseAttachment(mockApp, att);
			expect(result).not.toBeNull();
			expect(result?.type).toBe('text');
			expect(result?.content).toContain('[Cards & Elements]');
			expect(result?.content).toContain('- [Text Card]: Important concept');
			expect(result?.content).toContain('- [Note/File]: [[Notes/Ref.md]]');
			expect(result?.content).toContain('- [Link]: https://example.com');
			expect(result?.content).toContain('- [Group]: Backend');
			expect(result?.content).toContain('[Connections]');
			expect(result?.content).toContain('relates to');
		});
	});

	describe('parseTagAttachment', () => {
		it('should match tags including subtags using getAllTags', async () => {
			const file1 = new TFile();
			file1.path = 'Notes/Work1.md';
			file1.basename = 'Work1';
			file1.extension = 'md';

			const file2 = new TFile();
			file2.path = 'Notes/Work2.md';
			file2.basename = 'Work2';
			file2.extension = 'md';

			const file3 = new TFile();
			file3.path = 'Notes/Personal.md';
			file3.basename = 'Personal';
			file3.extension = 'md';

			mockVault.getMarkdownFiles.mockReturnValue([file1, file2, file3]);

			vi.mocked(getAllTags).mockImplementation((cache: unknown) => {
				const c = cache as { id?: string };
				if (c?.id === '1') return ['#project'];
				if (c?.id === '2') return ['#project/lumina'];
				return ['#personal'];
			});

			mockMetadataCache.getFileCache.mockImplementation((file: TFile) => {
				if (file.path === 'Notes/Work1.md') return { id: '1' };
				if (file.path === 'Notes/Work2.md') return { id: '2' };
				return { id: '3' };
			});

			mockVault.read.mockImplementation(async (file: TFile) => `Content of ${file.basename}`);

			const att: ContextAttachment = {
				type: 'tag',
				path: '#project',
				name: '#project',
			};

			const result = await ChatAttachmentHandler.parseAttachment(mockApp, att);
			expect(result).not.toBeNull();
			expect(result?.content).toContain('Work1');
			expect(result?.content).toContain('Work2');
			expect(result?.content).not.toContain('Personal');
		});
	});

	describe('parseFolderAttachment', () => {
		it('should recursively scan markdown files in folder and subfolders', async () => {
			const rootFolder = new TFolder();
			rootFolder.path = 'Projects';

			const subFolder = new TFolder();
			subFolder.path = 'Projects/Sub';

			const file1 = new TFile();
			file1.path = 'Projects/Note1.md';
			file1.extension = 'md';

			const file2 = new TFile();
			file2.path = 'Projects/Sub/Note2.md';
			file2.extension = 'md';

			rootFolder.children = [file1, subFolder];
			subFolder.children = [file2];

			mockVault.getAbstractFileByPath.mockReturnValue(rootFolder);
			mockVault.read.mockImplementation(async (file: TFile) => `Body of ${file.path}`);

			const att: ContextAttachment = {
				type: 'folder',
				path: 'Projects',
				name: 'Projects',
			};

			const result = await ChatAttachmentHandler.parseAttachment(mockApp, att);
			expect(result).not.toBeNull();
			expect(result?.content).toContain('--- Projects/Note1.md ---');
			expect(result?.content).toContain('--- Projects/Sub/Note2.md ---');
		});

		it('should collect more than 30 markdown files without arbitrary limits', async () => {
			const rootFolder = new TFolder();
			rootFolder.path = 'BigFolder';

			const files: TFile[] = [];
			for (let i = 1; i <= 35; i++) {
				const f = new TFile();
				f.path = `BigFolder/Note${i}.md`;
				f.extension = 'md';
				files.push(f);
			}
			rootFolder.children = files;

			mockVault.getAbstractFileByPath.mockReturnValue(rootFolder);
			mockVault.read.mockImplementation(async (file: TFile) => `Content of ${file.path}`);

			const att: ContextAttachment = {
				type: 'folder',
				path: 'BigFolder',
				name: 'BigFolder',
			};

			const result = await ChatAttachmentHandler.parseAttachment(mockApp, att);
			expect(result).not.toBeNull();
			// Should contain file 1 and file 35 (not cut off at 30)
			expect(result?.content).toContain('--- BigFolder/Note1.md ---');
			expect(result?.content).toContain('--- BigFolder/Note35.md ---');
		});

		it('should prevent circular symlink recursion without crashing', async () => {
			const rootFolder = new TFolder();
			rootFolder.path = 'CircularRoot';

			const childFolder = new TFolder();
			childFolder.path = 'CircularRoot/Child';

			const file = new TFile();
			file.path = 'CircularRoot/Note.md';
			file.extension = 'md';

			// Circular reference: childFolder contains rootFolder
			rootFolder.children = [file, childFolder];
			childFolder.children = [rootFolder];

			mockVault.getAbstractFileByPath.mockReturnValue(rootFolder);
			mockVault.read.mockResolvedValue('Safe content');

			const att: ContextAttachment = {
				type: 'folder',
				path: 'CircularRoot',
				name: 'CircularRoot',
			};

			// Must terminate without call stack overflow
			const result = await ChatAttachmentHandler.parseAttachment(mockApp, att);
			expect(result).not.toBeNull();
			expect(result?.content).toContain('--- CircularRoot/Note.md ---');
		});
	});

	describe('parseActiveNoteAttachment', () => {
		it('should parse active note when path is valid', async () => {
			const file = new TFile();
			file.path = 'Active.md';
			file.basename = 'Active';
			file.extension = 'md';

			mockVault.getAbstractFileByPath.mockReturnValue(file);
			mockVault.read.mockResolvedValue('Active note body');

			const att: ContextAttachment = {
				type: 'active_note',
				path: 'Active.md',
				name: 'Active',
			};

			const result = await ChatAttachmentHandler.parseAttachment(mockApp, att);
			expect(result).not.toBeNull();
			expect(result?.content).toContain('Active note body');
		});

		it('should return null and not fallback to arbitrary active file if specified path does not exist', async () => {
			const unrelatedActive = new TFile();
			unrelatedActive.path = 'Unrelated.md';
			unrelatedActive.basename = 'Unrelated';

			mockVault.getAbstractFileByPath.mockReturnValue(null);
			mockWorkspace.getActiveFile.mockReturnValue(unrelatedActive);

			const att: ContextAttachment = {
				type: 'active_note',
				path: 'DeletedOrMissing.md',
				name: 'Deleted',
			};

			const result = await ChatAttachmentHandler.parseAttachment(mockApp, att);
			expect(result).toBeNull();
		});
	});

	describe('parseUrlAttachment', () => {
		it('should extract title and clean HTML content', async () => {
			const html = `
				<!DOCTYPE html>
				<html>
					<head><title>My Article Title</title></head>
					<body>
						<script>console.log("bad");</script>
						<h1>Article Heading</h1>
						<p>Paragraph with text.</p>
					</body>
				</html>
			`;
			vi.mocked(requestUrl).mockResolvedValue({ text: html } as any);

			const att: ContextAttachment = {
				type: 'url',
				path: 'https://example.com/article',
				name: 'https://example.com/article',
			};

			const result = await ChatAttachmentHandler.parseAttachment(mockApp, att);
			expect(result).not.toBeNull();
			expect(result?.type).toBe('text');
			expect(result?.content).toContain('[외부 웹페이지: My Article Title (https://example.com/article)]');
			expect(result?.content).toContain('Article Heading');
			expect(result?.content).toContain('Paragraph with text.');
			expect(result?.content).not.toContain('console.log');
		});

		it('should reject non-http/https urls', async () => {
			const att: ContextAttachment = {
				type: 'url',
				path: 'file:///etc/passwd',
				name: 'file:///etc/passwd',
			};

			const result = await ChatAttachmentHandler.parseAttachment(mockApp, att);
			expect(result).toBeNull();
		});
	});

	describe('buildAttachmentContext', () => {
		it('should build combined context and collect multimodal images', async () => {
			const mdFile = new TFile();
			mdFile.path = 'Doc.md';
			mdFile.basename = 'Doc';
			mdFile.extension = 'md';

			const imgFile = new TFile();
			imgFile.path = 'Pic.jpg';
			imgFile.extension = 'jpg';

			mockVault.getAbstractFileByPath.mockImplementation((p: string) => {
				if (p === 'Doc.md') return mdFile;
				if (p === 'Pic.jpg') return imgFile;
				return null;
			});

			mockVault.read.mockResolvedValue('Markdown content');
			mockVault.readBinary.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);

			const attachments: ContextAttachment[] = [
				{ type: 'file', path: 'Doc.md', name: 'Doc' },
				{ type: 'file', path: 'Pic.jpg', name: 'Pic.jpg' },
			];

			const { attachmentContext, multimodalImages } = await ChatAttachmentHandler.buildAttachmentContext(mockApp, attachments);

			expect(attachmentContext).toContain('Markdown content');
			expect(multimodalImages.length).toBe(1);
			expect(multimodalImages[0]).toContain('data:image/jpeg;base64,');
		});
	});
});
