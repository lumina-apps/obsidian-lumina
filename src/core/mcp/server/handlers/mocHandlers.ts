import * as obsidian from 'obsidian';
import { TFile, normalizePath } from 'obsidian';
import { sanitizeFilePath } from '../../../../shared/utils/fileUtils';
import { getStringArg, getStringOptArg } from '../handlerHelpers';
import type { ToolArguments, ToolHandlerContext, ToolResult } from '../toolTypes';
import type { PathGuard } from '../pathGuard';
import { getValidatedPathAndFile, safeCreateFile, safeModifyFile } from './utils/writeHandlerUtils';
import { buildMocContent, type MocFileEntry, type MocGroupBy } from './utils/mocUtils';

export const generateMocHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	// ── 1. 인자 파싱 ────────────────────────────────────────────────────────────
	const title = getStringArg(args, 'title');
	if (!title) {
		return { isError: true, content: [{ type: 'text', text: 'title is required.' }] };
	}

	let rawOutputPath = getStringArg(args, 'outputPath');
	if (!rawOutputPath) {
		return { isError: true, content: [{ type: 'text', text: 'outputPath is required.' }] };
	}
	if (!rawOutputPath.endsWith('.md')) {
		rawOutputPath += '.md';
	}
	const outputPath = sanitizeFilePath(normalizePath(rawOutputPath));

	const folderScope = getStringOptArg(args, 'folder');
	const tagsRaw = Array.isArray(args.tags) ? (args.tags as string[]) : [];
	const filesRaw = Array.isArray(args.files) ? (args.files as string[]) : [];
	const groupBy: MocGroupBy =
		typeof args.groupBy === 'string' &&
		['folder', 'tag', 'none'].includes(args.groupBy)
			? (args.groupBy as MocGroupBy)
			: 'none';
	const overwrite = typeof args.overwrite === 'boolean' ? args.overwrite : false;

	// scope 검증
	if (!folderScope && tagsRaw.length === 0 && filesRaw.length === 0) {
		return {
			isError: true,
			content: [
				{
					type: 'text',
					text: 'At least one of folder, tags, or files must be provided.',
				},
			],
		};
	}

	// ── 2. 노트 수집 ────────────────────────────────────────────────────────────
	const allMarkdownFiles = ctx.plugin.app.vault.getMarkdownFiles();

	// 전체 vault basename 목록 (wikilink 중복 판별용)
	const allBasenames = allMarkdownFiles.map(f => f.basename);

	let candidateFiles: TFile[] = [];

	if (filesRaw.length > 0) {
		// 명시적 파일 목록
		for (const rawPath of filesRaw) {
			const p = sanitizeFilePath(rawPath.endsWith('.md') ? rawPath : rawPath + '.md');
			const f = ctx.plugin.app.vault.getAbstractFileByPath(p);
			if (f instanceof TFile) {
				candidateFiles.push(f);
			}
		}
	} else {
		// folder 또는 tags 기반 수집
		candidateFiles = allMarkdownFiles.filter(f => {
			// 폴더 필터
			if (folderScope) {
				const normalized = normalizePath(folderScope);
				const inFolder =
					f.path === normalized ||
					f.path.startsWith(normalized + '/');
				if (!inFolder) return false;
			}

			// 태그 필터
			if (tagsRaw.length > 0) {
				const cache = ctx.plugin.app.metadataCache.getFileCache(f);
				const fileTags = obsidian.getAllTags(cache || {}) || [];
				const hasAllTags = tagsRaw.every(tag => {
					const searchTag = tag.startsWith('#') ? tag : '#' + tag;
					return fileTags.includes(searchTag);
				});
				if (!hasAllTags) return false;
			}

			return true;
		});
	}

	// pathGuard 필터링 + 출력 파일 자신 제외
	candidateFiles = candidateFiles.filter(
		f =>
			f.path !== outputPath &&
			pathGuard.isAgentPathAllowed(f.path, ctx.plugin),
	);

	// ── 3. MocFileEntry 빌드 ────────────────────────────────────────────────────
	const mocEntries: MocFileEntry[] = candidateFiles.map(f => {
		const cache = ctx.plugin.app.metadataCache.getFileCache(f);
		const tags = obsidian.getAllTags(cache || {}) || [];
		return {
			path: f.path,
			basename: f.basename,
			firstTag: tags[0] ?? '',
		};
	});

	// basename 알파벳 정렬
	mocEntries.sort((a, b) => a.basename.localeCompare(b.basename));

	// ── 4. MOC 마크다운 생성 ────────────────────────────────────────────────────
	const newContent = buildMocContent(title, mocEntries, groupBy, allBasenames);

	// ── 5. 파일 쓰기 ────────────────────────────────────────────────────────────
	const adjustedArgs = { ...args, path: outputPath };
	const { path, file, errorResult } = getValidatedPathAndFile(
		adjustedArgs,
		ctx,
		pathGuard,
		'path',
		false,
	);
	if (errorResult) return errorResult;

	if (file) {
		if (!overwrite) {
			return {
				isError: true,
				content: [
					{
						type: 'text',
						text: `File already exists at ${path} and overwrite is false.`,
					},
				],
			};
		}
		const currentContent = await ctx.plugin.app.vault.read(file);
		return safeModifyFile(
			path,
			file,
			currentContent,
			newContent,
			`Successfully updated MOC at ${path} (${mocEntries.length} notes)`,
			ctx,
			pathGuard,
		);
	} else {
		return safeCreateFile(
			path,
			newContent,
			`Successfully created MOC at ${path} (${mocEntries.length} notes)`,
			ctx,
			pathGuard,
		);
	}
};
