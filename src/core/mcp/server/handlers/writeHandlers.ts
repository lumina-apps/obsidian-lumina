import { TFile } from 'obsidian';
import { t } from '../../../../shared/locales/helpers';
import { sanitizeFilePath } from '../../../../shared/utils/fileUtils';
import { MCP_MAX_FILE_LENGTH } from '../../../../shared/utils/mcpUtils';
import { getStringArg, blockIfPathNotAllowed } from '../handlerHelpers';
import type { ToolArguments, ToolHandlerContext, ToolResult } from '../toolTypes';
import type { PathGuard } from '../pathGuard';

export const createNoteHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	let rawPath = getStringArg(args, 'path');
	const rawContent = getStringArg(args, 'content');

	if (rawContent.length > ctx.limitAppend) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.create_note.tooLong', { limit: ctx.limitAppend }) }] };
	}

	// 파일명 특수문자 정제 및 .md 확장 보장
	rawPath = sanitizeFilePath(rawPath);

	const blocked = blockIfPathNotAllowed(rawPath, ctx, pathGuard);
	if (blocked) return blocked;

	const existingFile = ctx.plugin.app.vault.getAbstractFileByPath(rawPath);
	if (existingFile) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.create_note.alreadyExists', { path: rawPath }) }] };
	}

	// 부모 폴더가 없으면 에러
	const parentPath = rawPath.substring(0, rawPath.lastIndexOf('/'));
	if (parentPath && !ctx.plugin.app.vault.getAbstractFileByPath(parentPath)) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.create_note.parentFolderNotFound', { parentPath }) }] };
	}

	await pathGuard.lock(rawPath, async () => {
		await ctx.plugin.app.vault.create(rawPath, rawContent);
	});
	return { content: [{ type: 'text', text: t('mcpServerTools.create_note.success', { path: rawPath }) }] };
};

export const appendToNoteHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const path = sanitizeFilePath(getStringArg(args, 'path'));
	const newContent = getStringArg(args, 'content');

	if (newContent.length > ctx.limitAppend) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_note.tooLong', { limit: ctx.limitAppend }) }] };
	}

	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_note.notFound', { path }) }] };
	}

	return await pathGuard.lock(path, async () => {
		const currentContent = await ctx.plugin.app.vault.read(file);
		if (currentContent.length + newContent.length > MCP_MAX_FILE_LENGTH) {
			return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_note.maxLengthExceeded') }] };
		}

		await ctx.plugin.app.vault.modify(file, currentContent + '\n' + newContent);
		return { content: [{ type: 'text', text: t('mcpServerTools.append_to_note.success', { path }) }] };
	});
};

export const appendToDailyNoteHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const today = new Date().toISOString().split('T')[0];
	const path = `${today}.md`;
	const newContent = getStringArg(args, 'content');

	if (newContent.length > ctx.limitAppend) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_daily_note.tooLong', { limit: ctx.limitAppend }) }] };
	}

	// 데일리 노트 추가는 항상 허용
	return await pathGuard.lock(path, async () => {
		const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			const currentContent = await ctx.plugin.app.vault.read(file);
			if (currentContent.length + newContent.length > MCP_MAX_FILE_LENGTH) {
				return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_daily_note.maxLengthExceeded') }] };
			}
			await ctx.plugin.app.vault.modify(file, currentContent + '\n' + newContent);
			return { content: [{ type: 'text', text: t('mcpServerTools.append_to_daily_note.successAppend', { path }) }] };
		} else {
			await ctx.plugin.app.vault.create(path, newContent);
			return { content: [{ type: 'text', text: t('mcpServerTools.append_to_daily_note.successCreate', { path }) }] };
		}
	});
};