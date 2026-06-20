import { TFile } from 'obsidian';
import { t } from '../../../../shared/locales/helpers';
import { sanitizeFilePath } from '../../../../shared/utils/fileUtils';
import { applyReadLimit, getStringArg, blockIfPathNotAllowed } from '../handlerHelpers';
import type { ToolArguments, ToolHandlerContext, ToolResult } from '../toolTypes';
import type { PathGuard } from '../pathGuard';

export const readActiveNoteHandler = async (
	_args: ToolArguments,
	ctx: ToolHandlerContext,
	_pathGuard: PathGuard,
): Promise<ToolResult> => {
	const activeFile = ctx.plugin.app.workspace.getActiveFile();
	if (!activeFile) {
		return { content: [{ type: 'text', text: t('mcpServerTools.read_active_note.noActive') }] };
	}
	// 활성 노트는 항상 읽기 허용 (사용자가 직접 열어둔 파일)
	const content = await ctx.plugin.app.vault.read(activeFile);
	return { content: [{ type: 'text', text: `[${activeFile.path}]\n${applyReadLimit(content, ctx.limitRead)}` }] };
};

export const readNoteHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const path = sanitizeFilePath(getStringArg(args, 'path'));
	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.read_note.notFound', { path }) }] };
	}
	const content = await ctx.plugin.app.vault.read(file);
	return { content: [{ type: 'text', text: applyReadLimit(content, ctx.limitRead) }] };
};

export const readDailyNoteHandler = async (
	_args: ToolArguments,
	ctx: ToolHandlerContext,
	_pathGuard: PathGuard,
): Promise<ToolResult> => {
	const today = new Date().toISOString().split('T')[0];
	const path = `${today}.md`;
	// 데일리 노트 읽기는 항상 허용
	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.read_daily_note.notFound', { path }) }] };
	}
	const content = await ctx.plugin.app.vault.read(file);
	return { content: [{ type: 'text', text: applyReadLimit(content, ctx.limitRead) }] };
};

export const getBacklinksHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const path = sanitizeFilePath(getStringArg(args, 'path'));
	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	const resolvedLinks = ctx.plugin.app.metadataCache.resolvedLinks;
	const backlinks: string[] = [];

	for (const sourcePath in resolvedLinks) {
		if (resolvedLinks[sourcePath][path] !== undefined) {
			backlinks.push(sourcePath);
		}
	}

	if (backlinks.length === 0) {
		return { content: [{ type: 'text', text: `No backlinks found for ${path}` }] };
	}
	return { content: [{ type: 'text', text: `Backlinks for ${path}:\n${backlinks.join('\n')}` }] };
};

export const getNoteMetadataHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const path = sanitizeFilePath(getStringArg(args, 'path'));
	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: `File not found: ${path}` }] };
	}

	const cache = ctx.plugin.app.metadataCache.getFileCache(file);
	const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
	const tags = cache?.tags?.map(t => t.tag) || [];
	const aliases = (frontmatter?.aliases ?? frontmatter?.alias ?? []) as unknown;

	const metadata = {
		path: file.path,
		basename: file.basename,
		extension: file.extension,
		size: file.stat.size,
		ctime: file.stat.ctime,
		mtime: file.stat.mtime,
		tags,
		aliases,
		frontmatter
	};

	return { content: [{ type: 'text', text: JSON.stringify(metadata, null, 2) }] };
};

export const listAttachmentsHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const path = args.path ? sanitizeFilePath(args.path as string) : undefined;
	const allFiles = ctx.plugin.app.vault.getFiles();
	
	const isAttachment = (f: TFile) => !f.path.endsWith('.md') && !f.path.endsWith('.canvas');

	if (path) {
		const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
		if (blocked) return blocked;

		const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return { isError: true, content: [{ type: 'text', text: `File not found: ${path}` }] };
		}
		
		const resolvedLinks = ctx.plugin.app.metadataCache.resolvedLinks[path] || {};
		const attachments = Object.keys(resolvedLinks).filter(p => {
			const targetFile = ctx.plugin.app.vault.getAbstractFileByPath(p);
			return targetFile instanceof TFile && isAttachment(targetFile);
		});

		if (attachments.length === 0) {
			return { content: [{ type: 'text', text: `No attachments linked in ${path}` }] };
		}
		return { content: [{ type: 'text', text: `Attachments linked in ${path}:\n${attachments.join('\n')}` }] };
	} else {
		// List all attachments in vault
		const attachments = allFiles.filter(isAttachment).map(f => f.path);
		if (attachments.length === 0) {
			return { content: [{ type: 'text', text: 'No attachments found in the vault.' }] };
		}
		// limit output to prevent massive payload
		const result = attachments.join('\n');
		return { content: [{ type: 'text', text: `All attachments:\n${applyReadLimit(result, ctx.limitRead)}` }] };
	}
};