import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, type App } from 'obsidian';
import { resolveAttachmentsWithActiveNote } from './contextBuilder';
import { initProjectStore } from '../../../core/store/projectStore';
import { createDefaultProject } from '../../../shared/types/project.types';
import { settingsStore } from '../../../core/store/settingsStore';

vi.mock('../../../shared/locales/helpers', () => ({
	t: (key: string, vars?: Record<string, string | number>) =>
		vars?.name ? `${key}:${vars.name}` : key,
}));

describe('contextBuilder - resolveAttachmentsWithActiveNote', () => {
	beforeEach(() => {
		const defaultProj = createDefaultProject();
		initProjectStore([defaultProj], defaultProj.id);
		settingsStore.set(null);
	});

	it('사용자 지정 chat.historyPath 하위의 활성 노트는 자동 첨부에서 제외한다', async () => {
		const historyFile = new TFile();
		historyFile.path = 'CustomChats/261122_0800 - Chat.md';
		historyFile.basename = '261122_0800 - Chat';

		const mockApp = {
			workspace: {
				getActiveFile: vi.fn().mockReturnValue(historyFile),
			},
		} as unknown as App;

		const result = await resolveAttachmentsWithActiveNote(
			mockApp,
			[],
			true,
			'/CustomChats/',
		);

		expect(result).toEqual([]);
	});

	it('Lumina Exports 등 일반 노트는 활성 노트로 자동 첨부한다', async () => {
		const exportedFile = new TFile();
		exportedFile.path = 'Lumina Exports/261122_0800 - Summary.md';
		exportedFile.basename = '261122_0800 - Summary';

		const mockApp = {
			workspace: {
				getActiveFile: vi.fn().mockReturnValue(exportedFile),
			},
		} as unknown as App;

		const result = await resolveAttachmentsWithActiveNote(
			mockApp,
			[],
			true,
			'CustomChats',
		);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			type: 'active_note',
			path: 'Lumina Exports/261122_0800 - Summary.md',
		});
	});
});
