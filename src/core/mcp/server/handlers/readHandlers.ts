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