import { t } from "../../../shared/locales/helpers";

import { Modal, Setting, TFolder, TextComponent, normalizePath, Notice } from 'obsidian';
import type LuminaPlugin from '../../../main';
import type { ProjectConfig } from '../../../shared/types/project.types';
import { getActiveProject, syncProjectStore } from '../../../core/store/projectStore';
import { switchProjectIndex } from '../../../features/rag/ragInitializer';
import { setTotalFiles } from '../../../core/store/ragStore';
import { buildChatModelOptions, toProviderModelValue, parseProviderModelValue } from '../../../shared/utils/modelUtils';
import { debugLogger } from '../../../shared/debugLogger';
import { ensureFolderExists } from '../../../shared/utils/fileUtils';
import {
	formatHistoryFolderPreview,
	hasUnsafeHistoryPathInput,
	normalizeHistoryRootPath,
	sanitizeHistorySubfolder,
	sanitizeProjectFolderName,
} from '../../../shared/utils/historyPathUtils';

export class ProjectSettingsModal extends Modal {
	private plugin: LuminaPlugin;
	private project: ProjectConfig | null;

	// Local state
	private projectName: string = '';
	private historySubfolder: string = '';
	private includedPaths: Set<string> = new Set();
	private excludedPaths: Set<string> = new Set();
	private defaultProviderId: string = '';
	private defaultModelId: string = '';
	private systemPromptId: string = '';
	private isNewProject: boolean;

	constructor(plugin: LuminaPlugin, project?: ProjectConfig) {
		super(plugin.app);
		this.plugin = plugin;
		this.isNewProject = !project;

		if (project) {
			this.project = project;
			this.projectName = (project.id === 'default' && project.name === 'Default') ? t('projects.settings.defaultProjectName') : project.name;

			this.historySubfolder = project.historySubfolder !== undefined
				? project.historySubfolder
				: (project.id === 'default' ? '' : sanitizeProjectFolderName(project.name));
			this.includedPaths = new Set(project.ragIncludedPaths);
			this.excludedPaths = new Set(project.ragExcludedPaths);
			this.defaultProviderId = project.defaultProviderId || '';
			this.defaultModelId = project.defaultModelId || '';
			this.systemPromptId = project.systemPromptId || '';
		} else {
			this.project = null;
			this.projectName = '';
			this.historySubfolder = '';
			this.includedPaths = new Set();
			this.defaultProviderId = '';
			this.defaultModelId = '';
			this.systemPromptId = '';
			// Auto detect default excludes
			const chatHistoryPath = normalizeHistoryRootPath(this.plugin.settings.chat.historyPath);
			const backupPath = 'backups';
			const commonExcludes = ['Templates', 'templates', '_templates', 'Attachments', 'attachments'];
			
			this.excludedPaths = new Set([chatHistoryPath, backupPath, ...commonExcludes]);
		}
	}

