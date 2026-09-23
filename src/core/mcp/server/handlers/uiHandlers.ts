import { Notice, TFile } from 'obsidian';
import type { ToolArguments, ToolResult, ToolHandlerContext } from '../toolTypes';
import type { PathGuard } from '../pathGuard';
import { sanitizeFilePath } from '../../../../shared/utils/fileUtils';
import { blockIfPathNotAllowed } from '../handlerHelpers';

export async function showNoticeHandler(args: ToolArguments): Promise<ToolResult> {
	const message = typeof args.message === 'string' ? args.message : String(args.message ?? '');
	const duration = typeof args.duration === 'number' && args.duration > 0 ? args.duration : undefined;

	if (!message.trim()) {
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
	if (!rawPath.trim()) {
		return { isError: true, content: [{ type: 'text', text: 'path parameter is required.' }] };
	}

	let path = sanitizeFilePath(rawPath, false, ctx.plugin.app);
	let file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile) && !path.toLowerCase().endsWith('.md')) {
		const mdPath = `${path}.md`;
		const mdFile = ctx.plugin.app.vault.getAbstractFileByPath(mdPath);
		if (mdFile instanceof TFile) {
			path = mdPath;
			file = mdFile;
		}
	}

	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

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
