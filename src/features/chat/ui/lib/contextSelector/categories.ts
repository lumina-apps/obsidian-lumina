import type { TFile } from "obsidian";
import { MarkdownView } from "obsidian";
import type LuminaPlugin from "../../../../../main";
import type { ContextAttachment } from "../../../../../shared/types/chat.types";
import type { TranslationKeys } from "../../../../../shared/locales/locale.types";

export interface CategoryItem {
	id: string;
	icon: string;
	label: string;
	show: boolean;
	type: ContextAttachment["type"] | "category";
}

export interface CategoryContext {
	hasActiveFile: boolean;
	hasSelection: boolean;
	tagsInfo: Record<string, unknown> | null;
	files: TFile[];
}

/**
 * 볼트 내 파일 중 주어진 확장자를 가진 파일이 하나라도 있는지 확인합니다.
 */
export function hasExtension(files: TFile[], extension: string): boolean {
	return files.some((f) => f.extension === extension);
}

/**
 * 파일 목록에서 고유한 부모 폴더 경로를 수집합니다.
 */
export function collectFolderPaths(files: TFile[]): string[] {
	const folders = new Set<string>();
	for (const f of files) {
		if (f.parent && f.parent.path !== "/") {
			folders.add(f.parent.path);
		}
	}
	return Array.from(folders);
}

/**
 * 현재 활성 노트/선택 영역 존재 여부를 포함한 컨텍스트 정보를 생성합니다.
 */
interface MetadataCacheWithTags {
	getTags?: () => Record<string, unknown>;
}

interface EditorWithGetSelection {
	getSelection?: () => string;
}

export function buildCategoryContext(plugin: LuminaPlugin): CategoryContext {
	const activeFile = plugin.app.workspace.getActiveFile();
	const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
	const editor = activeView?.editor as EditorWithGetSelection | undefined;
	const selection = editor?.getSelection?.();
	// metadataCache.getTags()는 Obsidian API에 존재하지만 타입 정의에 누락되어 있습니다.
	const metadataCache = plugin.app.metadataCache as unknown as MetadataCacheWithTags;
	const tagsInfo = metadataCache.getTags?.() ?? null;
	const files = plugin.app.vault.getFiles();

	return {
		hasActiveFile: !!activeFile,
		hasSelection: !!selection,
		tagsInfo,
		files,
	};
}

/**
 * 사용 가능한 카테고리 목록을 생성합니다.
 */
export function buildCategories(
	ctx: CategoryContext,
	getLabel: (key: TranslationKeys) => string,
): CategoryItem[] {
	const cats: CategoryItem[] = [];

	// Active Note
	if (ctx.hasActiveFile) {
		cats.push({
			id: "active_note",
			icon: "file-edit",
			label: getLabel("settings.chat.context.categoryActiveNote"),
			show: true,
			type: "active_note",
		});
	}

	// Selected Text
	if (ctx.hasSelection) {
		cats.push({
			id: "selection",
			icon: "mouse-pointer-2",
			label: getLabel("settings.chat.context.categorySelection"),
			show: true,
			type: "selection",
		});
	}

	// Folder
	cats.push({
		id: "folder",
		icon: "folder",
		label: getLabel("settings.chat.context.categoryFolder"),
		show: true,
		type: "folder",
	});

	// File
	cats.push({
		id: "file",
		icon: "file-text",
		label: getLabel("settings.chat.context.categoryFile"),
		show: true,
		type: "file",
	});

	// Tag
	if (ctx.tagsInfo && Object.keys(ctx.tagsInfo).length > 0) {
		cats.push({
			id: "tag",
			icon: "hash",
			label: getLabel("settings.chat.context.categoryTag"),
			show: true,
			type: "tag",
		});
	}

	// Canvas
	if (hasExtension(ctx.files, "canvas")) {
		cats.push({
			id: "canvas",
			icon: "layout",
			label: getLabel("settings.chat.context.categoryCanvas"),
			show: true,
			type: "canvas",
		});
	}

	// URL
	cats.push({
		id: "url",
		icon: "globe",
		label: getLabel("settings.chat.context.categoryUrl"),
		show: true,
		type: "url",
	});

	return cats;
}

/**
 * 검색어로 카테고리 목록을 필터링합니다.
 */
export function filterCategories(
	categories: CategoryItem[],
	query: string,
): CategoryItem[] {
	const q = query.toLowerCase().trim();
	if (!q) return categories;
	return categories.filter((cat) => cat.label.toLowerCase().includes(q));
}

/**
 * 주어진 카테고리 ID가 즉시 선택(아이템 탐색 없이 바로 결과 반환) 대상인지 확인합니다.
 */
export function isImmediateCategory(id: string): boolean {
	return id === "active_note" || id === "selection";
}