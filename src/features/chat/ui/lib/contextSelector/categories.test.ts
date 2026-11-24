import { describe, it, expect } from "vitest";
import type { TFile } from "obsidian";
import { buildCategories, type CategoryContext } from "./categories";

function createMockFile(path: string, extension: string, parentPath: string): TFile {
	return {
		path,
		extension,
		basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path,
		name: path.split("/").pop() ?? path,
		parent: { path: parentPath },
	} as unknown as TFile;
}

describe("buildCategories", () => {
	const getLabel = (key: string) => key;

	it("루트 폴더(/)에만 파일이 있고 하위 폴더가 없으면 folder 카테고리를 숨기고 file만 표시한다", () => {
		const ctx: CategoryContext = {
			hasActiveFile: false,
			hasSelection: false,
			tagsInfo: null,
			files: [createMockFile("Note.md", "md", "/")],
		};

		const ids = buildCategories(ctx, getLabel).map((c) => c.id);

		expect(ids).not.toContain("folder");
		expect(ids).toEqual(["file", "url"]);
	});

	it("볼트에 파일이 전혀 없으면 folder와 file 카테고리를 모두 숨긴다", () => {
		const ctx: CategoryContext = {
			hasActiveFile: false,
			hasSelection: false,
			tagsInfo: null,
			files: [],
		};

		const ids = buildCategories(ctx, getLabel).map((c) => c.id);

		expect(ids).toEqual(["url"]);
	});

	it("하위 폴더가 있는 파일이 존재하면 folder 카테고리를 표시한다", () => {
		const ctx: CategoryContext = {
			hasActiveFile: true,
			hasSelection: false,
			tagsInfo: { "#tag": 1 },
			files: [createMockFile("notes/Daily.md", "md", "notes")],
		};

		const ids = buildCategories(ctx, getLabel).map((c) => c.id);

		expect(ids).toEqual(["active_note", "folder", "file", "tag", "url"]);
	});
});
