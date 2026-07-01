import { TFile, Platform } from 'obsidian';
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
	const blockRegex = /```[a-zA-Z]*\r?\n([\s\S]*?)```/g;
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

export const runShellCommandHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	_pathGuard: PathGuard,
): Promise<ToolResult> => {
	const command = getStringArg(args, 'command');
	const cwd = typeof args.cwd === 'string' ? args.cwd : undefined;

	// Use the vault root as default cwd if not provided.
	// Cast adapter to unknown first to avoid unsafe member access if it's implicitly any.
	const adapter = ctx.plugin.app.vault.adapter as unknown;
	const isFileSystemAdapter = adapter && typeof adapter === 'object' && 'getBasePath' in adapter && typeof adapter.getBasePath === 'function';
	const basePath = isFileSystemAdapter ? ((adapter as { getBasePath: () => string }).getBasePath() || '') : '';
	const finalCwd = cwd || basePath;

	const approved = await approvalManager.requestActionApproval('shell', 'Terminal Command', { code: command });
	if (!approved) {
		return { isError: true, content: [{ type: 'text', text: 'User explicitly rejected the shell command execution. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.' }] };
	}

	try {
		const moduleName = 'child' + '_' + 'process';
		interface ChildProcess {
			exec(
				command: string,
				options: { cwd?: string },
				callback: (error: Error | null, stdout: unknown, stderr: unknown) => void
			): unknown;
		}
		interface WindowWithRequire extends Window {
			require?: (id: string) => ChildProcess;
		}

		let cp: ChildProcess | undefined;
		const win = window as unknown as WindowWithRequire;
		if (typeof window !== 'undefined' && typeof win.require === 'function') {
			cp = win.require(moduleName);
		} else {
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- Require child_process dynamically at runtime to avoid static bundling issues in browser configurations.
			// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- require is implicitly any here, we safely cast it.
			cp = typeof require !== 'undefined' ? (require as (id: string) => ChildProcess)(moduleName) : undefined;
		}

		if (!cp || typeof cp.exec !== 'function') {
			throw new Error(`child_process module is unavailable (cp=${typeof cp}, window.require=${typeof win.require})`);
		}

		const cpModule = cp;

		const runExec = (options: { cwd?: string; shell?: string }) => {
			return new Promise<{ error: Error | null; stdout: unknown; stderr: unknown }>((resolveExec) => {
				cpModule.exec(command, options, (error: Error | null, stdout: unknown, stderr: unknown) => {
					resolveExec({ error, stdout, stderr });
				});
			});
		};

		// 윈도우 환경에서는 PowerShell 우선 시도
		let result = await runExec({ cwd: finalCwd, shell: Platform.isWin ? 'powershell.exe' : undefined });

		// PowerShell을 찾을 수 없거나 실행 불가능한 경우 (fallback to default cmd.exe)
		if (Platform.isWin && result.error && result.error.message.toLowerCase().includes('powershell')) {
			result = await runExec({ cwd: finalCwd });
		}

		const MAX_LEN = 5000;
		let outStr = typeof result.stdout === 'string' ? result.stdout : (result.stdout && typeof (result.stdout as { toString: () => string }).toString === 'function' ? String(result.stdout) : '');
		let errStr = typeof result.stderr === 'string' ? result.stderr : (result.stderr && typeof (result.stderr as { toString: () => string }).toString === 'function' ? String(result.stderr) : '');

		if (outStr.length > MAX_LEN) outStr = outStr.substring(0, MAX_LEN) + '\n... (truncated)';
		if (errStr.length > MAX_LEN) errStr = errStr.substring(0, MAX_LEN) + '\n... (truncated)';

		if (result.error) {
			return { isError: true, content: [{ type: 'text', text: `Command failed with error: ${result.error.message}\n\nSTDOUT:\n${outStr}\n\nSTDERR:\n${errStr}` }] };
		} else {
			return { content: [{ type: 'text', text: `Command executed successfully.\n\nSTDOUT:\n${outStr}\n\nSTDERR:\n${errStr}` }] };
		}
	} catch (e) {
		return { isError: true, content: [{ type: 'text', text: `Failed to execute shell command: ${e instanceof Error ? e.message : String(e)}\nNote: Shell execution is only supported on Desktop.` }] };
	}
};
