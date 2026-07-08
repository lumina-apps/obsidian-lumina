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

	for (const file of files) {
		// 제외된 경로는 검색 대상에서 제외
		if (!pathGuard.isAgentPathAllowed(file.path, ctx.plugin)) {
			continue;
		}

		if (tags.length > 0) {
			const cache = ctx.plugin.app.metadataCache.getFileCache(file);
			const fileTags = obsidian.getAllTags(cache || {}) || [];
			// check if all requested tags exist in fileTags
			const hasAllTags = tags.every(tag => {
				const searchTag = tag.startsWith('#') ? tag : '#' + tag;
				return fileTags.includes(searchTag);
			});
			if (!hasAllTags) continue;
		}
		const content = await ctx.plugin.app.vault.read(file);
		const lowerContent = content.toLowerCase();
		const index = lowerContent.indexOf(query);
		if (index !== -1) {
			const start = Math.max(0, index - ctx.snippetLen);
			const end = Math.min(content.length, index + query.length + ctx.snippetLen);
			let snippet = content.substring(start, end).replace(/\n/g, ' ');
			if (start > 0) snippet = '...' + snippet;
			if (end < content.length) snippet = snippet + '...';

			results.push(`[${file.path}]\n${snippet}\n`);
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