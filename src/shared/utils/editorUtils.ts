import { App, MarkdownView } from 'obsidian';
import { extractFileName } from './fileUtils';

/**
 * 활성 에디터의 커서 위치에 마크다운 파일 링크를 삽입합니다.
 * @param app Obsidian App 인스턴스
 * @param path 대상 파일의 절대 경로
 * @returns 성공 여부 (에디터를 찾은 경우 true)
 */
export function insertLinkToActiveEditor(app: App, path: string): boolean {
	let editor = app.workspace.activeEditor?.editor;

	if (!editor) {
		const mdView = app.workspace.getLeavesOfType('markdown')
			.map((leaf) => leaf.view as MarkdownView)
			.find((view) => view.editor);
		if (mdView) editor = mdView.editor;
	}

	if (editor) {
		const cursor = editor.getCursor();
		const fileName = extractFileName(path);
		editor.replaceRange(`[[${fileName}]]`, cursor);
		return true;
	}

	return false;
}
