import { Notice, TFile, MarkdownView, type App } from "obsidian";
import { t } from "../../../../shared/locales/helpers";

/**
 * 파일 경로로 Obsidian 노트를 연다.
 * Ctrl/Cmd+클릭 또는 마우스 중간 버튼이면 새 탭에서 연다.
 */
export async function openFile(
	app: App,
	filePath: string,
	e: MouseEvent | KeyboardEvent,
): Promise<void> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (file instanceof TFile) {
		const leaf = app.workspace.getLeaf(
			e.ctrlKey || e.metaKey || ("button" in e && e.button === 1) ? "tab" : false,
		);
		await leaf.openFile(file);
	} else {
		new Notice(t("uiMessages.fileNotFound"));
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