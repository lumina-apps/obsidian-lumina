import { t } from "../../../shared/locales/helpers";

import { Modal, Setting, TFolder, TextComponent, normalizePath, Notice, TAbstractFile } from 'obsidian';
import type LuminaPlugin from '../../../main';
import type { ProjectConfig } from '../../../shared/types/project.types';
import { getActiveProject, syncProjectStore } from '../../../core/store/projectStore';
import { switchProjectIndex } from '../../../features/rag/ragInitializer';
import { setTotalFiles } from '../../../core/store/ragStore';
import { buildChatModelOptions, toProviderModelValue, parseProviderModelValue } from '../../../shared/utils/modelUtils';
import { debugLogger } from '../../../shared/debugLogger';

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
			this.projectName = (project.id === 'default' && project.name === 'Default') ? (t('projects.settings.defaultProjectName') || 'Default Project') : project.name;

			const sanitizeName = (n: string) => n.trim().replace(/[\\/:*?"<>|]/g, '_');
			this.historySubfolder = project.historySubfolder !== undefined ? project.historySubfolder : (project.id === 'default' ? '' : sanitizeName(project.name));
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
			const chatHistoryPath = this.plugin.settings.chat.historyPath || 'chatHistory';
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

		contentEl.createEl('h2', { text: this.isNewProject ? t('projects.settings.newProjectTitle') || '새 프로젝트 생성' : t('projects.settings.modalTitle') || '프로젝트 설정' });

		const sanitizeName = (n: string) => n.trim().replace(/[\\/:*?"<>|]/g, '_');

		new Setting(contentEl)
			.setName(t('projects.settings.projectName') || '프로젝트 이름')
			.setDesc(t('projects.settings.projectNameDesc') || '프로젝트의 이름을 지정합니다.')
			.addText(text => {
				text.setValue(this.projectName)
					.onChange(val => {
						this.projectName = val;
						if (historyPathInput && !this.historySubfolder) {
							const isDefault = this.project?.id === 'default';
							const placeholder = isDefault 
								? (t('projects.settings.chatHistoryRootPlaceholder') || '(기본) chatHistory 루트 사용') 
								: (sanitizeName(val) || (t('projects.settings.chatHistoryAutoPlaceholder') || '자동 지정'));
							historyPathInput.setPlaceholder(placeholder);
						}
						previewEl.setText(t('projects.settings.chatHistoryPreview', { path: this.getHistoryDisplayPath() }) || `저장 경로: ${this.getHistoryDisplayPath()}`);
					});
			});

		// Auto / Custom history path display
		let historyPathInput: TextComponent | null = null;
		const isDefault = this.project?.id === 'default';
		const defaultPlaceholder = isDefault 
			? (t('projects.settings.chatHistoryRootPlaceholder') || '(기본) chatHistory 루트 사용') 
			: (sanitizeName(this.projectName) || (t('projects.settings.chatHistoryAutoPlaceholder') || '자동 지정'));

		const historySetting = new Setting(contentEl)
			.setName(t('projects.settings.chatHistoryPath') || '채팅 히스토리 저장 경로')
			.setDesc(t('projects.settings.chatHistoryPathDesc') || '이 프로젝트의 대화가 저장될 하위 폴더명입니다. (비워둘 경우 프로젝트 이름 사용)')
			.addText(text => {
				historyPathInput = text;
				text.setPlaceholder(defaultPlaceholder)
					.setValue(this.historySubfolder)
					.onChange(val => {
						this.historySubfolder = val.trim();
						previewEl.setText(t('projects.settings.chatHistoryPreview', { path: this.getHistoryDisplayPath() }) || `저장 경로: ${this.getHistoryDisplayPath()}`);
					});
			});

		const previewEl = historySetting.descEl.createDiv({ cls: 'lumina-settings__desc-guide' });
		previewEl.setText(t('projects.settings.chatHistoryPreview', { path: this.getHistoryDisplayPath() }) || `저장 경로: ${this.getHistoryDisplayPath()}`);

		// --- Default Chat Model Selector ---
		const chatModelOptions = buildChatModelOptions(this.plugin.settings.connections.providers);
		let currentModelValue = this.defaultProviderId && this.defaultModelId
			? toProviderModelValue(this.defaultProviderId, this.defaultModelId)
			: '';
		
		let isModelMissing = currentModelValue !== '' && !chatModelOptions.some(opt => opt.value === currentModelValue);

		new Setting(contentEl)
			.setName(t('projects.settings.defaultModel') || '기본 채팅 모델')
			.setDesc(t('projects.settings.defaultModelDesc') || '이 프로젝트에서 새 채팅을 시작할 때 사용할 기본 모델입니다.')
			.addDropdown(dropdown => {
				dropdown.addOption('', t('projects.settings.defaultModelAuto') || '자동 선택 (첫 번째 사용 가능한 모델)');
				
				if (isModelMissing) {
					dropdown.addOption(currentModelValue, `${t('projects.settings.deletedModel') || '[삭제됨] 모델'} (${this.defaultModelId})`);
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
				
				// Make sure the dropdown can handle long text without breaking layout
				dropdown.selectEl.setCssStyles({ maxWidth: '230px', textOverflow: 'ellipsis' });
			});

		// --- Default System Prompt Selector ---
		const systemPrompts = this.plugin.settings.chat.systemPrompts;
		let isPromptMissing = this.systemPromptId !== '' && !systemPrompts.some(p => p.id === this.systemPromptId);
		
		new Setting(contentEl)
			.setName(t('projects.settings.systemPrompt') || '기본 시스템 프롬프트')
			.setDesc(t('projects.settings.systemPromptDesc') || '이 프로젝트에서 새 채팅을 시작할 때 사용할 시스템 프롬프트입니다.')
			.addDropdown(dropdown => {
				dropdown.addOption('', t('projects.settings.systemPromptAuto') || '자동 선택 (첫 번째 시스템 프롬프트)');
				
				if (isPromptMissing) {
					dropdown.addOption(this.systemPromptId, t('projects.settings.deletedPrompt') || '[삭제됨] 프롬프트');
				}

				systemPrompts.forEach(p => {
					dropdown.addOption(p.id, p.name);
				});
				
				dropdown.setValue(this.systemPromptId);
				dropdown.onChange((value: string) => {
					this.systemPromptId = value;
				});

				// Make sure the dropdown can handle long text without breaking layout
				dropdown.selectEl.setCssStyles({ maxWidth: '230px', textOverflow: 'ellipsis' });
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
				if (cb instanceof HTMLInputElement) {
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

			const nameEl = rowEl.createSpan({ text: isRoot ? t('projects.settings.vaultRoot') || '전체 볼트 (/)' : folder.name });
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
			t('projects.settings.ragTargetFolder') || 'RAG 대상 폴더',
			t('projects.settings.ragTargetFolderDesc') || '인덱싱할 폴더를 트리에서 체크하세요. 하위 폴더를 열어 특정 폴더만 선택할 수 있습니다.',
			this.includedPaths,
			t('projects.settings.ragTargetFolderEmpty') || '선택된 대상 폴더가 없습니다. (전체 볼트 대상)'
		);

		// RAG Exclude Folders
		buildTreeSelect(
			t('projects.settings.ragExcludedFolders') || 'RAG 제외 폴더',
			t('projects.settings.ragExcludedFoldersDesc') || '인덱싱에서 제외할 폴더를 체크하세요.',
			this.excludedPaths,
			t('projects.settings.ragExcludedFoldersEmpty') || '제외된 폴더가 없습니다.'
		);

		// Save Button
		const saveSetting = new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText(t('projects.settings.save') || '저장')
				.setCta()
				.onClick(async () => {
					await this.saveProject();
					this.close();
				})
			);
		
		saveSetting.settingEl.addClass('lumina-sticky-save-setting');
	}

	private getHistoryDisplayPath(): string {
		const sanitizeSubfolder = (sub: string) => {
			const converted = sub.trim().replace(/\\/g, '/');
			const cleaned = converted.replace(/[:*?"<>|]/g, '_').replace(/^\/+|\/+$/g, '');
			return normalizePath(cleaned);
		};
		const sanitizeName = (name: string) => name.trim().replace(/[\\/:*?"<>|]/g, '_');

		let subfolder = '';
		if (this.historySubfolder.trim()) {
			subfolder = sanitizeSubfolder(this.historySubfolder);
		} else if (this.project?.id !== 'default' && this.projectName.trim()) {
			subfolder = sanitizeName(this.projectName);
		}

		const basePath = normalizePath(this.plugin.settings.chat.historyPath || 'chatHistory');
		return subfolder ? normalizePath(`${basePath}/${subfolder}`) : basePath;
	}

	private async moveHistoryFolder(oldSubfolder: string, newSubfolder: string) {
		const historyBasePath = this.plugin.settings.chat.historyPath || 'chatHistory';

		if (!oldSubfolder || !newSubfolder || oldSubfolder === newSubfolder) return;

		const oldPath = normalizePath(`${historyBasePath}/${oldSubfolder}`);
		const newPath = normalizePath(`${historyBasePath}/${newSubfolder}`);

		try {
			const oldFolder = this.app.vault.getAbstractFileByPath(oldPath);
			if (!(oldFolder instanceof TFolder)) {
				debugLogger.logSystem('projects', `moveHistoryFolder: Old path "${oldPath}" is not a folder or does not exist. Skipping move.`);
				return;
			}

			const newFolderExists = this.app.vault.getAbstractFileByPath(newPath);
			if (newFolderExists) {
				new Notice(t('projects.settings.historyTargetExists', { path: newPath }) || `Failed to move chat history: Target folder "${newPath}" already exists.`);
				return;
			}

			await this.app.fileManager.renameFile(oldFolder, newPath);
			new Notice(t('projects.settings.historyMoved', { path: newPath }) || `Chat history moved to "${newPath}"`);
			debugLogger.logSystem('projects', `Successfully moved chat history from "${oldPath}" to "${newPath}"`);
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			new Notice(t('projects.settings.historyMoveError', { error: msg }) || `Error moving chat history folder: ${msg}`);
			debugLogger.logError('projects', error instanceof Error ? error : new Error(msg));
		}
	}

	async saveProject() {
		const name = this.projectName.trim();
		if (!name) return;
		
		let finalName = name;
		if (this.project?.id === 'default' && name === (t('projects.settings.defaultProjectName') || 'Default Project')) {
			finalName = 'Default';
		}

		const sanitizeSubfolder = (sub: string) => {
			const converted = sub.trim().replace(/\\/g, '/');
			const cleaned = converted.replace(/[:*?"<>|]/g, '_').replace(/^\/+|\/+$/g, '');
			return normalizePath(cleaned);
		};
		const sanitizeName = (n: string) => n.trim().replace(/[\\/:*?"<>|]/g, '_');

		let historySubfolder = '';
		if (this.historySubfolder.trim()) {
			historySubfolder = sanitizeSubfolder(this.historySubfolder);
		} else if (this.project?.id !== 'default' && finalName) {
			historySubfolder = sanitizeName(finalName);
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

			this.project.name = finalName;
			this.project.ragIncludedPaths = ragIncludedPaths;
			this.project.ragExcludedPaths = ragExcludedPaths;
			this.project.defaultProviderId = this.defaultProviderId;
			this.project.defaultModelId = this.defaultModelId;
			this.project.systemPromptId = this.systemPromptId;
			this.project.historySubfolder = historySubfolder;

			if (oldHistorySubfolder && oldHistorySubfolder !== historySubfolder) {
				await this.moveHistoryFolder(oldHistorySubfolder, historySubfolder);
			}
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

