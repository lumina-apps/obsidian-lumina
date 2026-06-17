import type { TFile } from "obsidian";
import { MarkdownView } from "obsidian";
import type LuminaPlugin from "../../../../../main";
import type { ContextAttachment } from "../../../../../shared/types/chat.types";
import type { TranslationKeys } from "../../../../../shared/locales/locale.types";
import { collectFolderPaths } from "./categories";

/**
 * 선택된 카테고리에 해당하는 아이템 목록을 생성합니다.
 * `files`와 `tagsInfo`는 `buildCategoryContext`의 결과를 재사용합니다.
 */
export function buildCategoryItems(
	categoryId: string,
	files: TFile[],
	tagsInfo: Record<string, unknown> | null,
	plugin: LuminaPlugin,
	getLabel: (key: TranslationKeys, vars?: Record<string, string | number>) => string,
): ContextAttachment[] {
	const items: ContextAttachment[] = [];

	switch (categoryId) {
		case "active_note": {
			const activeFile = plugin.app.workspace.getActiveFile();
			if (activeFile) {
				items.push({
					type: "active_note",
					path: activeFile.path,
					name: getLabel("settings.chat.context.activeNote", { name: activeFile.basename }),
				});
			}
			break;
		}
		case "selection": {
			const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
			const sel = (activeView?.editor as { getSelection?: () => string } | undefined)?.getSelection?.();
			if (sel) {
				items.push({
					type: "selection",
					path: "selection",
					name: getLabel("settings.chat.context.selectedText", { length: sel.length }),
				});
			}
			break;
		}
		case "folder": {
			const folderPaths = collectFolderPaths(files);
			for (const folderPath of folderPaths) {
				items.push({
					type: "folder",
					path: folderPath,
					name: folderPath,
				});
			}
			break;
		}
		case "file": {
			for (const f of files) {
				if (f.extension !== "canvas") {
					items.push({
						type: "file",
						path: f.path,
						name: f.basename,
					});
				}
			}
			break;
		}
		case "canvas": {
			for (const f of files) {
				if (f.extension === "canvas") {
					items.push({
						type: "canvas",
						path: f.path,
						name: f.basename,
					});
				}
			}
			break;
		}
		case "tag": {
			if (tagsInfo) {
				for (const t of Object.keys(tagsInfo)) {
					items.push({
						type: "tag",
						path: t,
						name: t,
					});
				}
			}
			break;
		}
	}

	return items;
}

/**
 * 아이템 목록을 검색어로 필터링하고 상위 N개만 반환합니다.
 */
export function filterItems(
	items: ContextAttachment[],
	query: string,
	maxResults: number = 50,
): ContextAttachment[] {
	const q = query.toLowerCase().trim();
	if (!q) return items.slice(0, maxResults);

	return items
		.filter(
			(item) =>
				item.name.toLowerCase().includes(q) ||
				item.path.toLowerCase().includes(q),
		)
		.slice(0, maxResults);
}