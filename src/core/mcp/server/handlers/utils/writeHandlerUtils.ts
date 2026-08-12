import { App, TFile } from 'obsidian';
import { t } from '../../../../../shared/locales/helpers';
import { sanitizeFilePath, ensureFolderExists } from '../../../../../shared/utils/fileUtils';
import { getStringArg, blockIfPathNotAllowed } from '../../handlerHelpers';
import type { ToolArguments, ToolHandlerContext, ToolResult } from '../../toolTypes';
import type { PathGuard } from '../../pathGuard';
import { createBackup } from '../../../../../features/backup/backupManager';
import { approvalManager } from '../../../../../features/chat/utils/approvalManager';
import type { ActionType } from '../../../../../features/chat/utils/approvalManager';

export const DEFAULT_REJECTION_MESSAGE = 'User explicitly rejected the change. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.';

/** 에디트/액션 승인 대기 최대 시간 (5분) */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export const getRejectionResult = (message: string): ToolResult => ({
	isError: true,
	content: [{ type: 'text', text: message }]
});

async function openFileInWorkspace(app: App, path: string) {
	const file = app.vault.getAbstractFileByPath(path);
	if (file instanceof TFile) {
		const leaves = app.workspace.getLeavesOfType('markdown');
		for (const leaf of leaves) {
			const view = leaf.view as { file?: { path?: string } };
			if (view.file?.path === path) {
				app.workspace.setActiveLeaf(leaf, { focus: true });
				return;
			}
		}
		const leaf = app.workspace.getLeaf('tab');
		await leaf.openFile(file);
	}
}

export interface ValidatedFileResult {
	path: string;
	file?: TFile;
	errorResult?: ToolResult;
}

export const getValidatedPathAndFile = (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
	argKey: string = 'path',
	requireTFile: boolean = true,
	enforceMd: boolean = true
): ValidatedFileResult => {
	const path = sanitizeFilePath(getStringArg(args, argKey), enforceMd);

	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return { path, errorResult: blocked };

	const abstractFile = ctx.plugin.app.vault.getAbstractFileByPath(path);
	
	if (requireTFile) {
		if (!(abstractFile instanceof TFile)) {
			// fallback message is added in case t() returns empty
			const text = t('uiMessages.fileNotFound') ? `${t('uiMessages.fileNotFound')}: ${path}` : `File not found: ${path}`;
			return { 
				path, 
				errorResult: { isError: true, content: [{ type: 'text', text }] } 
			};
		}
		return { path, file: abstractFile };
	}

	if (abstractFile instanceof TFile) {
		return { path, file: abstractFile };
	}

	return { path };
};

export const safeModifyFile = async (
	path: string,
	file: TFile,
	currentContent: string,
	proposedContent: string,
	successMessage: string,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard
): Promise<ToolResult> => {
	// Open and focus the target file before asking for approval,
	// so the diff decorations are visible in the editor.
	await openFileInWorkspace(ctx.plugin.app, path);

	const result = await approvalManager.requestApproval(path, currentContent, proposedContent, { timeoutMs: APPROVAL_TIMEOUT_MS });
	if (!result.approved) {
		return getRejectionResult(DEFAULT_REJECTION_MESSAGE);
	}

	return await pathGuard.lock(path, async () => {
		const contentNow = await ctx.plugin.app.vault.read(file);
		if (contentNow !== currentContent) {
			return { isError: true, content: [{ type: 'text', text: 'File was modified while waiting for approval. Please try again.' }] };
		}
		await createBackup(ctx.plugin.app, path);
		await ctx.plugin.app.vault.modify(file, result.content);
		await openFileInWorkspace(ctx.plugin.app, path);
		return { content: [{ type: 'text', text: successMessage }] };
	});
};

export const safeCreateFile = async (
	path: string,
	content: string,
	successMessage: string,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard
): Promise<ToolResult> => {
	const approved = await approvalManager.requestActionApproval('create_note', path, { content }, { timeoutMs: APPROVAL_TIMEOUT_MS });
	if (!approved) {
		return getRejectionResult('User explicitly rejected the file creation. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.');
	}

	await pathGuard.lock(path, async () => {
		await ensureFolderExists(ctx.plugin.app, path);
		await ctx.plugin.app.vault.create(path, content);
		await enforceLuminaMetadata(path, ctx);
		await openFileInWorkspace(ctx.plugin.app, path);
	});
	return { content: [{ type: 'text', text: successMessage }] };
};

/**
 * MCP 툴로 노트를 생성/수정한 직후 lumina 메타데이터를 스탬핑한다.
 * - `autoFrontmatter`가 꺼져 있으면 프론트매터를 절대 건드리지 않는다 (전체 opt-out).
 * - 이미 현재 버전으로 스탬핑된 파일은 재기록하지 않는다 (불필요한 mtime 변경/재기록 방지).
 */
async function enforceLuminaMetadata(path: string, ctx: ToolHandlerContext) {
	if (!ctx.plugin.settings.misc.autoFrontmatter) return;

	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile) || file.extension !== 'md') return;

	try {
		const now = new Date().toISOString();
		const version = ctx.plugin.manifest.version;

		// 이미 현재 버전으로 스탬핑되어 있으면 건너뛴다 (중복 재기록 방지).
		const cache = ctx.plugin.app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter as Record<string, unknown> | undefined;
		if (
			fm &&
			typeof fm.luminaCreated === 'string' &&
			typeof fm.luminaModified === 'string' &&
			fm.luminaVersion === version
		) {
			return;
		}

		await ctx.plugin.app.fileManager.processFrontMatter(file, (fmObj: Record<string, unknown>) => {
			const r = fmObj as Record<string, string>;
			r.luminaCreated = r.luminaCreated || now;
			r.luminaModified = now;
			r.luminaVersion = version;
		});
	} catch {
		// ignore errors if frontmatter is invalid
	}
}

export const safeActionFile = async (
	actionName: Exclude<ActionType, 'edit'>,
	path: string,
	actionParams: Record<string, unknown> | undefined,
	actionFn: () => Promise<string>,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
	rejectionMessage: string = DEFAULT_REJECTION_MESSAGE
): Promise<ToolResult> => {
	const approved = await approvalManager.requestActionApproval(actionName, path, actionParams, { timeoutMs: APPROVAL_TIMEOUT_MS });
	if (!approved) {
		return getRejectionResult(rejectionMessage);
	}

	return await pathGuard.lock(path, async () => {
		await createBackup(ctx.plugin.app, path);
		const successMessage = await actionFn();
		
		const targetPath = (actionName === 'rename' && actionParams?.targetPath) ? String(actionParams.targetPath) : path;
		await enforceLuminaMetadata(targetPath, ctx);
		
		if (actionName !== 'delete') {
			await openFileInWorkspace(ctx.plugin.app, targetPath);
		}
		
		return { content: [{ type: 'text', text: successMessage }] };
	});
};