	onOpen() {
		const { contentEl } = this;
		this.containerEl.addClass('lumina-settings-modal-container');
		contentEl.empty();
		contentEl.addClass('lumina-settings-modal');

		debugLogger.logSystem('projects', `ProjectSettingsModal.onOpen: project=${this.project?.id}, initialIncluded=${JSON.stringify(Array.from(this.includedPaths))}, initialExcluded=${JSON.stringify(Array.from(this.excludedPaths))}`);

		contentEl.createEl('h2', { text: this.isNewProject ? t('projects.settings.newProjectTitle') : t('projects.settings.modalTitle') });

		const isDefault = this.project?.id === 'default';
		const rootPath = normalizeHistoryRootPath(this.plugin.settings.chat.historyPath);
		const buildPlaceholder = (nameVal: string) => (
			isDefault
				? t('projects.settings.chatHistoryRootPlaceholder', { path: rootPath })
				: (sanitizeProjectFolderName(nameVal) || t('projects.settings.chatHistoryAutoPlaceholder'))
		);

		let historyPathInput: TextComponent | null = null;
		let updateHistoryPreview = () => {};

		new Setting(contentEl)
			.setName(t('projects.settings.projectName'))
			.setDesc(t('projects.settings.projectNameDesc'))
			.addText(text => {
				text.setValue(this.projectName)
					.onChange(val => {
						this.projectName = val;
						if (historyPathInput && !this.historySubfolder) {
							historyPathInput.setPlaceholder(buildPlaceholder(val));
						}
						updateHistoryPreview();
					});
			});

		// Auto / Custom history path display
		const historySetting = new Setting(contentEl)
			.setName(t('projects.settings.chatHistoryPath'))
			.setDesc(t('projects.settings.chatHistoryPathDesc'))
			.addText(text => {
				historyPathInput = text;
				text.setPlaceholder(buildPlaceholder(this.projectName))
					.setValue(this.historySubfolder)
					.onChange(val => {
						this.historySubfolder = val.trim();
						updateHistoryPreview();
					});
			});

		const previewEl = historySetting.descEl.createDiv({ cls: 'lumina-settings__desc-guide' });
		const historyWarningEl = historySetting.descEl.createDiv({ cls: 'lumina-settings__desc-warning' });
		updateHistoryPreview = () => {
			previewEl.setText(t('projects.settings.chatHistoryPreview', { path: this.getHistoryDisplayPath() }));
			if (hasUnsafeHistoryPathInput(this.historySubfolder)) {
				historyWarningEl.setText(t('settings.chat.history.pathSanitizedWarning'));
				historyWarningEl.setCssStyles({ display: '' });
			} else {
				historyWarningEl.setText('');
				historyWarningEl.setCssStyles({ display: 'none' });
			}
		};
		updateHistoryPreview();

		// --- Default Chat Model Selector ---
		const chatModelOptions = buildChatModelOptions(this.plugin.settings.connections.providers);
		let currentModelValue = this.defaultProviderId && this.defaultModelId
			? toProviderModelValue(this.defaultProviderId, this.defaultModelId)
			: '';
		
		let isModelMissing = currentModelValue !== '' && !chatModelOptions.some(opt => opt.value === currentModelValue);

		new Setting(contentEl)
			.setName(t('projects.settings.defaultModel'))
			.setDesc(t('projects.settings.defaultModelDesc'))
			.addDropdown(dropdown => {
				dropdown.addOption('', t('projects.settings.defaultModelAuto'));
				
				if (isModelMissing) {
					dropdown.addOption(currentModelValue, `${t('projects.settings.deletedModel')} (${this.defaultModelId})`);
				}
				
				chatModelOptions.forEach(opt => {
					dropdown.addOption(opt.value, opt.label);
				});
				
				dropdown.setValue(currentModelValue);
				dropdown.onChange(val => {
					if (val === '') {
						this.defaultProviderId = '';
						this.defaultModelId = '';
					} else {
						const parsed = parseProviderModelValue(val);
						if (parsed) {
							this.defaultProviderId = parsed.providerId;
							this.defaultModelId = parsed.modelId;
						}
					}
				});
				
				// 긴 모델/프롬프트 이름도 레이아웃을 깨지 않도록 말줄임 클래스 적용
				dropdown.selectEl.addClass('lumina-settings-modal__select');
			});

		// --- Default System Prompt Selector ---
		const systemPrompts = this.plugin.settings.chat.systemPrompts;
		let isPromptMissing = this.systemPromptId !== '' && !systemPrompts.some(p => p.id === this.systemPromptId);
		
		new Setting(contentEl)
			.setName(t('projects.settings.systemPrompt'))
			.setDesc(t('projects.settings.systemPromptDesc'))
			.addDropdown(dropdown => {
				dropdown.addOption('', t('projects.settings.systemPromptAuto'));
				
				if (isPromptMissing) {
					dropdown.addOption(this.systemPromptId, t('projects.settings.deletedPrompt'));
				}

				systemPrompts.forEach(p => {
					dropdown.addOption(p.id, p.name);
				});
				
				dropdown.setValue(this.systemPromptId);
				dropdown.onChange((value: string) => {
					this.systemPromptId = value;
				});

				// 긴 모델/프롬프트 이름도 레이아웃을 깨지 않도록 말줄임 클래스 적용
				dropdown.selectEl.addClass('lumina-settings-modal__select');
			});

		const getDescendantPaths = (folder: TFolder): string[] => {
			const paths: string[] = [];
			const subFolders = folder.children.filter((c): c is TFolder => c instanceof TFolder);
			for (const sub of subFolders) {
				paths.push(sub.path);
				paths.push(...getDescendantPaths(sub));
			}
			return paths;
		};

		const updateCheckboxState = (cb: HTMLInputElement, folder: TFolder, selectedPaths: Set<string>) => {
			const folderPath = folder.path === '/' ? '/' : folder.path;
			const descendants = getDescendantPaths(folder);
			const isChecked = selectedPaths.has(folderPath);
			const hasSelectedDescendant = descendants.some(p => selectedPaths.has(p));

			const isIndeterminate = !isChecked && hasSelectedDescendant;
			cb.checked = isChecked;
			cb.indeterminate = isIndeterminate;
			cb.classList.toggle('is-indeterminate', isIndeterminate);
		};

		const updateAllCheckboxes = (container: HTMLElement, selectedPaths: Set<string>) => {
			container.findAll('input[type="checkbox"]').forEach(cb => {
				if (cb.instanceOf(HTMLInputElement)) {
					const path = cb.dataset.path;
					if (!path) return;
					const folder = this.app.vault.getAbstractFileByPath(path);
					if (folder instanceof TFolder) {
						updateCheckboxState(cb, folder, selectedPaths);
					}
				}
			});
		};

		const renderFolderTree = (
			container: HTMLElement,
			folder: TFolder,
			selectedPaths: Set<string>,
			onChange: () => void,
			isRoot: boolean = true
		) => {
			const itemEl = container.createDiv({ cls: 'lumina-tree-item' });
			itemEl.setCssStyles({ marginLeft: isRoot ? '0' : '20px', marginTop: '4px' });

			const rowEl = itemEl.createDiv({ cls: 'lumina-tree-row' });
			rowEl.setCssStyles({ display: 'flex', alignItems: 'center', gap: '6px' });

			const subFolders = folder.children.filter((c): c is TFolder => c instanceof TFolder);
			subFolders.sort((a, b) => a.name.localeCompare(b.name));
			const hasChildren = subFolders.length > 0;

			const toggleEl = rowEl.createSpan({ cls: 'lumina-tree-toggle' });
			toggleEl.setCssStyles({ width: '16px', display: 'inline-block', cursor: hasChildren ? 'pointer' : 'default' });
			
			const childrenContainer = itemEl.createDiv({ cls: 'lumina-tree-children' });
			childrenContainer.setCssStyles({ display: 'none' });

			if (hasChildren) {
				toggleEl.setText('▶');
				toggleEl.setCssStyles({ fontSize: '0.8em' });
				toggleEl.onclick = () => {
					const isCollapsed = childrenContainer.style.display === 'none';
					childrenContainer.setCssStyles({ display: isCollapsed ? 'block' : 'none' });
					toggleEl.setText(isCollapsed ? '▼' : '▶');
				};
			}

			const cb = rowEl.createEl('input', { type: 'checkbox' });
			const folderPath = isRoot ? '/' : folder.path;
			cb.dataset.path = folderPath;
			
			if (isRoot) {
				cb.setCssStyles({ display: 'none' });
			} else {
				updateCheckboxState(cb, folder, selectedPaths);
				cb.onchange = () => {
					if (cb.checked) {
						selectedPaths.add(folderPath);
						getDescendantPaths(folder).forEach(p => selectedPaths.delete(p));
					} else {
						selectedPaths.delete(folderPath);
					}
					onChange();
				};
			}

			const nameEl = rowEl.createSpan({ text: isRoot ? t('projects.settings.vaultRoot') : folder.name });
			nameEl.setCssStyles({ cursor: hasChildren ? 'pointer' : 'default' });
			nameEl.onclick = () => {
				if (hasChildren) toggleEl.click();
			};

			if (hasChildren) {
				subFolders.forEach(child => {
					renderFolderTree(childrenContainer, child, selectedPaths, onChange, false);
				});
			}
		};

		const buildTreeSelect = (
			name: string,
			desc: string,
			selectedPaths: Set<string>,
			emptyText?: string
		) => {
			const details = contentEl.createEl('details');
			details.setCssStyles({ marginBottom: '16px', border: '1px solid var(--background-modifier-border)', borderRadius: '8px', padding: '12px 16px', background: 'var(--background-secondary-alt)' });
			
			const summary = details.createEl('summary', { text: name, cls: 'setting-item-heading' });
			summary.setCssStyles({ cursor: 'pointer', outline: 'none', fontWeight: 'var(--font-semibold)', margin: '0', padding: '4px 0' });

			const descEl = details.createEl('p', { text: desc, cls: 'setting-item-description' });
			descEl.setCssStyles({ marginTop: '8px', marginBottom: '12px' });

			const treeContainer = details.createDiv();
			treeContainer.addClass('lumina-folder-tree-container');
			treeContainer.setCssStyles({ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--background-modifier-border)', padding: '10px', borderRadius: '6px', marginBottom: '10px', background: 'var(--background-secondary)' });

			const tagsContainer = details.createDiv();
			tagsContainer.setCssStyles({ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px', padding: '0 10px' });

			const renderTags = () => {
				tagsContainer.empty();
				if (selectedPaths.size === 0 && emptyText) {
					const emptySpan = tagsContainer.createSpan({ text: emptyText });
					emptySpan.setCssStyles({ color: 'var(--text-muted)', fontSize: '0.9em', fontStyle: 'italic' });
					return;
				}

				selectedPaths.forEach(path => {
					const tag = tagsContainer.createDiv();
					tag.setCssStyles({ display: 'flex', alignItems: 'center', padding: '4px 8px', background: 'var(--background-primary)', border: '1px solid var(--background-modifier-border)', borderRadius: '4px', fontSize: '0.9em' });

					tag.createSpan({ text: path });

					const removeBtn = tag.createSpan({ text: '✕', cls: 'lumina-tag-remove-btn' });
					removeBtn.addEventListener('click', (e: MouseEvent) => {
						e.preventDefault();
						e.stopPropagation();
						selectedPaths.delete(path);
						updateAllCheckboxes(treeContainer, selectedPaths);
						renderTags();
					});
				});
			};

			const rootFolder = this.app.vault.getRoot();
			renderFolderTree(treeContainer, rootFolder, selectedPaths, () => {
				renderTags();
				updateAllCheckboxes(treeContainer, selectedPaths);
			}, true);
			renderTags();
		};

		contentEl.createEl('hr', { cls: 'lumina-setting-divider' });

		// RAG Target Folders
		buildTreeSelect(
			t('projects.settings.ragTargetFolder'),
			t('projects.settings.ragTargetFolderDesc'),
			this.includedPaths,
			t('projects.settings.ragTargetFolderEmpty')
		);

		// RAG Exclude Folders
		buildTreeSelect(
			t('projects.settings.ragExcludedFolders'),
			t('projects.settings.ragExcludedFoldersDesc'),
			this.excludedPaths,
			t('projects.settings.ragExcludedFoldersEmpty')
		);

		// Save Button
		const saveSetting = new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText(t('projects.settings.save'))
				.setCta()
				.onClick(async () => {
					await this.saveProject();
					this.close();
				})
			);
		
		saveSetting.settingEl.addClass('lumina-sticky-save-setting');
	}

	private getHistoryDisplayPath(): string {
		let subfolder = sanitizeHistorySubfolder(this.historySubfolder);
		if (!subfolder && this.project?.id !== 'default' && this.projectName.trim()) {
			subfolder = sanitizeProjectFolderName(this.projectName);
		}

		const { resolvedPath } = formatHistoryFolderPreview(
			this.plugin.settings.chat.historyPath,
			subfolder,
			this.plugin.settings.chat.historyFolderFormat,
		);
		return `${resolvedPath}/`;
	}

	/** 대상 상위 폴더가 하위 폴더로 이어지는 단일 빈 체인인지 확인한다 */
	private isSingleChainAncestor(ancestor: TFolder, descendant: TFolder): boolean {
		let current: TFolder = ancestor;
		while (current.path.toLowerCase() !== descendant.path.toLowerCase()) {
			if (!Array.isArray(current.children) || current.children.length !== 1) return false;
			const onlyChild = current.children[0];
			if (!(onlyChild instanceof TFolder)) return false;
			current = onlyChild;
		}
		return true;
	}

	/** 폴더 이동 후 historyBasePath 아래에 남은 빈 상위 폴더를 정리한다 */
	private async cleanupEmptyParentFolders(
		startFolder: TFolder | null,
		historyBasePath: string,
		newPath: string,
	): Promise<void> {
		const rootLower = historyBasePath.toLowerCase();
		const newLower = newPath.toLowerCase();
		const otherProjectFolders = new Set(
			this.plugin.settings.projects.list
				.filter(p => p.id !== this.project?.id)
				.map(p => sanitizeHistorySubfolder(p.historySubfolder))
				.filter(Boolean)
				.map(sub => normalizePath(`${historyBasePath}/${sub}`).toLowerCase()),
		);

		let current: TFolder | null = startFolder;
		while (current) {
			const currentLower = current.path.toLowerCase();
			if (currentLower === rootLower || !currentLower.startsWith(`${rootLower}/`)) {
				break;
			}
			if (currentLower === newLower || newLower.startsWith(`${currentLower}/`)) {
				break;
			}
			if (otherProjectFolders.has(currentLower) || !Array.isArray(current.children) || current.children.length > 0) {
				break;
			}

			const parent: TFolder | null = current.parent ?? null;
			await this.app.fileManager.trashFile(current);
			current = parent;
		}
	}

	/** 히스토리 폴더를 새 하위 경로로 이동한다. 성공(또는 이동할 폴더 없음) 시 true 반환 */
	private async moveHistoryFolder(oldSubfolder: string, newSubfolder: string): Promise<boolean> {
		const historyBasePath = normalizeHistoryRootPath(this.plugin.settings.chat.historyPath);
		const normalizedOld = sanitizeHistorySubfolder(oldSubfolder);
		const normalizedNew = sanitizeHistorySubfolder(newSubfolder);

		if (!normalizedOld || !normalizedNew || normalizedOld === normalizedNew) return true;

		const oldPath = normalizePath(`${historyBasePath}/${normalizedOld}`);
		const newPath = normalizePath(`${historyBasePath}/${normalizedNew}`);
		const oldLower = oldPath.toLowerCase();
		const newLower = newPath.toLowerCase();

		try {
			const oldFolder = this.app.vault.getAbstractFileByPath(oldPath);
			if (!(oldFolder instanceof TFolder)) {
				debugLogger.logSystem('projects', `moveHistoryFolder: Old path "${oldPath}" is not a folder or does not exist. Skipping move.`);
				return true;
			}

			const oldParent = oldFolder.parent ?? null;
			const newFolderExists = this.app.vault.getAbstractFileByPath(newPath);
			const isMovingIntoDescendant = newLower.startsWith(`${oldLower}/`);
			const isHoistingToAncestor = oldLower.startsWith(`${newLower}/`);

			if (isMovingIntoDescendant) {
				if (newFolderExists) {
					new Notice(t('projects.settings.historyTargetExists', { path: newPath }));
					return false;
				}
				// 자기 자신의 하위 경로로 직접 rename 시 EINVAL이 발생하므로 형제 임시 폴더를 경유한다
				const tmpPath = normalizePath(`${historyBasePath}/__lumina_move_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
				await this.app.fileManager.renameFile(oldFolder, tmpPath);
				const movedTmp = this.app.vault.getAbstractFileByPath(tmpPath) ?? oldFolder;
				try {
					await ensureFolderExists(this.app, newPath);
					await this.app.fileManager.renameFile(movedTmp, newPath);
				} catch (innerError: unknown) {
					await this.app.fileManager.renameFile(movedTmp, oldPath).catch(() => {});
					throw innerError;
				}
			} else if (isHoistingToAncestor && newFolderExists instanceof TFolder) {
				if (!this.isSingleChainAncestor(newFolderExists, oldFolder)) {
					new Notice(t('projects.settings.historyTargetExists', { path: newPath }));
					return false;
				}
				const tmpPath = normalizePath(`${historyBasePath}/__lumina_move_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
				await this.app.fileManager.renameFile(oldFolder, tmpPath);
				const movedTmp = this.app.vault.getAbstractFileByPath(tmpPath) ?? oldFolder;
				try {
					await this.app.fileManager.trashFile(newFolderExists);
					await this.app.fileManager.renameFile(movedTmp, newPath);
				} catch (innerError: unknown) {
					await ensureFolderExists(this.app, oldPath).catch(() => {});
					await this.app.fileManager.renameFile(movedTmp, oldPath).catch(() => {});
					throw innerError;
				}
			} else {
				if (newFolderExists && newFolderExists !== oldFolder) {
					new Notice(t('projects.settings.historyTargetExists', { path: newPath }));
					return false;
				}
				// 계층 이동(예: Work -> Team/Work) 시 대상 상위 폴더가 없으면 사전 생성
				await ensureFolderExists(this.app, newPath);
				await this.app.fileManager.renameFile(oldFolder, newPath);
				await this.cleanupEmptyParentFolders(oldParent, historyBasePath, newPath);
			}

			new Notice(t('projects.settings.historyMoved', { path: newPath }));
			debugLogger.logSystem('projects', `Successfully moved chat history from "${oldPath}" to "${newPath}"`);
			return true;
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			new Notice(t('projects.settings.historyMoveError', { error: msg }));
			debugLogger.logError('projects', error instanceof Error ? error : new Error(msg));
			return false;
		}
	}

	async saveProject() {
		const name = this.projectName.trim();
		if (!name) return;
		
		let finalName = name;
		if (this.project?.id === 'default' && (name === t('projects.settings.defaultProjectName') || name === 'Default')) {
			finalName = 'Default';
		}

		let historySubfolder = sanitizeHistorySubfolder(this.historySubfolder);
		if (!historySubfolder && this.project?.id !== 'default' && finalName) {
			historySubfolder = sanitizeProjectFolderName(finalName);
		}

		const ragIncludedPaths = Array.from(this.includedPaths);
		const ragExcludedPaths = Array.from(this.excludedPaths);

		debugLogger.logSystem('projects', `ProjectSettingsModal.saveProject: isNewProject=${this.isNewProject}, targetId=${this.project?.id}, finalName=${finalName}, historySubfolder=${historySubfolder}, included=${JSON.stringify(ragIncludedPaths)}, excluded=${JSON.stringify(ragExcludedPaths)}`);

		if (this.isNewProject) {
			const newProject: ProjectConfig = {
				id: crypto.randomUUID(),
				name: finalName,
				ragIncludedPaths,
				ragExcludedPaths,
				historySubfolder,
				defaultProviderId: this.defaultProviderId,
				defaultModelId: this.defaultModelId,
				systemPromptId: this.systemPromptId,
				createdAt: Date.now(),
			};
			this.plugin.settings.projects.list.push(newProject);
		} else if (this.project) {
			const oldHistorySubfolder = this.project.historySubfolder;
			let nextHistorySubfolder = historySubfolder;

			if (oldHistorySubfolder && oldHistorySubfolder !== historySubfolder) {
				const moved = await this.moveHistoryFolder(oldHistorySubfolder, historySubfolder);
				if (!moved) {
					nextHistorySubfolder = oldHistorySubfolder;
				}
			}

			this.project.name = finalName;
			this.project.ragIncludedPaths = ragIncludedPaths;
			this.project.ragExcludedPaths = ragExcludedPaths;
			this.project.defaultProviderId = this.defaultProviderId;
			this.project.defaultModelId = this.defaultModelId;
			this.project.systemPromptId = this.systemPromptId;
			this.project.historySubfolder = nextHistorySubfolder;
		}

		await this.plugin.saveSettings();

		// Update store
		syncProjectStore(this.plugin.settings.projects.list, this.plugin.settings.projects.activeProjectId);

		// Refresh settings tab UI
		this.plugin.refreshSettingTab();

		// If this is the active project, trigger re-index
		const activeId = getActiveProject().id;
		if (this.project?.id === activeId || this.isNewProject) {
			if (this.project?.id === activeId) {
				if (this.plugin.indexer) {
					// We need to reindex since paths changed
					this.plugin.indexer.isDestroyed = true;
					this.plugin.indexer.destroy();
					setTotalFiles(0);

					const { projectIndexCache } = await import('../../../features/rag/projectIndexCache');
					projectIndexCache.delete(activeId);

					// Use switchProjectIndex to re-init
					await switchProjectIndex(this.plugin, activeId);
				}
			}
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

