/**
 * batchApplyHelper.ts
 *
 * 수동 Batch Studio와 백그라운드 폴더 자동감시(FolderWatchManager)가 공유하는
 * 변경 제안(`BatchProposedChange`) 실제 파일 반영 헬퍼.
 */

import type { App, TFile } from 'obsidian';
import type { BatchProposedChange } from '../../shared/types/batch.types';
import type { MoveConflictPolicy } from '../../shared/types/batchWatch.types';
import { executeSafeFileMove } from './watch/folderMover';

/** 제안 적용 시 이동 옵션 */
export interface ApplyProposedOptions {
	conflictPolicy?: MoveConflictPolicy;
	createFolderIfMissing?: boolean;
	excludedPaths?: string[];
}

/** 제안 적용 결과 */
export interface ApplyProposedResult {
	/** 폴더 이동이 실행된 경우 이동 전/후 경로 */
	moved?: {
		movedFromPath: string;
		movedToPath: string;
	};
}

/**
 * 제안된 변경 내용(`frontmatter` | `content` | `move`)을 실제 볼트 파일에 반영합니다.
 */
export async function applyProposedToFile(
	app: App,
	file: TFile,
	proposed: BatchProposedChange,
	opts?: ApplyProposedOptions,
): Promise<ApplyProposedResult> {
	if (proposed.kind === 'frontmatter') {
		if (typeof app.fileManager?.processFrontMatter !== 'function') {
			throw new Error('Obsidian fileManager.processFrontMatter is unavailable.');
		}

		await app.fileManager.processFrontMatter(file, (fmObj) => {
			const fm = fmObj as Record<string, unknown>;
			if (proposed.customFmKey) {
				fm[proposed.customFmKey] = proposed.afterCustomFmVal ?? '';
				return;
			}

			if (proposed.afterTags !== undefined) {
				const hadBefore = (proposed.beforeTags?.length ?? 0) > 0;
				if (proposed.afterTags.length > 0) {
					fm.tags = [...proposed.afterTags];
				} else if (hadBefore) {
					delete fm.tags;
				}
			}

			if (proposed.afterDescription !== undefined) {
				const hadBeforeDesc = (proposed.beforeDescription?.length ?? 0) > 0;
				if (proposed.afterDescription.trim().length > 0) {
					fm.description = proposed.afterDescription.trim();
				} else if (hadBeforeDesc) {
					delete fm.description;
				}
			}
		});
		return {};
	}

	if (proposed.kind === 'move') {
		if (!proposed.moveToPath) {
			return {};
		}
		const moved = await executeSafeFileMove(app, file, proposed.moveToPath, {
			conflictPolicy: opts?.conflictPolicy ?? 'rename-suffix',
			createFolderIfMissing: opts?.createFolderIfMissing ?? true,
			excludedPaths: opts?.excludedPaths,
		});
		return moved ? { moved } : {};
	}

	if (proposed.afterContent !== undefined) {
		await app.vault.modify(file, proposed.afterContent);
	}
	return {};
}
