import { Notice, TFile, MarkdownView, Modal, type App } from "obsidian";
import { t } from "../../../../shared/locales/helpers";
import type { ContextAttachment } from "../../../../shared/types/chat.types";

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
		const leaf = app.workspace.getLeaf(
			e.ctrlKey || e.metaKey || ("button" in e && e.button === 1) ? "tab" : false,
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
				console.warn('Lumina: Failed to read file for chunk search', err);
			}
		}
		
		await leaf.openFile(file, lineNo !== undefined ? { eState: { line: lineNo } } : undefined);
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