import { FuzzySuggestModal, Notice, TFile, TFolder, MarkdownView, Modal, normalizePath, setIcon, type App } from "obsidian";
import { t } from "../../../../shared/locales/helpers";
import type { ContextAttachment } from "../../../../shared/types/chat.types";
import { debugLogger } from "../../../../shared/debugLogger";
import { normalizeError } from "../../../../shared/utils/errorUtils";
import { ensureFolderExists, extractFileName, isMarkdownFile, sanitizeFilePath, sanitizeFilename } from "../../../../shared/utils/fileUtils";
import { resolveSafeLeafTarget, revealLeafOnMobile } from "../../../../shared/utils/workspaceNavUtils";

/**
 * 파일 경로로 Obsidian 노트를 연다.
 * Ctrl/Cmd+클릭 또는 마우스 중간 버튼이면 새 탭에서 연다.
 */
export async function openFile(
	app: App,
	filePath: string,
	e: MouseEvent | KeyboardEvent,
	chunkText?: string
): Promise<void> {
	let file = app.vault.getAbstractFileByPath(filePath);
	if (!file) {
		file = app.metadataCache.getFirstLinkpathDest(filePath, "") ??
			app.vault.getAbstractFileByPath(`${filePath}.md`);
	}
	if (file instanceof TFile) {
		const requestedTarget = e.ctrlKey || e.metaKey || ("button" in e && e.button === 1) ? "tab" : false;
		const leaf = app.workspace.getLeaf(
			resolveSafeLeafTarget(app.workspace, requestedTarget),
		);
		let lineNo: number | undefined = undefined;
		if (chunkText) {
			try {
				const content = await app.vault.cachedRead(file);
				
				const linesOfChunk = chunkText.split('\n').map(l => l.trim()).filter(l => l.length > 5);
				let foundIdx = -1;
				
				const rawLines = content.split('\n');
				for (const chunkLine of linesOfChunk) {
					// 모든 마크다운 구문과 공백을 제거하여 순수 텍스트(알파벳, 한글, 숫자 등)만 비교
					const cleanTarget = chunkLine.replace(/[[\]|\-*#>`'"{}\s]/g, '').slice(0, 50);
					if (cleanTarget.length < 5) continue;
					
					foundIdx = rawLines.findIndex(l => l.replace(/[[\]|\-*#>`'"{}\s]/g, '').includes(cleanTarget));
					if (foundIdx !== -1) {
						break;
					}
				}
				
				if (foundIdx !== -1) {
					lineNo = foundIdx;
				}
			} catch (err) {
				debugLogger.logWarn('chat', `Failed to read file for chunk search: ${err}`);
			}
		}
		
		await leaf.openFile(file, lineNo !== undefined ? { eState: { line: lineNo } } : undefined);
		await revealLeafOnMobile(app.workspace, leaf);
	} else {
		new Notice(t("uiMessages.fileNotFound"));
	}
}

/**
 * 이미지 또는 텍스트 컨텍스트 첨부파일 미리보기 모달
 */
export class AttachmentPreviewModal extends Modal {
	private attachment: ContextAttachment;

	constructor(app: App, attachment: ContextAttachment) {
		super(app);
		this.attachment = attachment;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: this.attachment.name, cls: "lumina-attachment-modal-title" });

		if (this.attachment.content?.startsWith("data:image/")) {
			const imgContainer = contentEl.createDiv({ cls: "lumina-attachment-modal-image-wrap" });
			const img = imgContainer.createEl("img", {
				cls: "lumina-attachment-preview-img",
			});
			img.src = this.attachment.content;
			img.alt = this.attachment.name;
		} else if (this.attachment.content) {
			const pre = contentEl.createEl("pre", {
				cls: "lumina-attachment-preview-text",
			});
			pre.textContent = this.attachment.content.slice(0, 50000);
		}
	}

	onClose() {
		this.contentEl.empty();
	}
}

/**
 * 첨부파일 클릭 시 타입에 맞게 파일 열기 / 브라우저 열기 / 미리보기 모달 열기
 */
export function openAttachment(
	app: App,
	att: ContextAttachment,
	e: MouseEvent | KeyboardEvent
): void {
	if (att.type === "file" || att.type === "active_note" || att.type === "canvas") {
		const targetPath = att.path || att.name;
		void openFile(app, targetPath, e);
	} else if (att.type === "url") {
		if (att.path) {
			window.open(att.path, "_blank", "noopener,noreferrer");
		}
	} else if (att.type === "folder") {
		if (att.path) {
			new Notice(`Folder: ${att.path}`);
		}
	} else if (att.type === "tag") {
		const globalSearch = (app as unknown as { internalPlugins?: { getPluginById?: (id: string) => { instance?: { openGlobalSearch?: (q: string) => void } } } })
			.internalPlugins?.getPluginById?.("global-search");
		if (globalSearch?.instance?.openGlobalSearch) {
			globalSearch.instance.openGlobalSearch(`tag:${att.name}`);
		} else {
			new Notice(`Tag: #${att.name}`);
		}
	} else if (att.type === "external_file" || att.content) {
		const targetPath = att.path || att.name;
		let inVaultFile: unknown = null;
		if (targetPath) {
			inVaultFile = app.vault.getAbstractFileByPath(targetPath) ??
				app.metadataCache.getFirstLinkpathDest(targetPath, "");
		}
		if (inVaultFile instanceof TFile) {
			void openFile(app, inVaultFile.path, e);
		} else if (att.content) {
			new AttachmentPreviewModal(app, att).open();
		} else if (att.path) {
			void openFile(app, att.path, e);
		} else {
			new Notice(t("uiMessages.fileNotFound"));
		}
	}
}

/**
 * 현재 활성 편집기의 커서 위치에 content를 삽입한다.
 * 마크다운 뷰를 찾지 못하면 Notice로 알린다.
 */
export function insertToNote(app: App, content: string): void {
	const activeEditor = app.workspace.activeEditor?.editor;
	if (activeEditor) {
		activeEditor.replaceSelection(content);
		new Notice(t("uiMessages.contentInserted"));
		return;
	}

	let activeView = app.workspace.getActiveViewOfType(MarkdownView);
	if (!activeView) {
		const activeFile = app.workspace.getActiveFile();
		if (activeFile) {
			const leaves = app.workspace.getLeavesOfType("markdown");
			for (const leaf of leaves) {
				const viewCompat = leaf.view as unknown as { file?: { path: string } };
				if (viewCompat.file?.path === activeFile.path) {
					activeView = leaf.view as MarkdownView;
					break;
				}
			}
		}
	}

	if (activeView && activeView.editor) {
		activeView.editor.replaceSelection(content);
		new Notice(t("uiMessages.contentInserted"));
	} else {
		new Notice(t("uiMessages.noActiveMarkdown"));
	}
}

/**
 * 현재 활성 마크다운 노트(.md)를 찾는다.
 */
export function getActiveMarkdownFile(app: App): TFile | null {
	const candidate = app.workspace.getActiveFile() ?? app.workspace.activeEditor?.file ?? null;
	return isMarkdownFile(candidate) ? candidate : null;
}

/**
 * 현재 활성 마크다운 노트의 문서 끝에 content를 추가(Append)한다.
 * 읽기 모드에서도 안전하게 동작하며, 활성 마크다운 노트가 없으면 Notice로 알린다.
 */
export async function appendToActiveNote(app: App, content: string): Promise<boolean> {
	const activeFile = getActiveMarkdownFile(app);
	if (!activeFile) {
		new Notice(t("uiMessages.noActiveNote"));
		return false;
	}

	try {
		await app.vault.process(activeFile, (existing) => {
			if (!existing) return content;
			if (existing.endsWith("\n\n")) return `${existing}${content}`;
			if (existing.endsWith("\n")) return `${existing}\n${content}`;
			return `${existing}\n\n${content}`;
		});
		new Notice(t("uiMessages.contentAppended", { path: activeFile.path }));
		return true;
	} catch (err) {
		debugLogger.logError("chat", normalizeError(err, "Failed to append content to active note"));
		new Notice(t("uiMessages.noteSaveFailed"));
		return false;
	}
}

/**
 * 현재 시각 기준의 기본 노트 제목을 생성한다.
 */
function buildFallbackNoteTitle(date: Date = new Date()): string {
	const yyyy = date.getFullYear();
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	const hh = String(date.getHours()).padStart(2, "0");
	const min = String(date.getMinutes()).padStart(2, "0");
	return `Lumina Note ${yyyy}-${mm}-${dd} ${hh}${min}`;
}

/**
 * 마크다운 한 줄에서 링크 URL·위키링크·장식 기호를 제거하고 제목용 순수 텍스트를 추출한다.
 */
function stripMarkdownLineForTitle(rawLine: string): string {
	let line = rawLine.trim();
	if (!line) return "";
	// 구분선, 코드 펜스, 빈 콜아웃 헤더는 제목 후보에서 제외
	if (/^([-*_])\1{2,}$/.test(line) || /^`{3,}|^~{3,}/.test(line)) {
		return "";
	}
	if (/^>\s*\[![^\]]+\]\s*$/.test(line)) {
		return "";
	}

	line = line
		.replace(/^>\s*\[![^\]]+\]\s*/, "")
		.replace(/^#{1,6}\s+/, "")
		.replace(/^[-*+]\s+/, "")
		.replace(/^\d+\.\s+/, "")
		.replace(/^>\s*/, "")
		// 이미지/링크는 URL을 버리고 표시 라벨만 남김
		.replace(/!\[([^\]]*)\]\((?:[^()]+|\([^()]*\))*\)/g, "$1")
		.replace(/\[([^\]]+)\]\((?:[^()]+|\([^()]*\))*\)/g, "$1")
		// 위키링크는 별칭 또는 파일명만 남김
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, (_m, target: string) => extractFileName(target))
		// 노출된 URL 제거
		.replace(/\(?(?:file|https?|mailto):\/\/[^\s)]*\)?/gi, "")
		.replace(/\(\s*\)/g, "")
		.replace(/[`*_~[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim();

	return line;
}

/**
 * 추출한 제목 텍스트를 파일명 길이에 맞게 정리하고 금지 문자를 치환한다.
 */
function finalizeSuggestedTitle(rawTitle: string): string {
	let trimmed = rawTitle.trim();
	if (trimmed.length > 50) {
		const sliced = trimmed.slice(0, 50);
		const lastSpace = sliced.lastIndexOf(" ");
		trimmed = (lastSpace >= 20 ? sliced.slice(0, lastSpace) : sliced).trim();
	}
	return sanitizeFilename(trimmed).replace(/[. ]+$/, "").trim();
}

/**
 * 답변 본문에서 새 노트의 기본 추천 제목을 추출한다.
 * 상단에 마크다운 헤딩이 있으면 우선 사용하고, 없으면 첫 유효 문장(링크 URL 제외)을 사용한다.
 */
export function suggestNoteTitle(content: string): string {
	const lines = content.split(/\r?\n/);
	let firstCandidate = "";
	let checkedLines = 0;

	for (const rawLine of lines) {
		const trimmed = rawLine.trim();
		if (!trimmed) continue;

		const isHeading = /^#{1,6}\s+/.test(trimmed);
		const cleaned = stripMarkdownLineForTitle(trimmed);
		if (!cleaned) continue;

		const safe = finalizeSuggestedTitle(cleaned);
		if (!safe) continue;

		if (isHeading) {
			return safe;
		}
		if (!firstCandidate) {
			firstCandidate = safe;
		}

		checkedLines += 1;
		if (checkedLines >= 8) break;
	}

	return firstCandidate || buildFallbackNoteTitle();
}

/**
 * Obsidian 설정('새 노트의 기본 위치')에 따른 기본 저장 폴더 경로를 반환한다.
 */
export function getDefaultNewNoteFolder(app: App): string {
	const activeFile = app.workspace.getActiveFile?.() ?? app.workspace.activeEditor?.file ?? null;
	const parent = app.fileManager?.getNewFileParent?.(activeFile?.path ?? "");
	if (!parent || !parent.path || parent.path === "/") {
		return "";
	}
	return normalizePath(parent.path);
}

/**
 * 사용자 입력 폴더 경로를 안전하게 정규화한다. (루트 및 빈 문자열은 "" 반환)
 */
export function normalizeFolderInput(rawFolder: string): string {
	const trimmed = rawFolder.trim();
	if (!trimmed || trimmed === "/") {
		return "";
	}
	const sanitized = sanitizeFilePath(trimmed, false).replace(/^\/+|\/+$/g, "");
	return sanitized === "/" ? "" : sanitized;
}

/**
 * 폴더 경로와 제목을 조합하고, 동일 파일이 존재할 경우 번호 접미사를 붙여 고유 경로를 반환한다.
 */
export function resolveUniqueNotePath(app: App, folderPath: string, rawTitle: string): string {
	const cleanInput = sanitizeFilename(rawTitle.trim()).replace(/\.md$/i, "").replace(/[. ]+$/, "");
	const baseName = cleanInput || buildFallbackNoteTitle();
	const normalizedFolder = normalizeFolderInput(folderPath);
	const prefix = normalizedFolder ? `${normalizedFolder}/` : "";

	let candidate = normalizePath(`${prefix}${baseName}.md`);
	let suffix = 1;
	while (app.vault.getAbstractFileByPath(candidate)) {
		candidate = normalizePath(`${prefix}${baseName} (${suffix}).md`);
		suffix += 1;
	}
	return candidate;
}

/**
 * 볼트 내 폴더를 검색해 선택하는 퍼지 검색 모달.
 */
export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
	private readonly modalApp: App;
	private readonly onSelect: (folderPath: string) => void;

	constructor(app: App, onSelect: (folderPath: string) => void) {
		super(app);
		this.modalApp = app;
		this.onSelect = onSelect;
		this.setPlaceholder(t("uiMessages.saveAsNoteFolderPlaceholder"));
	}

	getItems(): TFolder[] {
		const loaded = this.modalApp.vault.getAllLoadedFiles?.() ?? [];
		const folders = loaded.filter((f): f is TFolder => f instanceof TFolder);
		return folders.sort((a, b) => {
			if (a.path === "/" || a.path === "") return -1;
			if (b.path === "/" || b.path === "") return 1;
			return a.path.localeCompare(b.path);
		});
	}

	getItemText(folder: TFolder): string {
		return !folder.path || folder.path === "/"
			? t("uiMessages.saveAsNoteFolderRoot")
			: folder.path;
	}

	onChooseItem(folder: TFolder): void {
		this.onSelect(!folder.path || folder.path === "/" ? "" : folder.path);
	}
}

/**
 * 새 마크다운 노트를 생성하고 새 탭에서 열어 즉시 활성화한다.
 */
export async function createAndOpenNote(
	app: App,
	folderPath: string,
	rawTitle: string,
	content: string,
): Promise<TFile | null> {
	const targetPath = resolveUniqueNotePath(app, folderPath, rawTitle);
	try {
		await ensureFolderExists(app, targetPath);
		const file = await app.vault.create(targetPath, content);
		const leaf = app.workspace.getLeaf("tab");
		if (leaf) {
			await leaf.openFile(file);
			await revealLeafOnMobile(app.workspace, leaf);
		}
		new Notice(t("uiMessages.noteSaved", { path: file.path }));
		return file;
	} catch (err) {
		debugLogger.logError("chat", normalizeError(err, "Failed to save response as new note"));
		new Notice(t("uiMessages.noteSaveFailed"));
		return null;
	}
}

/**
 * 어시스턴트 답변을 새 노트로 저장하기 전 파일명과 저장 폴더를 확인/입력받는 모달.
 */
export class SaveAsNoteModal extends Modal {
	private readonly modalApp: App;
	private readonly content: string;
	private folderValue: string;
	private titleValue: string;
	private isSubmitting = false;
	private focusTimerId: number | null = null;

	constructor(app: App, content: string, initialTitle?: string) {
		super(app);
		this.modalApp = app;
		this.content = content;
		this.folderValue = getDefaultNewNoteFolder(app);
		this.titleValue = initialTitle ?? suggestNoteTitle(content);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl?.addClass("lumina-save-note-modal");
		contentEl.empty();
		contentEl.addClass("lumina-save-note-modal__content");

		// 헤더
		const headerEl = contentEl.createDiv({ cls: "lumina-save-note-modal__header" });
		const iconWrap = headerEl.createSpan({ cls: "lumina-save-note-modal__header-icon" });
		setIcon(iconWrap, "file-plus");
		headerEl.createEl("h3", {
			text: t("uiMessages.saveAsNoteTitle"),
			cls: "lumina-save-note-modal__title",
		});

		// 노트 제목 입력
		const titleFieldEl = contentEl.createDiv({ cls: "lumina-save-note-modal__field" });
		const titleLabelEl = titleFieldEl.createEl("label", {
			text: t("uiMessages.saveAsNoteNameLabel"),
			cls: "lumina-save-note-modal__label",
		});

		const titleInputEl = titleFieldEl.createEl("input", {
			cls: "lumina-save-note-modal__input",
		});
		titleInputEl.type = "text";
		titleInputEl.placeholder = t("uiMessages.saveAsNoteNamePlaceholder");
		titleInputEl.value = this.titleValue;
		const titleInputId = "lumina-save-note-title-input";
		titleInputEl.id = titleInputId;
		titleLabelEl.setAttribute("for", titleInputId);

		// 저장 폴더 입력 + 폴더 선택 버튼
		const folderFieldEl = contentEl.createDiv({ cls: "lumina-save-note-modal__field" });
		const folderLabelEl = folderFieldEl.createEl("label", {
			text: t("uiMessages.saveAsNoteFolderLabel"),
			cls: "lumina-save-note-modal__label",
		});

		const folderRowEl = folderFieldEl.createDiv({ cls: "lumina-save-note-modal__folder-row" });
		const folderInputEl = folderRowEl.createEl("input", {
			cls: "lumina-save-note-modal__input lumina-save-note-modal__folder-input",
		});
		folderInputEl.type = "text";
		folderInputEl.placeholder = t("uiMessages.saveAsNoteFolderPlaceholder");
		folderInputEl.value = this.folderValue;
		const folderInputId = "lumina-save-note-folder-input";
		folderInputEl.id = folderInputId;
		folderLabelEl.setAttribute("for", folderInputId);

		const folderBrowseBtn = folderRowEl.createEl("button", {
			cls: "lumina-save-note-modal__folder-btn clickable-icon",
		});
		folderBrowseBtn.type = "button";
		folderBrowseBtn.setAttribute("aria-label", t("uiMessages.saveAsNoteFolderBrowse"));
		folderBrowseBtn.setAttribute("title", t("uiMessages.saveAsNoteFolderBrowse"));
		setIcon(folderBrowseBtn, "folder-open");

		// 저장 경로 미리보기
		const previewEl = contentEl.createDiv({ cls: "lumina-save-note-modal__preview" });
		const previewIcon = previewEl.createSpan({ cls: "lumina-save-note-modal__preview-icon" });
		setIcon(previewIcon, "file-text");
		const previewTextEl = previewEl.createSpan({ cls: "lumina-save-note-modal__preview-text" });

		const updatePreview = (): void => {
			const previewPath = resolveUniqueNotePath(this.modalApp, this.folderValue, this.titleValue);
			previewTextEl.textContent = t("uiMessages.saveAsNotePathPreview", { path: previewPath });
		};

		const submit = async (): Promise<void> => {
			if (this.isSubmitting) return;
			this.isSubmitting = true;
			saveBtn.disabled = true;
			const created = await createAndOpenNote(
				this.modalApp,
				this.folderValue,
				this.titleValue,
				this.content,
			);
			this.isSubmitting = false;
			if (created) {
				this.close();
			} else {
				saveBtn.disabled = false;
			}
		};

		titleInputEl.addEventListener("input", () => {
			this.titleValue = titleInputEl.value;
			updatePreview();
		});
		folderInputEl.addEventListener("input", () => {
			this.folderValue = folderInputEl.value;
			updatePreview();
		});

		const handleEnterKey = (e: KeyboardEvent): void => {
			if (e.key === "Enter" && !e.isComposing) {
				e.preventDefault();
				void submit();
			}
		};
		titleInputEl.addEventListener("keydown", handleEnterKey);
		folderInputEl.addEventListener("keydown", handleEnterKey);

		folderBrowseBtn.addEventListener("click", () => {
			new FolderSuggestModal(this.modalApp, (selectedFolder) => {
				this.folderValue = selectedFolder;
				folderInputEl.value = selectedFolder;
				updatePreview();
			}).open();
		});

		updatePreview();

		// 푸터 버튼 영역
		const actionsEl = contentEl.createDiv({ cls: "lumina-save-note-modal__actions" });
		const cancelBtn = actionsEl.createEl("button", {
			text: t("common.cancel"),
			cls: "lumina-save-note-modal__btn-cancel",
		});
		cancelBtn.type = "button";
		cancelBtn.addEventListener("click", () => {
			this.close();
		});

		const saveBtn = actionsEl.createEl("button", {
			text: t("common.save"),
			cls: "lumina-save-note-modal__btn-save mod-cta",
		});
		saveBtn.type = "button";
		saveBtn.addEventListener("click", () => {
			void submit();
		});

		this.focusTimerId = window.setTimeout(() => {
			titleInputEl.focus();
			titleInputEl.select();
			this.focusTimerId = null;
		}, 0);
	}

	onClose(): void {
		if (this.focusTimerId !== null) {
			window.clearTimeout(this.focusTimerId);
			this.focusTimerId = null;
		}
		this.contentEl.empty();
	}
}

/**
 * 답변 내용을 새 노트로 저장하는 모달을 연다.
 */
export function openSaveAsNoteModal(app: App, content: string): void {
	new SaveAsNoteModal(app, content).open();
}