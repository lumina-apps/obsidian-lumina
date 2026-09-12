import { TFile, normalizePath } from 'obsidian';
import * as obsidian from 'obsidian';
import { t } from '../../../../shared/locales/helpers';
import { applyReadLimit, getStringArg, getStringOptArg } from '../handlerHelpers';
import type { ToolArguments, ToolHandlerContext, ToolResult } from '../toolTypes';
import type { PathGuard } from '../pathGuard';

export const searchNotesHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const query = getStringArg(args, 'query').toLowerCase();
	const tags = (args.tags as string[]) || [];
	const files = ctx.plugin.app.vault.getMarkdownFiles();
	const results: string[] = [];

	if (!query && tags.length === 0) {
		return { isError: true, content: [{ type: 'text', text: 'Either query or tags must be provided.' }] };
	}

	for (const file of files) {
		// 제외된 경로는 검색 대상에서 제외
		if (!pathGuard.isAgentPathAllowed(file.path, ctx.plugin)) {
			continue;
		}

		if (tags.length > 0) {
			const cache = ctx.plugin.app.metadataCache.getFileCache(file);
			const allTags = obsidian.getAllTags(cache || {}) || [];
			const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
			const fmTags: unknown = frontmatter?.tags ?? frontmatter?.tag;
			const normalizedFm: string[] = fmTags
				? (Array.isArray(fmTags) ? (fmTags as unknown[]) : [fmTags]).map(t => String(t).startsWith('#') ? String(t) : '#' + String(t))
				: [];
			const fileTags = Array.from(new Set([...allTags, ...normalizedFm]));

			// check if all requested tags exist in fileTags
			const hasAllTags = tags.every(tag => {
				const searchTag = tag.startsWith('#') ? tag : '#' + tag;
				return fileTags.includes(searchTag);
			});
			if (!hasAllTags) continue;
		}

		const content = await ctx.plugin.app.vault.read(file);
		const lowerContent = content.toLowerCase();

		const fileSnippets: string[] = [];
		if (query) {
			let pos = 0;
			const maxSnippetsPerFile = 3;
			while (pos < lowerContent.length && fileSnippets.length < maxSnippetsPerFile) {
				const index = lowerContent.indexOf(query, pos);
				if (index === -1) break;

				const start = Math.max(0, index - ctx.snippetLen);
				const end = Math.min(content.length, index + query.length + ctx.snippetLen);
				let snippet = content.substring(start, end).replace(/\n/g, ' ');
				if (start > 0) snippet = '...' + snippet;
				if (end < content.length) snippet = snippet + '...';

				fileSnippets.push(snippet);
				pos = Math.max(index + query.length, end);
			}
		} else {
			// query 없이 tags만 매칭된 경우 파일 서두 스니펫 제공
			const previewLen = ctx.snippetLen * 2;
			let snippet = content.substring(0, previewLen).replace(/\n/g, ' ');
			if (content.length > previewLen) snippet += '...';
			fileSnippets.push(snippet);
		}

		if (fileSnippets.length > 0) {
			results.push(`[${file.path}]\n${fileSnippets.join('\n')}\n`);
			if (results.length >= ctx.maxResults) break;
		}
	}
	return {
		content: [
			{
				type: 'text',
				text:
					results.length > 0
						? t('mcpServerTools.search_notes.foundPrefix', { max: ctx.maxResults }) + results.join('\n')
						: t('mcpServerTools.search_notes.noResults'),
			},
		],
	};
};

export const listNotesHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const folderPath = getStringOptArg(args, 'path');
	const allFiles: TFile[] = ctx.plugin.app.vault.getMarkdownFiles();

	let filteredFiles: TFile[] = allFiles;
	let displayPath = '';

	if (folderPath) {
		const normalized = normalizePath(folderPath);
		displayPath = ` in ${normalized}`;
		filteredFiles = allFiles.filter((f: TFile) => {
			const filePath = f.path;
			return filePath === normalized || filePath.startsWith(normalized + '/');
		});
	}

	// 제외된 경로 필터링
	filteredFiles = filteredFiles.filter((f: TFile) => pathGuard.isAgentPathAllowed(f.path, ctx.plugin));

	if (filteredFiles.length === 0) {
		return { content: [{ type: 'text', text: t('mcpServerTools.list_notes.noNotes', { path: displayPath }) }] };
	}

	const fileList = filteredFiles
		.map((f: TFile) => f.path)
		.sort()
		.join('\n');
	const result = t('mcpServerTools.list_notes.listPrefix', { path: displayPath, count: filteredFiles.length }) + fileList;
	return { content: [{ type: 'text', text: applyReadLimit(result, ctx.limitRead) }] };
};

