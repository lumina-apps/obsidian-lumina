import { TFile } from 'obsidian';
import { t } from '../../../../shared/locales/helpers';
import { sanitizeFilePath, ensureFolderExists } from '../../../../shared/utils/fileUtils';
import { MCP_MAX_FILE_LENGTH } from '../../../../shared/utils/mcpUtils';
import { getStringArg, blockIfPathNotAllowed } from '../handlerHelpers';
import type { ToolArguments, ToolHandlerContext, ToolResult } from '../toolTypes';
import type { PathGuard } from '../pathGuard';
import { createBackup } from '../../../../features/backup/backupManager';
import { approvalManager } from '../../../../features/chat/utils/approvalManager';

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

	// 부모 폴더 자동 생성을 위해 에러 처리를 제거하고 아래에서 ensureFolderExists를 호출합니다.

	const approved = await approvalManager.requestActionApproval('create_note', rawPath, { content: rawContent });
	if (!approved) {
		return { isError: true, content: [{ type: 'text', text: 'User explicitly rejected the file creation. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.' }] };
	}

	await pathGuard.lock(rawPath, async () => {
		await ensureFolderExists(ctx.plugin.app, rawPath);
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

	let currentContent = await ctx.plugin.app.vault.read(file);
	let proposedContent = currentContent + '\n' + newContent;
	
	if (proposedContent.length > MCP_MAX_FILE_LENGTH) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_note.maxLengthExceeded') }] };
	}

	const result = await approvalManager.requestApproval(path, currentContent, proposedContent);
	if (!result.approved) {
		return { isError: true, content: [{ type: 'text', text: 'User explicitly rejected the change. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.' }] };
	}

	return await pathGuard.lock(path, async () => {
		const contentNow = await ctx.plugin.app.vault.read(file);
		if (contentNow !== currentContent) {
			return { isError: true, content: [{ type: 'text', text: 'File was modified while waiting for approval. Please try again.' }] };
		}
		await createBackup(ctx.plugin.app, path);
		await ctx.plugin.app.vault.modify(file, result.content);
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
	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) {
		let currentContent = await ctx.plugin.app.vault.read(file);
		let proposedContent = currentContent + '\n' + newContent;
		if (proposedContent.length > MCP_MAX_FILE_LENGTH) {
			return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_daily_note.maxLengthExceeded') }] };
		}
		
		const result = await approvalManager.requestApproval(path, currentContent, proposedContent);
		if (!result.approved) {
			return { isError: true, content: [{ type: 'text', text: 'User explicitly rejected the change. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.' }] };
		}

		return await pathGuard.lock(path, async () => {
			const contentNow = await ctx.plugin.app.vault.read(file);
			if (contentNow !== currentContent) {
				return { isError: true, content: [{ type: 'text', text: 'File was modified while waiting for approval. Please try again.' }] };
			}
			await createBackup(ctx.plugin.app, path);
			await ctx.plugin.app.vault.modify(file, result.content);
			return { content: [{ type: 'text', text: t('mcpServerTools.append_to_daily_note.successAppend', { path }) }] };
		});
	} else {
		const approved = await approvalManager.requestActionApproval('create_note', path, { content: newContent });
		if (!approved) {
			return { isError: true, content: [{ type: 'text', text: 'User explicitly rejected the change. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.' }] };
		}
		return await pathGuard.lock(path, async () => {
			await ensureFolderExists(ctx.plugin.app, path);
			await ctx.plugin.app.vault.create(path, newContent);
			return { content: [{ type: 'text', text: t('mcpServerTools.append_to_daily_note.successCreate', { path }) }] };
		});
	}
};

export const replaceNoteHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const path = sanitizeFilePath(getStringArg(args, 'path'));
	const newContent = getStringArg(args, 'content');

	if (newContent.length > MCP_MAX_FILE_LENGTH) {
		return { isError: true, content: [{ type: 'text', text: 'Content exceeds maximum allowed length.' }] };
	}

	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: `File not found: ${path}` }] };
	}

	const currentContent = await ctx.plugin.app.vault.read(file);
	
	const result = await approvalManager.requestApproval(path, currentContent, newContent);
	if (!result.approved) {
		return { isError: true, content: [{ type: 'text', text: 'User explicitly rejected the change. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.' }] };
	}

	return await pathGuard.lock(path, async () => {
		const contentNow = await ctx.plugin.app.vault.read(file);
		if (contentNow !== currentContent) {
			return { isError: true, content: [{ type: 'text', text: 'File was modified while waiting for approval. Please try again.' }] };
		}
		await createBackup(ctx.plugin.app, path);
		await ctx.plugin.app.vault.modify(file, result.content);
		return { content: [{ type: 'text', text: `Successfully replaced content in ${path}` }] };
	});
};

