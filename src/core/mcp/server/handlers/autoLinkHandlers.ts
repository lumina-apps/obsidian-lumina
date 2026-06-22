import { TFile, MarkdownView } from 'obsidian';
import type { ToolArguments, ToolHandlerContext, ToolResult } from '../toolTypes';
import type { PathGuard } from '../pathGuard';
import { processAutoLink } from './utils/autoLinker';
import { sanitizeFilePath } from '../../../../shared/utils/fileUtils';
import { getStringArg, blockIfPathNotAllowed } from '../handlerHelpers';

export async function autoLinkNoteHandler(
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> {
	const path = sanitizeFilePath(getStringArg(args, 'path'));
	if (!path) {
		return {
			isError: true,
			content: [{ type: 'text', text: 'Path argument is required.' }],
		};
	}

	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return {
			isError: true,
			content: [{ type: 'text', text: `File not found: ${path}` }],
		};
	}

	const activeView = ctx.plugin.app.workspace.getActiveViewOfType(MarkdownView);
	const editor = activeView?.file?.path === file.path ? activeView.editor : undefined;

	const result = await processAutoLink(ctx.plugin.app, file, editor);

	if (!result.success) {
		return {
			isError: true,
			content: [{ type: 'text', text: result.message }],
		};
	}

	return {
		content: [
			{
				type: 'text',
				text: result.message,
			},
		],
	};
}
