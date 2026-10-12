import { describe, it, expect, vi, beforeEach } from 'vitest';
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
});
