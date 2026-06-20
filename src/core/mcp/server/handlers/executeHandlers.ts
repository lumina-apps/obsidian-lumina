import { TFile } from 'obsidian';
import { sanitizeFilePath } from '../../../../shared/utils/fileUtils';
import { getStringArg, blockIfPathNotAllowed } from '../handlerHelpers';
import type { ToolArguments, ToolHandlerContext, ToolResult } from '../toolTypes';
import type { PathGuard } from '../pathGuard';
import { approvalManager } from '../../../../features/chat/utils/approvalManager';
import { McpSandbox } from '../../mcpSandbox';

export const executeCodeHandler = async (
	args: ToolArguments,
	_ctx: ToolHandlerContext,
	_pathGuard: PathGuard,
): Promise<ToolResult> => {
	const code = getStringArg(args, 'code');

	const approved = await approvalManager.requestActionApproval('execute', 'Code Sandbox', { code });
	if (!approved) {
		return { isError: true, content: [{ type: 'text', text: 'User explicitly rejected code execution. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.' }] };
	}

	try {
		const result = await McpSandbox.executeCode(code, {}, { timeoutMs: 5000 });
		if (result.success) {
			return { content: [{ type: 'text', text: `Execution successful.\nResult:\n${JSON.stringify(result.data, null, 2)}` }] };
		} else {
			return { isError: true, content: [{ type: 'text', text: `Execution failed.\nError:\n${result.error}` }] };
		}
	} catch (e) {
		return { isError: true, content: [{ type: 'text', text: `Sandbox Error: ${e}` }] };
	}
};

export const runNoteCodeBlockHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const path = sanitizeFilePath(getStringArg(args, 'path'));
	const blockIndex = typeof args.blockIndex === 'number' ? args.blockIndex : parseInt(String(args.blockIndex), 10);

	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: `File not found: ${path}` }] };
	}

	const content = await ctx.plugin.app.vault.read(file);
	
	// 간단한 코드블록 추출 (``` 언어 ... ```)
	const blockRegex = /```[a-zA-Z]*\n([\s\S]*?)```/g;
	const matches = [...content.matchAll(blockRegex)];
	
	if (blockIndex < 0 || blockIndex >= matches.length) {
		return { isError: true, content: [{ type: 'text', text: `Code block index ${blockIndex} out of bounds. Found ${matches.length} blocks.` }] };
	}

	const code = matches[blockIndex][1];

	const approved = await approvalManager.requestActionApproval('execute', `Code Block [${blockIndex}] in ${path}`, { code });
	if (!approved) {
		return { isError: true, content: [{ type: 'text', text: 'User explicitly rejected code block execution. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.' }] };
	}

	try {
		const result = await McpSandbox.executeCode(code, {}, { timeoutMs: 5000 });
		if (result.success) {
			return { content: [{ type: 'text', text: `Execution successful.\nResult:\n${JSON.stringify(result.data, null, 2)}` }] };
		} else {
			return { isError: true, content: [{ type: 'text', text: `Execution failed.\nError:\n${result.error}` }] };
		}
	} catch (e) {
		return { isError: true, content: [{ type: 'text', text: `Sandbox Error: ${e}` }] };
	}
};