export const listTagsHandler = async (
	_args: ToolArguments,
	ctx: ToolHandlerContext,
	_pathGuard: PathGuard,
): Promise<ToolResult> => {
	const tagsRecord = (ctx.plugin.app.metadataCache as unknown as { getTags(): Record<string, number> }).getTags();
	// tagsRecord is Record<string, number> where key is tag like '#foo' and value is count
	const tagsList = Object.entries(tagsRecord).map(([tag, count]) => `${tag} (${count})`);
	
	if (tagsList.length === 0) {
		return { content: [{ type: 'text', text: 'No tags found in the vault.' }] };
	}

	return { content: [{ type: 'text', text: `Tags in vault:\n${tagsList.join('\n')}` }] };
};

const BINARY_EXTENSIONS = new Set([
	'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'pdf',
	'mp3', 'mp4', 'wav', 'ogg', 'zip', 'tar', 'gz', 'wasm', 'ico'
]);

function globToRegex(pattern: string): RegExp {
	let escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
	escaped = escaped.replace(/\*\*/g, '.*');
	escaped = escaped.replace(/(?<!\.)\*/g, '[^/]*');
	escaped = escaped.replace(/\?/g, '[^/]');
	return new RegExp(`^${escaped}$`, 'i');
}

export const grepSearchHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const rawQuery = getStringArg(args, 'query');
	if (!rawQuery) {
		return { isError: true, content: [{ type: 'text', text: 'query parameter is required.' }] };
	}

	const isRegex = Boolean(args.isRegex);
	const caseInsensitive = args.caseInsensitive !== false;
	const folderScope = getStringOptArg(args, 'path');
	const maxResults = typeof args.maxResults === 'number' && args.maxResults > 0 ? Math.min(args.maxResults, 200) : 50;

	let matcher: RegExp;
	try {
		if (isRegex) {
			matcher = new RegExp(rawQuery, caseInsensitive ? 'i' : '');
		} else {
			const escaped = rawQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			matcher = new RegExp(escaped, caseInsensitive ? 'i' : '');
		}
	} catch (err) {
		return { isError: true, content: [{ type: 'text', text: `Invalid regex pattern: ${err instanceof Error ? err.message : String(err)}` }] };
	}

	const allFiles = ctx.plugin.app.vault.getFiles();
	let targetFiles = allFiles;
	if (folderScope) {
		const normalized = normalizePath(folderScope);
		targetFiles = allFiles.filter((f) => f.path === normalized || f.path.startsWith(normalized + '/'));
	}

	targetFiles = targetFiles.filter((f) => pathGuard.isAgentPathAllowed(f.path, ctx.plugin));

	const matches: string[] = [];
	for (const file of targetFiles) {
		const ext = file.extension?.toLowerCase() ?? '';
		if (BINARY_EXTENSIONS.has(ext)) continue;

		try {
			const content = await ctx.plugin.app.vault.read(file);
			const lines = content.split('\n');
			for (let i = 0; i < lines.length; i++) {
				if (matcher.test(lines[i])) {
					matches.push(`${file.path}:${i + 1}: ${lines[i].trimEnd()}`);
					if (matches.length >= maxResults) break;
				}
			}
		} catch {
			// 읽기 불가 파일 무시
		}
		if (matches.length >= maxResults) break;
	}

	if (matches.length === 0) {
		return { content: [{ type: 'text', text: `No matches found for query: "${rawQuery}"` }] };
	}

	const resultText = `Found ${matches.length} matches (capped at ${maxResults}):\n\n` + matches.join('\n');
	return { content: [{ type: 'text', text: applyReadLimit(resultText, ctx.limitRead) }] };
};

export const globFilesHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const rawPattern = getStringArg(args, 'pattern');
	if (!rawPattern) {
		return { isError: true, content: [{ type: 'text', text: 'pattern parameter is required.' }] };
	}
	const pattern = rawPattern.replace(/\\/g, '/');

	const folderScope = getStringOptArg(args, 'path');
	const maxResults = typeof args.maxResults === 'number' && args.maxResults > 0 ? Math.min(args.maxResults, 500) : 100;

	const allFiles = ctx.plugin.app.vault.getFiles();
	let targetFiles = allFiles;
	if (folderScope) {
		const normalized = normalizePath(folderScope);
		targetFiles = allFiles.filter((f) => f.path === normalized || f.path.startsWith(normalized + '/'));
	}

	targetFiles = targetFiles.filter((f) => pathGuard.isAgentPathAllowed(f.path, ctx.plugin));

	const regex = globToRegex(pattern);
	const matchedFiles: string[] = [];

	for (const file of targetFiles) {
		if (regex.test(file.path) || (folderScope && regex.test(file.path.replace(normalizePath(folderScope) + '/', '')))) {
			matchedFiles.push(file.path);
			if (matchedFiles.length >= maxResults) break;
		}
	}

	matchedFiles.sort();

	if (matchedFiles.length === 0) {
		return { content: [{ type: 'text', text: `No files found matching pattern: "${pattern}"` }] };
	}

	const resultText = `Found ${matchedFiles.length} files matching "${pattern}" (max: ${maxResults}):\n\n` + matchedFiles.join('\n');
	return { content: [{ type: 'text', text: applyReadLimit(resultText, ctx.limitRead) }] };
};