export const patchNoteHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const path = sanitizeFilePath(getStringArg(args, 'path'));
	const target = getStringArg(args, 'target');
	const replacement = getStringArg(args, 'replacement');

	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: `File not found: ${path}` }] };
	}

	const currentContent = await ctx.plugin.app.vault.read(file);
	if (!currentContent.includes(target)) {
		return { isError: true, content: [{ type: 'text', text: `Target text not found in ${path}. Ensure whitespace matches exactly.` }] };
	}

	const proposedContent = currentContent.replace(target, replacement);

	const result = await approvalManager.requestApproval(path, currentContent, proposedContent);
	if (!result.approved) {
		return { isError: true, content: [{ type: 'text', text: 'User explicitly rejected the change. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.' }] };
	}

	return await pathGuard.lock(path, async () => {
		const contentNow = await ctx.plugin.app.vault.read(file);
		if (contentNow !== currentContent) {
			return { isError: true, content: [{ type: 'text', text: 'File was modified while waiting for approval. Please try again.' }] };
		}
		await createBackup(ctx.plugin.app, path);
		await ctx.plugin.app.vault.modify(file, result.content);
		return { content: [{ type: 'text', text: `Successfully patched ${path}` }] };
	});
};

export const deleteNoteHandler = async (
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

	const approved = await approvalManager.requestActionApproval('delete', path);
	if (!approved) {
		return { isError: true, content: [{ type: 'text', text: 'User explicitly rejected deletion. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.' }] };
	}

	return await pathGuard.lock(path, async () => {
		await createBackup(ctx.plugin.app, path);
		await ctx.plugin.app.fileManager.trashFile(file);
		return { content: [{ type: 'text', text: `Successfully deleted ${path}` }] };
	});
};

export const moveNoteHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const sourcePath = sanitizeFilePath(getStringArg(args, 'sourcePath'));
	const targetPath = sanitizeFilePath(getStringArg(args, 'targetPath'));

	const blockedSrc = blockIfPathNotAllowed(sourcePath, ctx, pathGuard);
	if (blockedSrc) return blockedSrc;
	const blockedTgt = blockIfPathNotAllowed(targetPath, ctx, pathGuard);
	if (blockedTgt) return blockedTgt;

	const file = ctx.plugin.app.vault.getAbstractFileByPath(sourcePath);
	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: `Source file not found: ${sourcePath}` }] };
	}

	const approved = await approvalManager.requestActionApproval('rename', sourcePath, { targetPath });
	if (!approved) {
		return { isError: true, content: [{ type: 'text', text: 'User explicitly rejected move/rename. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.' }] };
	}

	return await pathGuard.lock(sourcePath, async () => {
		// Also lock targetPath ideally, but Obsidian API handles conflicts
		await createBackup(ctx.plugin.app, sourcePath);
		await ensureFolderExists(ctx.plugin.app, targetPath);
		await ctx.plugin.app.fileManager.renameFile(file, targetPath);
		return { content: [{ type: 'text', text: `Successfully moved to ${targetPath}` }] };
	});
};

export const updateFrontmatterHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const path = sanitizeFilePath(getStringArg(args, 'path'));
	const key = getStringArg(args, 'key');
	const value = args.value;

	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: `File not found: ${path}` }] };
	}

	const approved = await approvalManager.requestActionApproval('frontmatter', path, { key, value });
	if (!approved) {
		return { isError: true, content: [{ type: 'text', text: 'User explicitly rejected frontmatter update. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.' }] };
	}

	return await pathGuard.lock(path, async () => {
		await createBackup(ctx.plugin.app, path);
		await ctx.plugin.app.fileManager.processFrontMatter(file, (fm) => {
			const record = fm as Record<string, unknown>;
			record[key] = value;
		});
		return { content: [{ type: 'text', text: `Successfully updated frontmatter key ${key} in ${path}` }] };
	});
};

export const saveAttachmentHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const path = sanitizeFilePath(getStringArg(args, 'path'));
	const base64Data = getStringArg(args, 'base64Data');

	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	const existing = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (existing) {
		return { isError: true, content: [{ type: 'text', text: `File already exists at ${path}` }] };
	}

	const binaryString = window.atob(base64Data);
	const sizeBytes = binaryString.length;

	const approved = await approvalManager.requestActionApproval('attachment', path, { sizeBytes });
	if (!approved) {
		return { isError: true, content: [{ type: 'text', text: 'User explicitly rejected attachment saving. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.' }] };
	}

	const bytes = new Uint8Array(sizeBytes);
	for (let i = 0; i < sizeBytes; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}

	return await pathGuard.lock(path, async () => {
		await ensureFolderExists(ctx.plugin.app, path);
		await ctx.plugin.app.vault.createBinary(path, bytes.buffer);
		return { content: [{ type: 'text', text: `Successfully saved attachment to ${path}` }] };
	});
};