import { Notice, TFile } from 'obsidian';
import type { ToolArguments, ToolResult, ToolHandlerContext } from '../toolTypes';
import type { PathGuard } from '../pathGuard';
import { sanitizeFilePath } from '../../../../shared/utils/fileUtils';
import { blockIfPathNotAllowed } from '../handlerHelpers';

export async function showNoticeHandler(args: ToolArguments): Promise<ToolResult> {
	const message = args.message as string;
	const duration = args.duration as number | undefined;

	if (!message) {
		return {
			isError: true,
			content: [{ type: 'text', text: 'Message for notice is missing.' }],
		};
	}

	new Notice(message, duration);

	return {
		content: [{ type: 'text', text: 'Notice shown.' }],
	};
}

export async function openNoteHandler(
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> {
	const rawPath = typeof args.path === 'string' ? args.path : '';
	const path = sanitizeFilePath(rawPath);
	if (!path) {
		return { isError: true, content: [{ type: 'text', text: 'path parameter is required.' }] };
	}

	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: `File not found: ${path}` }] };
	}

	const newTab = Boolean(args.newTab);
	const leaf = ctx.plugin.app.workspace.getLeaf(newTab ? 'tab' : false);
	await leaf.openFile(file);
	ctx.plugin.app.workspace.setActiveLeaf(leaf, { focus: true });

	return {
		content: [{ type: 'text', text: `Opened note "${path}" in editor.` }],
	};
}
