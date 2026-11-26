/**
 * batchApplyHelper.test.ts
 *
 * 수동 Batch Studio와 자동감시가 공유하는 applyProposedToFile 헬퍼의
 * frontmatter / move / content 적용 및 예외 처리를 검증합니다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App, TFile } from 'obsidian';

vi.mock('../watch/folderMover', () => ({
	executeSafeFileMove: vi.fn(),
}));

import { executeSafeFileMove } from '../watch/folderMover';
import { applyProposedToFile } from '../batchApplyHelper';

describe('batchApplyHelper - applyProposedToFile', () => {
	let app: App;
	let file: TFile;

	beforeEach(() => {
		vi.clearAllMocks();
		app = new App();
		file = Object.assign(new TFile(), {
			path: 'Notes/sample.md',
			name: 'sample.md',
			basename: 'sample',
			extension: 'md',
		});
	});

	it('frontmatter 모드: customFmKey가 지정되면 해당 커스텀 키만 갱신한다', async () => {
		const fmState: Record<string, unknown> = { tags: ['keep'], existing: 'val' };
		(app as unknown as { fileManager: { processFrontMatter: unknown } }).fileManager = {
			processFrontMatter: vi.fn(async (_f: TFile, fn: (fm: Record<string, unknown>) => void) => {
				fn(fmState);
			}),
		};

		await applyProposedToFile(app, file, {
			kind: 'frontmatter',
			customFmKey: 'ai_summary',
			afterCustomFmVal: '핵심 요약 결과',
			afterTags: ['should-ignore'],
		});

		expect(fmState).toEqual({
			tags: ['keep'],
			existing: 'val',
			ai_summary: '핵심 요약 결과',
		});
	});

	it('frontmatter 모드: tags/description을 반영하고 기존 값이 있다가 비어지면 속성을 삭제한다', async () => {
		const fmState: Record<string, unknown> = {
			tags: ['old-tag'],
			description: 'old desc',
		};
		(app as unknown as { fileManager: { processFrontMatter: unknown } }).fileManager = {
			processFrontMatter: vi.fn(async (_f: TFile, fn: (fm: Record<string, unknown>) => void) => {
				fn(fmState);
			}),
		};

		// 1) 새 값으로 갱신
		await applyProposedToFile(app, file, {
			kind: 'frontmatter',
			beforeTags: ['old-tag'],
			afterTags: ['alpha', 'beta'],
			beforeDescription: 'old desc',
			afterDescription: '  trimmed desc  ',
		});
		expect(fmState.tags).toEqual(['alpha', 'beta']);
		expect(fmState.description).toBe('trimmed desc');

		// 2) 이전 값이 존재했으나 after가 비어지면 키 삭제
		await applyProposedToFile(app, file, {
			kind: 'frontmatter',
			beforeTags: ['alpha'],
			afterTags: [],
			beforeDescription: 'trimmed desc',
			afterDescription: '   ',
		});
		expect('tags' in fmState).toBe(false);
		expect('description' in fmState).toBe(false);
	});

	it('frontmatter 모드: processFrontMatter가 없으면 명확한 에러를 던진다', async () => {
		(app as unknown as { fileManager: Record<string, unknown> }).fileManager = {};

		await expect(
			applyProposedToFile(app, file, {
				kind: 'frontmatter',
				afterTags: ['a'],
			}),
		).rejects.toThrow('Obsidian fileManager.processFrontMatter is unavailable.');
	});

	it('move 모드: moveToPath가 비어있으면 이동하지 않고, 유효하면 executeSafeFileMove를 위임 호출한다', async () => {
		const noopRes = await applyProposedToFile(app, file, {
			kind: 'move',
			moveFromPath: 'Notes/sample.md',
			moveToPath: '',
		});
		expect(noopRes).toEqual({});
		expect(executeSafeFileMove).not.toHaveBeenCalled();

		vi.mocked(executeSafeFileMove).mockResolvedValueOnce({
			movedFromPath: 'Notes/sample.md',
			movedToPath: 'Archive/sample.md',
		});

		const moveRes = await applyProposedToFile(
			app,
			file,
			{
				kind: 'move',
				moveFromPath: 'Notes/sample.md',
				moveToPath: 'Archive',
			},
			{
				conflictPolicy: 'skip',
				createFolderIfMissing: false,
				excludedPaths: ['Templates'],
			},
		);

		expect(executeSafeFileMove).toHaveBeenCalledWith(app, file, 'Archive', {
			conflictPolicy: 'skip',
			createFolderIfMissing: false,
			excludedPaths: ['Templates'],
		});
		expect(moveRes).toEqual({
			moved: {
				movedFromPath: 'Notes/sample.md',
				movedToPath: 'Archive/sample.md',
			},
		});
	});

	it('content 모드: afterContent가 있으면 vault.modify로 본문을 덮어쓴다', async () => {
		const modifySpy = vi.fn().mockResolvedValue(undefined);
		app.vault.modify = modifySpy;

		await applyProposedToFile(app, file, {
			kind: 'content',
			beforeContent: 'before',
			afterContent: 'after markdown content',
		});

		expect(modifySpy).toHaveBeenCalledWith(file, 'after markdown content');
	});
});
