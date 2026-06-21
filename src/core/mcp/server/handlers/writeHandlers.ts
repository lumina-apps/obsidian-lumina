import { TFile } from 'obsidian';
import { t } from '../../../../shared/locales/helpers';
import { ensureFolderExists } from '../../../../shared/utils/fileUtils';
import { MCP_MAX_FILE_LENGTH } from '../../../../shared/utils/mcpUtils';
import { getStringArg } from '../handlerHelpers';
import type { ToolArguments, ToolHandlerContext, ToolResult } from '../toolTypes';
import type { PathGuard } from '../pathGuard';
import {
	getRejectionResult,
	getValidatedPathAndFile,
	safeModifyFile,
	safeCreateFile,
	safeActionFile,
} from './utils/writeHandlerUtils';
import { approvalManager } from '../../../../features/chat/utils/approvalManager';

export const createNoteHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const rawContent = getStringArg(args, 'content');
	if (rawContent.length > ctx.limitAppend) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.create_note.tooLong', { limit: ctx.limitAppend }) }] };
	}

	const { path, file, errorResult } = getValidatedPathAndFile(args, ctx, pathGuard, 'path', false);
	if (errorResult) return errorResult;

	if (file) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.create_note.alreadyExists', { path }) }] };
	}

	return safeCreateFile(path, rawContent, t('mcpServerTools.create_note.success', { path }), ctx, pathGuard);
};

export const appendToNoteHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const newContent = getStringArg(args, 'content');
	if (newContent.length > ctx.limitAppend) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_note.tooLong', { limit: ctx.limitAppend }) }] };
	}

	const { path, file, errorResult } = getValidatedPathAndFile(args, ctx, pathGuard);
	if (errorResult) return errorResult;

	const currentContent = await ctx.plugin.app.vault.read(file!);
	const proposedContent = currentContent + '\n' + newContent;
	
	if (proposedContent.length > MCP_MAX_FILE_LENGTH) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_note.maxLengthExceeded') }] };
	}

	return safeModifyFile(
		path,
		file!,
		currentContent,
		proposedContent,
		t('mcpServerTools.append_to_note.success', { path }),
		ctx,
		pathGuard
	);
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

	const abstractFile = ctx.plugin.app.vault.getAbstractFileByPath(path);
	
	if (abstractFile instanceof TFile) {
		const currentContent = await ctx.plugin.app.vault.read(abstractFile);
		const proposedContent = currentContent + '\n' + newContent;
		if (proposedContent.length > MCP_MAX_FILE_LENGTH) {
			return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_daily_note.maxLengthExceeded') }] };
		}
		
		return safeModifyFile(
			path,
			abstractFile,
			currentContent,
			proposedContent,
			t('mcpServerTools.append_to_daily_note.successAppend', { path }),
			ctx,
			pathGuard
		);
	} else {
		return safeCreateFile(
			path,
			newContent,
			t('mcpServerTools.append_to_daily_note.successCreate', { path }),
			ctx,
			pathGuard
		);
	}
};

export const replaceNoteHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const newContent = getStringArg(args, 'content');
	if (newContent.length > MCP_MAX_FILE_LENGTH) {
		return { isError: true, content: [{ type: 'text', text: 'Content exceeds maximum allowed length.' }] };
	}

	const { path, file, errorResult } = getValidatedPathAndFile(args, ctx, pathGuard);
	if (errorResult) return errorResult;

	const currentContent = await ctx.plugin.app.vault.read(file!);
	
	return safeModifyFile(
		path,
		file!,
		currentContent,
		newContent,
		`Successfully replaced content in ${path}`,
		ctx,
		pathGuard
	);
};

export const patchNoteHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const target = getStringArg(args, 'target');
	const replacement = getStringArg(args, 'replacement');

	const { path, file, errorResult } = getValidatedPathAndFile(args, ctx, pathGuard);
	if (errorResult) return errorResult;

	const currentContent = await ctx.plugin.app.vault.read(file!);
	if (!currentContent.includes(target)) {
		return { isError: true, content: [{ type: 'text', text: `Target text not found in ${path}. Ensure whitespace matches exactly.` }] };
	}

	const proposedContent = currentContent.replace(target, replacement);

	return safeModifyFile(
		path,
		file!,
		currentContent,
		proposedContent,
		`Successfully patched ${path}`,
		ctx,
		pathGuard
	);
};

export const deleteNoteHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const { path, file, errorResult } = getValidatedPathAndFile(args, ctx, pathGuard);
	if (errorResult) return errorResult;

	return safeActionFile(
		'delete',
		path,
		undefined,
		async () => {
			await ctx.plugin.app.fileManager.trashFile(file!);
			return `Successfully deleted ${path}`;
		},
		ctx,
		pathGuard,
		'User explicitly rejected deletion. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.'
	);
};

export const moveNoteHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const { path: sourcePath, file: sourceFile, errorResult: srcError } = getValidatedPathAndFile(args, ctx, pathGuard, 'sourcePath');
	if (srcError) return srcError;

	const { path: targetPath, errorResult: tgtError } = getValidatedPathAndFile(args, ctx, pathGuard, 'targetPath', false);
	if (tgtError) return tgtError;

	return safeActionFile(
		'rename',
		sourcePath,
		{ targetPath },
		async () => {
			await ensureFolderExists(ctx.plugin.app, targetPath);
			await ctx.plugin.app.fileManager.renameFile(sourceFile!, targetPath);
			return `Successfully moved to ${targetPath}`;
		},
		ctx,
		pathGuard,
		'User explicitly rejected move/rename. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.'
	);
};

export const updateFrontmatterHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const key = getStringArg(args, 'key');
	const value = args.value;

	const { path, file, errorResult } = getValidatedPathAndFile(args, ctx, pathGuard);
	if (errorResult) return errorResult;

	return safeActionFile(
		'frontmatter',
		path,
		{ key, value },
		async () => {
			await ctx.plugin.app.fileManager.processFrontMatter(file!, (fm) => {
				const record = fm as Record<string, unknown>;
				record[key] = value;
			});
			return `Successfully updated frontmatter key ${key} in ${path}`;
		},
		ctx,
		pathGuard,
		'User explicitly rejected frontmatter update. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.'
	);
};

export const saveAttachmentHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const base64Data = getStringArg(args, 'base64Data');

	const { path, file, errorResult } = getValidatedPathAndFile(args, ctx, pathGuard, 'path', false);
	if (errorResult) return errorResult;

	if (file) {
		return { isError: true, content: [{ type: 'text', text: `File already exists at ${path}` }] };
	}

	const MAX_BASE64_LENGTH = 70 * 1024 * 1024;
	if (base64Data.length > MAX_BASE64_LENGTH) {
		return { isError: true, content: [{ type: 'text', text: `Attachment is too large (max 50MB allowed)` }] };
	}

	const binaryString = window.atob(base64Data);
	const sizeBytes = binaryString.length;

	const approved = await approvalManager.requestActionApproval('attachment', path, { sizeBytes });
	if (!approved) {
		return getRejectionResult('User explicitly rejected attachment saving. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.');
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