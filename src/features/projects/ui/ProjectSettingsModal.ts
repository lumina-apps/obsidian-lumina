import { t } from "../../../shared/locales/helpers";

import { App, Modal, Setting, TFolder } from 'obsidian';
import type LuminaPlugin from '../../../main';
import type { ProjectConfig } from '../../../shared/types/project.types';
import { getActiveProject, syncProjectStore } from '../../../core/store/projectStore';
import { switchProjectIndex } from '../../../features/rag/ragInitializer';
import { setTotalFiles } from '../../../core/store/ragStore';
import { buildChatModelOptions, toProviderModelValue, parseProviderModelValue } from '../../../shared/utils/modelUtils';

export class ProjectSettingsModal extends Modal {
	private plugin: LuminaPlugin;
	private project: ProjectConfig | null;

	// Local state
	private projectName: string = '';
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

			const existingFolders = new Set(
				this.app.vault.getAllLoadedFiles()
					.filter(f => f instanceof TFolder)
					.map(f => f.path)
			);

			const validIncluded = project.ragIncludedPaths.filter(p => p === '/' || existingFolders.has(p));
			const validExcluded = project.ragExcludedPaths.filter(p => p === '/' || existingFolders.has(p));

			this.includedPaths = new Set(validIncluded);
			this.excludedPaths = new Set(validExcluded);
			this.defaultProviderId = project.defaultProviderId || '';
			this.defaultModelId = project.defaultModelId || '';
			this.systemPromptId = project.systemPromptId || '';
		} else {
			this.project = null;
			this.projectName = '';
			this.includedPaths = new Set();
			this.defaultProviderId = '';
			this.defaultModelId = '';
			this.systemPromptId = '';
			// Auto detect default excludes
			const commonExcludes = ['Templates', 'templates', '_templates', 'chatHistory', 'Chat History', 'Attachments', 'attachments', 'backups'];
			const existingFolders = this.app.vault.getAllLoadedFiles().filter(f => f instanceof TFolder).map(f => f.path);
			const detectedExcludes = commonExcludes.filter(ex => existingFolders.includes(ex));
			this.excludedPaths = new Set(detectedExcludes);
		}
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: this.isNewProject ? t('projects.settings.newProjectTitle') || '새 프로젝트 생성' : t('projects.settings.modalTitle') || '프로젝트 설정' });

		const isDefault = this.project?.id === 'default';

		const nameInput = new Setting(contentEl)
			.setName(t('projects.settings.projectName') || '프로젝트 이름')
			.setDesc(t('projects.settings.projectNameDesc') || '프로젝트의 이름을 지정합니다.')
			.addText(text => {
				text.setValue(this.projectName)
					.onChange(val => {
						this.projectName = val;
						historyPathInput.setValue(this.getHistoryDisplayPath());
					});
			});

		// Auto history path display
		let historyPathInput: any = null;
		new Setting(contentEl)
			.setName(t('projects.settings.chatHistoryPath') || '채팅 히스토리 저장 경로')
			.setDesc(t('projects.settings.chatHistoryPathDesc') || '이 프로젝트의 채팅 기록이 저장될 경로입니다. (자동 지정)')
			.addText(text => {
				historyPathInput = text;
				text.setValue(this.getHistoryDisplayPath()).setDisabled(true);
			});

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
				dropdown.selectEl.style.maxWidth = '230px';
				dropdown.selectEl.style.textOverflow = 'ellipsis';
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
				dropdown.selectEl.style.maxWidth = '230px';
				dropdown.selectEl.style.textOverflow = 'ellipsis';
			});

		const folders = this.app.vault.getAllLoadedFiles().filter(f => f instanceof TFolder).map(f => f.path);
		folders.sort((a, b) => a.localeCompare(b));

		const renderFolderTree = (
			container: HTMLElement,
			folder: TFolder,
			selectedPaths: Set<string>,
			onChange: () => void,
			isRoot: boolean = true
		) => {
			const itemEl = container.createDiv({ cls: 'lumina-tree-item' });
			itemEl.style.marginLeft = isRoot ? '0' : '20px';
			itemEl.style.marginTop = '4px';

			const rowEl = itemEl.createDiv({ cls: 'lumina-tree-row' });
			rowEl.style.display = 'flex';
			rowEl.style.alignItems = 'center';
			rowEl.style.gap = '6px';

			const subFolders = folder.children.filter((c): c is TFolder => c instanceof TFolder);
			subFolders.sort((a, b) => a.name.localeCompare(b.name));
			const hasChildren = subFolders.length > 0;

			const toggleEl = rowEl.createSpan({ cls: 'lumina-tree-toggle' });
			toggleEl.style.width = '16px';
			toggleEl.style.display = 'inline-block';
			toggleEl.style.cursor = hasChildren ? 'pointer' : 'default';
			
			const childrenContainer = itemEl.createDiv({ cls: 'lumina-tree-children' });
			childrenContainer.style.display = 'none'; // collapsed by default

			if (hasChildren) {
				toggleEl.innerHTML = '▶'; // Collapsed state
				toggleEl.style.fontSize = '0.8em';
				toggleEl.onclick = () => {
					const isCollapsed = childrenContainer.style.display === 'none';
					childrenContainer.style.display = isCollapsed ? 'block' : 'none';
					toggleEl.innerHTML = isCollapsed ? '▼' : '▶';
				};
			}

			const cb = rowEl.createEl('input', { type: 'checkbox' });
			const folderPath = isRoot ? '/' : folder.path;
			
			if (isRoot) {
				cb.style.display = 'none'; // Hide root checkbox to prevent confusion
			} else {
				cb.checked = selectedPaths.has(folderPath);
				cb.onchange = () => {
					if (cb.checked) {
						selectedPaths.add(folderPath);
					} else {
						selectedPaths.delete(folderPath);
					}
					onChange();
				};
			}

			const nameEl = rowEl.createSpan({ text: isRoot ? t('projects.settings.vaultRoot') || '전체 볼트 (/)' : folder.name });
			nameEl.style.cursor = hasChildren ? 'pointer' : 'default';
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
			details.style.marginBottom = '16px';
			details.style.border = '1px solid var(--background-modifier-border)';
			details.style.borderRadius = '8px';
			details.style.padding = '12px 16px';
			details.style.background = 'var(--background-secondary-alt)';
			
			const summary = details.createEl('summary', { text: name, cls: 'setting-item-heading' });
			summary.style.cursor = 'pointer';
			summary.style.outline = 'none';
			summary.style.fontWeight = 'var(--font-semibold)';
			summary.style.margin = '0';
			summary.style.padding = '4px 0';

			const descEl = details.createEl('p', { text: desc, cls: 'setting-item-description' });
			descEl.style.marginTop = '8px';
			descEl.style.marginBottom = '12px';

			const treeContainer = details.createDiv();
			treeContainer.style.maxHeight = '180px';
			treeContainer.style.overflowY = 'auto';
			treeContainer.style.border = '1px solid var(--background-modifier-border)';
			treeContainer.style.padding = '10px';
			treeContainer.style.borderRadius = '6px';
			treeContainer.style.marginBottom = '10px';
			treeContainer.style.background = 'var(--background-secondary)';

			const tagsContainer = details.createDiv();
			tagsContainer.style.display = 'flex';
			tagsContainer.style.flexWrap = 'wrap';
			tagsContainer.style.gap = '6px';
			tagsContainer.style.marginBottom = '10px';
			tagsContainer.style.padding = '0 10px';

			const renderTags = () => {
				tagsContainer.empty();
				if (selectedPaths.size === 0 && emptyText) {
					const emptySpan = tagsContainer.createSpan({ text: emptyText });
					emptySpan.style.color = 'var(--text-muted)';
					emptySpan.style.fontSize = '0.9em';
					emptySpan.style.fontStyle = 'italic';
					return;
				}

				selectedPaths.forEach(path => {
					const tag = tagsContainer.createDiv();
					tag.style.display = 'flex';
					tag.style.alignItems = 'center';
					tag.style.padding = '4px 8px';
					tag.style.background = 'var(--background-primary)';
					tag.style.border = '1px solid var(--background-modifier-border)';
					tag.style.borderRadius = '4px';
					tag.style.fontSize = '0.9em';

					tag.createSpan({ text: path });

					const removeBtn = tag.createSpan({ text: '✕' });
					removeBtn.style.marginLeft = '8px';
					removeBtn.style.cursor = 'pointer';
					removeBtn.style.color = 'var(--text-error)';
					removeBtn.onclick = () => {
						selectedPaths.delete(path);
						treeContainer.empty();
						renderFolderTree(treeContainer, this.app.vault.getRoot(), selectedPaths, renderTags, true);
						renderTags();
					};
				});
			};

			renderFolderTree(treeContainer, this.app.vault.getRoot(), selectedPaths, renderTags, true);
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
		new Setting(contentEl)
			.addButton(btn => btn
				.setButtonText(t('projects.settings.save') || '저장')
				.setCta()
				.onClick(async () => {
					await this.saveProject();
					this.close();
				})
			);
	}

	private getHistoryDisplayPath(): string {
		const isDefault = this.project?.id === 'default';
		const sanitizeName = (name: string) => name.trim().replace(/[\\/:*?"<>|]/g, '_');
		const historySubfolder = isDefault ? '' : (this.project?.historySubfolder || sanitizeName(this.projectName));
		const basePath = this.plugin.settings.chat.historyPath || 'Chat History';
		return historySubfolder ? `${basePath}/${historySubfolder}` : basePath;
	}

	async saveProject() {
		const name = this.projectName.trim();
		if (!name) return;

		const sanitizeName = (n: string) => n.trim().replace(/[\\/:*?"<>|]/g, '_');
		const historySubfolder = this.project?.id === 'default' ? '' : sanitizeName(name);

		const ragIncludedPaths = Array.from(this.includedPaths);
		const ragExcludedPaths = Array.from(this.excludedPaths);

		if (this.isNewProject) {
			const newProject: ProjectConfig = {
				id: crypto.randomUUID(),
				name,
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
			this.project.name = name;
			this.project.ragIncludedPaths = ragIncludedPaths;
			this.project.ragExcludedPaths = ragExcludedPaths;
			this.project.defaultProviderId = this.defaultProviderId;
			this.project.defaultModelId = this.defaultModelId;
			this.project.systemPromptId = this.systemPromptId;
			// Keep existing historySubfolder when renaming
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
