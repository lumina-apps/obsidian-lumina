import { TFile } from 'obsidian';
import type { ToolArguments, ToolHandlerContext, ToolResult } from '../toolTypes';
import type { PathGuard } from '../pathGuard';
import { calculateAutoLinks } from './utils/autoLinker';
import { sanitizeFilePath } from '../../../../shared/utils/fileUtils';
import { getStringArg, blockIfPathNotAllowed } from '../handlerHelpers';
import { safeModifyFile } from './utils/writeHandlerUtils';

export async function autoLinkNoteHandler(
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> {
	const rawPath = getStringArg(args, 'path');
	if (!rawPath.trim()) {
		return {
			isError: true,
			content: [{ type: 'text', text: 'Path argument is required.' }],
		};
	}
	const path = sanitizeFilePath(rawPath, true, ctx.plugin.app);

	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return {
			isError: true,
			content: [{ type: 'text', text: `File not found: ${path}` }],
		};
	}

	const currentContent = await ctx.plugin.app.vault.read(file);
	const { newContent, linksAdded } = calculateAutoLinks(
		ctx.plugin.app,
		file,
		currentContent,
		(p) => pathGuard.isAgentPathAllowed(p, ctx.plugin),
	);

	if (linksAdded === 0) {
		return {
			content: [{ type: 'text', text: '추가할 링크가 없습니다.' }],
		};
	}

	return safeModifyFile(
		path,
		file,
		currentContent,
		newContent,
		`총 ${linksAdded}개의 백링크가 생성되었습니다.`,
		ctx,
		pathGuard,
	);
}
