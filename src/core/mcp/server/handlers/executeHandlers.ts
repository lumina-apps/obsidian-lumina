import { TFile, Platform } from 'obsidian';
import { sanitizeFilePath } from '../../../../shared/utils/fileUtils';
import { getStringArg, blockIfPathNotAllowed } from '../handlerHelpers';
import type { ToolArguments, ToolHandlerContext, ToolResult } from '../toolTypes';
import type { PathGuard } from '../pathGuard';
import { approvalManager } from '../../../../features/chat/utils/approvalManager';
import { McpSandbox } from '../../mcpSandbox';

/** 실행/셸 승인 대기 최대 시간 (5분) */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export const executeCodeHandler = async (
	args: ToolArguments,
	_ctx: ToolHandlerContext,
	_pathGuard: PathGuard,
): Promise<ToolResult> => {
	const code = getStringArg(args, 'code');

	const approved = await approvalManager.requestActionApproval('execute', 'Code Sandbox', { code }, { timeoutMs: APPROVAL_TIMEOUT_MS });
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

	const approved = await approvalManager.requestActionApproval('execute', `Code Block [${blockIndex}] in ${path}`, { code }, { timeoutMs: APPROVAL_TIMEOUT_MS });
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

	// ── 위험 패턴 사전 차단 ────────────────────────────────────────────
	const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
		{ pattern: new RegExp('rm\\s+-[a-z]*r[a-z]*f?\\s+(/|~[/\\s]|\\.\\./)', 'i'), reason: 'Recursive deletion of root/home directory is not allowed.' },
		{ pattern: new RegExp(':\\(\\)\\s*\\{'),                                reason: 'Fork bomb pattern is not allowed.' },
		{ pattern: new RegExp('(curl|wget)\\s+.+\\|\\s*(bash|sh|zsh|fish|python)', 'i'), reason: 'Piping remote content directly to a shell is not allowed.' },
		{ pattern: new RegExp('>\\s*/dev/(sda|hda|nvme)', 'i'),                 reason: 'Writing directly to block devices is not allowed.' },
		{ pattern: new RegExp('chmod\\s+[0-9]*7[0-9]*\\s+/', 'i'),              reason: 'Changing permissions on root directory is not allowed.' },
		{ pattern: new RegExp('mkfs\\.', 'i'),                                  reason: 'Formatting file systems is not allowed.' },
		// Windows 위험 명령어 차단 패턴
		// 1) 슬래시 또는 백슬래시 경로 모두 매칭
		{ pattern: new RegExp('(del|erase)\\s+(/\\w+\\s+)*[a-zA-Z]:[\\\\/]', 'i'), reason: 'File deletion via del/erase is not allowed.' },
		{ pattern: new RegExp('rmdir\\s+/[a-z]*s[a-z]*', 'i'),                  reason: 'Recursive directory deletion (rmdir /s) is not allowed.' },
		{ pattern: new RegExp('rd\\s+/[a-z]*s[a-z]*', 'i'),                     reason: 'Recursive directory deletion (rd /s) is not allowed.' },
		{ pattern: new RegExp('format\\s+[a-zA-Z]:[\\\\/]', 'i'),               reason: 'Formatting drives is not allowed.' },
		{ pattern: new RegExp('icacls\\s+[a-zA-Z]:[\\\\/]', 'i'),               reason: 'Modifying file permissions via icacls is not allowed.' },
		{ pattern: new RegExp('takeown\\s+(/\\w+\\s+)*[a-zA-Z]:[\\\\/]', 'i'),  reason: 'Taking ownership of files is not allowed.' },
		{ pattern: new RegExp('diskpart', 'i'),                                 reason: 'Disk partition operations are not allowed.' },
		// 2) PowerShell / 대체 명령어 우회 차단
		{ pattern: new RegExp('remove-item\\b', 'i'),                           reason: 'PowerShell Remove-Item is not allowed.' },
		{ pattern: new RegExp('invoke-expression\\b|\\biex\\s+', 'i'),          reason: 'PowerShell code execution via Invoke-Expression is not allowed.' },
		{ pattern: new RegExp('powershell(\\.exe)?\\s+.*-enc(odedcommand)?\\b', 'i'), reason: 'Encoded PowerShell commands are not allowed.' },
		{ pattern: new RegExp('Start-Process\\s+.*-Verb\\s+RunAs', 'i'),        reason: 'Elevated process execution (Start-Process -Verb RunAs) is not allowed.' },
		{ pattern: new RegExp('reg\\s+(add|delete|copy)\\s+HK', 'i'),           reason: 'Modifying Windows registry is not allowed.' },
		// 3) 간접 실행 / 스크립트 파일 차단
		{ pattern: new RegExp('(wscript|cscript|mshta|rundll32)\\b', 'i'),      reason: 'Indirect script execution (wscript/cscript/mshta/rundll32) is not allowed.' },
		{ pattern: new RegExp('certutil\\s+.*-decode', 'i'),                    reason: 'Decoding payloads via certutil is not allowed.' },
	];

	for (const { pattern, reason } of BLOCKED_PATTERNS) {
		if (pattern.test(command)) {
			return {
				isError: true,
				content: [{ type: 'text', text: `Command blocked by security policy: ${reason}` }],
			};
		}
	}
	// ── 위험 패턴 차단 끝 ──────────────────────────────────────────────

	const approved = await approvalManager.requestActionApproval('shell', 'Terminal Command', { code: command }, { timeoutMs: APPROVAL_TIMEOUT_MS });
	if (!approved) {
		return { isError: true, content: [{ type: 'text', text: 'User explicitly rejected the shell command execution. DO NOT retry this action. Acknowledge the rejection and ask the user how to proceed.' }] };
	}

	try {
		const moduleName = 'child' + '_' + 'process';
		interface SpawnChild {
			stdout: { on(event: 'data', cb: (chunk: Buffer) => void): void };
			stderr: { on(event: 'data', cb: (chunk: Buffer) => void): void };
			on(event: 'error' | 'close', cb: (arg: Error | number | null) => void): void;
		}
		interface ChildProcess {
			exec(
				command: string,
				options: { cwd?: string; shell?: string },
				callback: (error: Error | null, stdout: unknown, stderr: unknown) => void
			): unknown;
			spawn(
				command: string,
				args: string[],
				options: { cwd?: string }
			): SpawnChild;
		}

		// Use the string-concatenated module name to prevent esbuild post-process
		// from replacing require('child_process') with undefined (see esbuild.config.mjs postProcessMainBundle).
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- Required dynamically at runtime.
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- require is implicitly any here, we safely cast it.
		const cp: ChildProcess | undefined = typeof require !== 'undefined'
			? (require as (id: string) => ChildProcess)(moduleName)
			: undefined;

		if (!cp || typeof cp.exec !== 'function') {
			throw new Error(`child_process module is unavailable (cp=${typeof cp}). Note: Shell execution is only supported on Desktop.`);
		}

		const cpModule = cp;

		const runExec = (options: { cwd?: string; shell?: string }) => {
			return new Promise<{ error: Error | null; stdout: unknown; stderr: unknown }>((resolveExec) => {
				cpModule.exec(command, options, (error: Error | null, stdout: unknown, stderr: unknown) => {
					resolveExec({ error, stdout, stderr });
				});
			});
		};

		// Windows: try pwsh.exe (PowerShell Core) first, then powershell.exe, then fallback to COMSPEC/cmd.exe
		// COMSPEC is the Windows environment variable pointing to the default command shell (usually cmd.exe).
		// Note: child_process.exec() internally runs `shell /c command`, which PowerShell does NOT support
		// (PowerShell expects -Command). So when using PowerShell, we must spawn with -Command flag instead.
		let result: { error: Error | null; stdout: unknown; stderr: unknown };
		if (Platform.isWin) {
			const comspec = typeof process !== 'undefined' && process.env?.COMSPEC ? process.env.COMSPEC : 'cmd.exe';

			// Check whether a shell executable exists in PATH via `where`
			const isShellAvailable = (exe: string): Promise<boolean> => {
				return new Promise((resolveCheck) => {
					cpModule.exec(`where ${exe}`, { cwd: finalCwd }, (err: Error | null) => {
						resolveCheck(!err);
					});
				});
			};

			// Run a command via PowerShell with -Command flag (spawn, not exec)
			const runPwsh = (shellPath: string): Promise<{ error: Error | null; stdout: unknown; stderr: unknown }> => {
				return new Promise((resolveExec) => {
					try {
						const child = cpModule.spawn(
							shellPath,
							['-NoProfile', '-NonInteractive', '-Command', command],
							{ cwd: finalCwd }
						);
						let stdout = '';
						let stderr = '';
						child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
						child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
						child.on('error', (err: Error | number | null) => {
							resolveExec({
								error: err instanceof Error ? err : new Error(String(err)),
								stdout,
								stderr,
							});
						});
						child.on('close', (code: Error | number | null) => {
							if (code === 0) {
								resolveExec({ error: null, stdout, stderr });
							} else {
								resolveExec({
									error: new Error(`Command exited with code ${String(code)}`),
									stdout,
									stderr,
								});
							}
						});
					} catch (e) {
						resolveExec({ error: e instanceof Error ? e : new Error(String(e)), stdout: '', stderr: '' });
					}
				});
			};

			// 1) Try pwsh.exe (PowerShell Core)
			if (await isShellAvailable('pwsh.exe')) {
				result = await runPwsh('pwsh.exe');
			}
			// 2) Try powershell.exe (Windows PowerShell)
			else if (await isShellAvailable('powershell.exe')) {
				result = await runPwsh('powershell.exe');
			}
			// 3) Fallback to cmd.exe (COMSPEC)
			else {
				result = await runExec({ cwd: finalCwd, shell: comspec });
			}
		} else {
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
