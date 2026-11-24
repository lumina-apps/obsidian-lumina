import { App, TFile, type WorkspaceLeaf } from 'obsidian';
import { approvalStore } from './approvalManager';
import { debugLogger } from '../../../shared/debugLogger';
import { normalizeError } from '../../../shared/utils/errorUtils';

interface MarkdownLeafView {
	file?: { path: string };
	getState?: () => Record<string, unknown>;
	setState?: (state: Record<string, unknown>, result: { history: boolean }) => Promise<void>;
}

let unsubscribe: (() => void) | null = null;
const openingFiles = new Set<string>();
const autoSwitchedRequestIds = new Set<string>();

/** 읽기 모드(preview)인 경우 인라인 Diff가 보이도록 편집 모드로 자동 전환 */
async function ensureEditableModeForDiff(leaf: WorkspaceLeaf, hasTableChanges: boolean): Promise<void> {
	const view = leaf.view as unknown as MarkdownLeafView;
	if (!view?.getState || !view?.setState) return;

	const state = { ...view.getState() };
	if (state.mode !== 'preview') return;

	state.mode = 'source';
	if (hasTableChanges) {
		state.source = true;
	}
	await view.setState(state, { history: false });
}

export function setupApprovalListener(app: App) {
	if (unsubscribe) {
		unsubscribe();
	}

	unsubscribe = approvalStore.subscribe((state) => {
		// 큐에서 완료/제거된 요청 ID 정리
		const activeIds = new Set(state.queue.map((r) => r.id));
		for (const id of autoSwitchedRequestIds) {
			if (!activeIds.has(id)) {
				autoSwitchedRequestIds.delete(id);
			}
		}

		void (async () => {
			for (const req of state.queue) {
				// Note: For actionType !== 'edit', the InlineApprovalQueue component handles the rendering.
				if (req.actionType === 'edit') {
					const file = app.vault.getAbstractFileByPath(req.filePath);
					if (!(file instanceof TFile)) continue;

					const leaves = app.workspace.getLeavesOfType('markdown');
					let targetLeaf = leaves.find((leaf) => {
						const view = leaf.view as unknown as MarkdownLeafView;
						return view.file?.path === file.path;
					});

					if (!targetLeaf && !openingFiles.has(file.path)) {
						openingFiles.add(file.path);
						try {
							const newLeaf = app.workspace.getLeaf('tab');
							await newLeaf.openFile(file);
							targetLeaf = newLeaf;
						} catch (e) {
							debugLogger.logError('approval', normalizeError(e, `Failed to open file for edit approval (${file.path}): ${e}`));
						} finally {
							openingFiles.delete(file.path);
						}
					}

					if (targetLeaf && !autoSwitchedRequestIds.has(req.id)) {
						autoSwitchedRequestIds.add(req.id);
						const hasTableChanges = Boolean(req.chunks?.some((c) => c.isTable));
						try {
							await ensureEditableModeForDiff(targetLeaf, hasTableChanges);
						} catch (e) {
							debugLogger.logError('approval', normalizeError(e, `Failed to switch view mode for edit approval (${file.path}): ${e}`));
						}
					}
				}
			}
		})();
	});
}

export function cleanupApprovalListener() {
	if (unsubscribe) {
		unsubscribe();
		unsubscribe = null;
	}
	openingFiles.clear();
	autoSwitchedRequestIds.clear();
}
