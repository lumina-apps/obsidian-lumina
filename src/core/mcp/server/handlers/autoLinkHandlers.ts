import { TFile } from 'obsidian';
import type { ToolArguments, ToolHandlerContext, ToolResult } from '../toolTypes';
import type { PathGuard } from '../pathGuard';
import { calculateAutoLinks } from './utils/autoLinker';
import { sanitizeFilePath } from '../../../../shared/utils/fileUtils';
import { getStringArg, blockIfPathNotAllowed } from '../handlerHelpers';
import { safeModifyFile } from './utils/writeHandlerUtils';
import { t } from '../../../../shared/locales/helpers';

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
			content: [{ type: 'text', text: t('uiMessages.autoLinkNoChanges') }],
		};
	}

	return safeModifyFile(
		path,
		file,
		currentContent,
		newContent,
		t('uiMessages.autoLinkSuccess', { count: linksAdded }),
		ctx,
		pathGuard,
	);
}
