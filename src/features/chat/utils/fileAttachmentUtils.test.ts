import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	getImageMimeType,
	readImageAsDataURL,
	readTextFile,
	readBinaryDocument,
	readFileContent,
	processFiles,
	extractFileFromEntry,
	normalizePastedFile,
	getAttachmentIcon,
	getFileExtension,
} from './fileAttachmentUtils';
import type { ContextAttachment } from '../../../shared/types/chat.types';
import type LuminaPlugin from '../../../main';

describe('fileAttachmentUtils', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	describe('getFileExtension', () => {
		it('extracts extension from normal files, dotfiles, and extensionless files', () => {
			expect(getFileExtension(new File([], 'script.ts'))).toBe('ts');
			expect(getFileExtension(new File([], '.gitignore'))).toBe('gitignore');
			expect(getFileExtension(new File([], '.env'))).toBe('env');
			expect(getFileExtension(new File([], 'Dockerfile'))).toBe('dockerfile');
			expect(getFileExtension(new File([], 'Makefile'))).toBe('makefile');
			expect(getFileExtension(new File([], 'archive.tar.gz'))).toBe('gz');
		});
	});

	describe('getImageMimeType', () => {
		it('returns correct image MIME types', () => {
			expect(getImageMimeType('png')).toBe('image/png');
			expect(getImageMimeType('jpg')).toBe('image/jpeg');
			expect(getImageMimeType('jpeg')).toBe('image/jpeg');
			expect(getImageMimeType('webp')).toBe('image/webp');
			expect(getImageMimeType('gif')).toBe('image/gif');
		});
	});

	describe('readImageAsDataURL', () => {
		it('reads image file as data URL', async () => {
			const file = new File(['mock content'], 'test.png', { type: 'image/png' });
			const result = await readImageAsDataURL(file, 'png');
			expect(result).toMatch(/^data:image\/png;base64,/);
		});

		it('fixes MIME type if result is application/octet-stream', async () => {
			const file = new File(['mock content'], 'test.png', { type: 'application/octet-stream' });
			const result = await readImageAsDataURL(file, 'png');
			expect(result).toMatch(/^data:image\/png;base64,/);
		});
	});

	describe('readBinaryDocument', () => {
		it('returns null and triggers notice when embeddingWorker is not ready', async () => {
			const file = new File(['dummy binary'], 'test.pdf', { type: 'application/pdf' });
			const t = vi.fn((k: string) => k);
			const mockPlugin = {} as unknown as LuminaPlugin;

			const result = await readBinaryDocument(file, 'pdf', mockPlugin, t);
			expect(result).toBeNull();
			expect(t).toHaveBeenCalledWith('uiMessages.attachWorkerNotReady');
		});

		it('calls embeddingWorker.parse when worker is available', async () => {
			const file = new File(['dummy binary'], 'test.pdf', { type: 'application/pdf' });
			const mockPlugin = {
				embeddingWorker: {
					parse: vi.fn().mockResolvedValue('Parsed document content'),
				},
			} as unknown as LuminaPlugin;

			const result = await readBinaryDocument(file, 'pdf', mockPlugin);
			expect(result).toBe('Parsed document content');
		});
	});

	describe('readFileContent', () => {
		it('reads plain text file content', async () => {
			const file = new File(['Hello Lumina!'], 'memo.txt', { type: 'text/plain' });
			const t = vi.fn((k: string) => k);

			const result = await readFileContent(file, 'txt', t);
			expect(result).toBe('Hello Lumina!');
		});

		it('rejects file larger than 20MB and triggers attachFileTooLarge notice', async () => {
			const hugeFile = {
				name: 'huge.txt',
				size: 25 * 1024 * 1024,
				arrayBuffer: vi.fn(),
			} as unknown as File;
			const t = vi.fn((k: string) => k);

			const result = await readFileContent(hugeFile, 'txt', t);
			expect(result).toBeNull();
			expect(t).toHaveBeenCalledWith('uiMessages.attachFileTooLarge', { max: '20MB', file: 'huge.txt' });
		});

		it('strips UTF-8 BOM from text files', async () => {
			const contentWithBOM = '\uFEFFBOM content';
			const file = new File([contentWithBOM], 'bom.txt', { type: 'text/plain' });
			const result = await readTextFile(file);
			expect(result).toBe('BOM content');
		});

		it('rejects empty file and triggers attachFileEmpty notice', async () => {
			const file = new File(['   \n\t  '], 'empty.txt', { type: 'text/plain' });
			const t = vi.fn((k: string) => k);

			const result = await readFileContent(file, 'txt', t);
			expect(result).toBeNull();
			expect(t).toHaveBeenCalledWith('uiMessages.attachFileEmpty', { file: 'empty.txt' });
		});

		it('rejects unsupported file type and triggers unsupportedFileType notice', async () => {
			const file = new File(['binary'], 'app.exe', { type: 'application/octet-stream' });
			const t = vi.fn((k: string) => k);

			const result = await readFileContent(file, 'exe', t);
			expect(result).toBeNull();
			expect(t).toHaveBeenCalledWith('uiMessages.unsupportedFileType', { ext: 'exe' });
		});

		it('reads dotfiles like .gitignore when ext is gitignore', async () => {
			const file = new File(['node_modules\n*.log'], '.gitignore', { type: '' });
			const t = vi.fn((k: string) => k);

			const result = await readFileContent(file, 'gitignore', t);
			expect(result).toBe('node_modules\n*.log');
		});

		it('reads files with text/* mime type even with uncommon extension', async () => {
			const file = new File(['custom config text'], 'config.custom', { type: 'text/plain' });
			const t = vi.fn((k: string) => k);

			const result = await readFileContent(file, 'custom', t);
			expect(result).toBe('custom config text');
		});
	});

	describe('processFiles', () => {
		it('skips duplicate attachments', async () => {
			const file = new File(['file content'], 'note.txt', { type: 'text/plain' });
			const existing: ContextAttachment[] = [
				{ type: 'external_file', path: '', name: 'note.txt', content: 'existing' },
			];
			const t = vi.fn((k: string) => k);

			const result = await processFiles([file], existing, t);
			expect(result.length).toBe(0);
		});

		it('processes valid file and returns new external_file attachment', async () => {
			const file = new File(['Unique file content'], 'unique.txt', { type: 'text/plain' });
			const t = vi.fn((k: string) => k);

			const result = await processFiles([file], [], t);
			expect(result.length).toBe(1);
			expect(result[0]).toEqual({
				type: 'external_file',
				path: '',
				name: 'unique.txt',
				content: 'Unique file content',
			});
		});
	});

	describe('getAttachmentIcon', () => {
		it('returns correct icons for each attachment type', () => {
			expect(getAttachmentIcon('file')).toBe('file-text');
			expect(getAttachmentIcon('folder')).toBe('folder');
			expect(getAttachmentIcon('external_file')).toBe('paperclip');
			expect(getAttachmentIcon('canvas')).toBe('layout');
		});
	});
});
