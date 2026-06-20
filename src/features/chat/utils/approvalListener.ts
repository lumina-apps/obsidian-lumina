import { App, TFile } from 'obsidian';
import { approvalStore } from './approvalManager';
import { ActionApprovalModal } from '../ui/ActionApprovalModal';

let unsubscribe: (() => void) | null = null;
const activeModals = new Set<string>();
const openingFiles = new Set<string>();

export function setupApprovalListener(app: App) {
	if (unsubscribe) {
		unsubscribe();
	}

	unsubscribe = approvalStore.subscribe((state) => {
		void (async () => {
			for (const req of state.queue) {
				// Handle non-edit actions with a Modal
				if (req.actionType !== 'edit' && req.actionType !== undefined) {
					if (!activeModals.has(req.id)) {
						activeModals.add(req.id);
						const modal = new ActionApprovalModal(app, req);
						// Override onClose to remove from activeModals
						const originalOnClose = modal.onClose.bind(modal);
						modal.onClose = () => {
							activeModals.delete(req.id);
							originalOnClose();
						};
						modal.open();
					}
				} else {
					// Handle edit actions - make sure the file is open
					const file = app.vault.getAbstractFileByPath(req.filePath);
					if (file instanceof TFile) {
						const leaves = app.workspace.getLeavesOfType('markdown');
						const isFileOpen = leaves.some((leaf) => {
							const view = leaf.view as unknown as { file?: { path: string } };
							return view.file?.path === file.path;
						});

						if (!isFileOpen && !openingFiles.has(file.path)) {
							openingFiles.add(file.path);
							// Open in a new tab if it's not open
							const newLeaf = app.workspace.getLeaf('tab');
							await newLeaf.openFile(file);
							openingFiles.delete(file.path);
						} else {
							// Focus the existing leaf if needed? (optional, could be annoying if user is typing elsewhere)
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
}
