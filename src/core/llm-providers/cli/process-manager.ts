import type { ChildProcess, SpawnOptions as NodeSpawnOptions } from 'child_process';
import { join, win32 } from 'path';
import { debugLogger } from '../../../shared/debugLogger';

export interface SpawnOptions {
	command: string;
	args: string[];
	cwd: string;
	env?: Record<string, string>;
	timeoutMs?: number;
	signal?: AbortSignal;
	closeStdin?: boolean;
}

export interface ProcessStreams {
	process: ChildProcess;
	onStdout(callback: (data: string) => void): void;
	onStderr(callback: (data: string) => void): void;
	writeStdin(data: string): void;
	closeStdin(): void;
	waitForExit(): Promise<{ exitCode: number; signal?: string }>;
	kill(): void;
}

/**
 * Obsidian / Electron 런타임에서 child_process.spawn 함수를 안전하게 획득합니다.
 */
export function getSpawnFunction(): ((command: string, args: string[], options: NodeSpawnOptions) => ChildProcess) | null {
	if (ProcessManager.spawnFnOverride) {
		return ProcessManager.spawnFnOverride;
	}
	try {
		// 1. Electron renderer window.require 시도
		if (typeof window !== 'undefined') {
			const win = window as unknown as {
				require?: (mod: string) => { spawn?: (c: string, a: string[], o: NodeSpawnOptions) => ChildProcess };
			};
			if (typeof win.require === 'function') {
				const cp = win.require('child_process');
				if (cp && typeof cp.spawn === 'function') {
					return cp.spawn;
				}
			}
		}
		// 2. Node.js 표준 require 시도
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- Fallback to Node.js require when running in desktop/Node environment
		const cp = (typeof require === 'function' ? require('child_process') : undefined) as unknown as { spawn?: (c: string, a: string[], o: NodeSpawnOptions) => ChildProcess } | undefined;
		if (cp && typeof cp.spawn === 'function') {
			return cp.spawn;
		}
	} catch (e) {
		debugLogger.logError('cli-agent', `Failed to load child_process: ${e instanceof Error ? e.message : String(e)}`);
	}
	return null;
}

/**
 * CLI 프로세스 실행 시 사용할 안전한 기본 작업 디렉토리(CWD)를 반환합니다.
 * Electron 앱 설치 디렉토리 대신 사용자 홈 디렉토리를 우선 탐색하여 권한 부족이나 의도치 않은 파일 쓰기를 방지합니다.
 */
export function getDefaultCwd(): string {
	if (typeof process !== 'undefined') {
		const home = process.env.HOME || process.env.USERPROFILE;
		if (home) return home;
		try {
			if (typeof process.cwd === 'function') {
				return process.cwd();
			}
		} catch {
			// ignore
		}
	}
	return '.';
}

/**
 * macOS/Linux Electron GUI 앱에서 누락되기 쉬운 표준 바이너리 경로(/opt/homebrew/bin 등)를 PATH에 보강합니다.
 */
export function getEnhancedEnv(
	customEnv: Record<string, string> = {},
	platform: NodeJS.Platform = process.platform,
): Record<string, string> {
	const env: Record<string, string> = {
		...(process.env as Record<string, string>),
		...customEnv,
	};

	const isWin = platform === 'win32';
	const pathJoin = isWin ? win32.join : join;
	const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || (isWin ? 'Path' : 'PATH');
	const currentPath = env[pathKey] || process.env[pathKey] || process.env.PATH || process.env.Path || '';
	const delimiter = isWin ? ';' : ':';

	if (isWin) {
		const userProfile = env.USERPROFILE || process.env.USERPROFILE || '';
		const appData = env.APPDATA || process.env.APPDATA || (userProfile ? pathJoin(userProfile, 'AppData', 'Roaming') : '');
		const localAppData = env.LOCALAPPDATA || process.env.LOCALAPPDATA || (userProfile ? pathJoin(userProfile, 'AppData', 'Local') : '');
		const programFiles = env.ProgramFiles || process.env.ProgramFiles || 'C:\\Program Files';

		const standardPaths = [
			appData ? pathJoin(appData, 'npm') : '',
			localAppData ? pathJoin(localAppData, 'Programs', 'antigravity', 'bin') : '',
			userProfile ? pathJoin(userProfile, '.gemini', 'antigravity', 'bin') : '',
			userProfile ? pathJoin(userProfile, '.cargo', 'bin') : '',
			userProfile ? pathJoin(userProfile, '.bun', 'bin') : '',
			userProfile ? pathJoin(userProfile, 'AppData', 'Local', 'Microsoft', 'WindowsApps') : '',
			pathJoin(programFiles, 'nodejs'),
			pathJoin(programFiles, 'Git', 'cmd'),
		].filter(Boolean);

		const existingParts = currentPath.split(delimiter).filter(Boolean);
		for (const p of standardPaths) {
			if (!existingParts.some((ep) => ep.toLowerCase() === p.toLowerCase())) {
				existingParts.unshift(p);
			}
		}
		const updatedPath = existingParts.join(delimiter);
		env[pathKey] = updatedPath;
		env.PATH = updatedPath;
		env.Path = updatedPath;
	} else if (platform === 'darwin' || platform === 'linux') {
		const home = env.HOME || process.env.HOME || '';
		const standardPaths = [
			'/opt/homebrew/bin',
			'/opt/homebrew/sbin',
			'/usr/local/bin',
			'/usr/local/sbin',
			'/usr/bin',
			'/bin',
			'/usr/sbin',
			'/sbin',
			home ? `${home}/.local/bin` : '',
			home ? `${home}/.cargo/bin` : '',
			home ? `${home}/.npm-global/bin` : '',
			home ? `${home}/.yarn/bin` : '',
			home ? `${home}/.bun/bin` : '',
			home ? `${home}/.gemini/antigravity/bin` : '',
			home ? `${home}/.nvm/current/bin` : '',
			home ? `${home}/bin` : '',
		].filter(Boolean);

		const existingParts = currentPath.split(':').filter(Boolean);
		for (const p of standardPaths) {
			if (!existingParts.includes(p)) {
				existingParts.unshift(p);
			}
		}
		env.PATH = existingParts.join(':');
	}

	return env;
}

/**
 * Electron renderer / Node 런타임에서 fs.existsSync 함수를 안전하게 획득합니다.
 * (esbuild 번들링 시 require('fs')가 undefined로 치환되더라도 TypeError가 발생하지 않도록 방지)
 */
function getExistsSyncFunction(): ((path: string) => boolean) | null {
	try {
		const fsModuleName = ['f', 's'].join('');
		if (typeof window !== 'undefined') {
			const win = window as unknown as {
				require?: (mod: string) => { existsSync?: (p: string) => boolean };
			};
			if (typeof win.require === 'function') {
				const fsMod = win.require(fsModuleName);
				if (fsMod && typeof fsMod.existsSync === 'function') {
					return fsMod.existsSync;
				}
			}
		}
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- Fallback to Node.js require in desktop runtime
		const nodeRequire = typeof require === 'function' ? (require as unknown as (mod: string) => { existsSync?: (p: string) => boolean }) : undefined;
		if (typeof nodeRequire === 'function') {
			const fsMod = nodeRequire(fsModuleName);
			if (fsMod && typeof fsMod.existsSync === 'function') {
				return fsMod.existsSync;
			}
		}
	} catch {
		// ignore
	}
	return null;
}

/**
 * 바이너리 이름(예: agy, claude)이 PATH 내에 위치한 실제 절대 경로를 찾아냅니다.
 */
export function resolveBinaryPath(
	command: string,
	env: Record<string, string>,
	options?: {
		existsSyncFn?: (path: string) => boolean;
		platform?: NodeJS.Platform;
	},
): string {
	if (!command) return command;

	const existsSyncFn = options?.existsSyncFn ?? getExistsSyncFunction();
	const isWin = (options?.platform ?? process.platform) === 'win32';

	// 1. 이미 경로 구분자(/ or \)가 포함된 경우
	if (command.includes('/') || command.includes('\\')) {
		if (existsSyncFn) {
			try {
				if (existsSyncFn(command)) {
					return command;
				}
				// Windows에서는 사용자가 확장자 없이 지정했을 수 있으므로 .cmd, .exe, .bat 순차 확인
				if (isWin && !/\.(cmd|exe|bat|ps1)$/i.test(command)) {
					for (const ext of ['.cmd', '.exe', '.bat']) {
						const candidate = `${command}${ext}`;
						if (existsSyncFn(candidate)) {
							return candidate;
						}
					}
				}
			} catch {
				// ignore filesystem errors
			}
		}
		return command;
	}

	if (!existsSyncFn) return command;

	const pathStr = env.PATH || env.Path || '';
	const delimiter = isWin ? ';' : ':';
	const dirs = pathStr.split(delimiter).filter(Boolean);
	const pathJoin = isWin ? win32.join : join;

	const extensions = isWin && !command.includes('.') ? ['.cmd', '.exe', '.bat', ''] : [''];

	for (const dir of dirs) {
		for (const ext of extensions) {
			const candidate = pathJoin(dir, `${command}${ext}`);
			try {
				if (existsSyncFn(candidate)) {
					debugLogger.logDebug('cli-agent', `Resolved binary path: "${candidate}" for command "${command}"`);
					return candidate;
				}
			} catch {
				// ignore filesystem errors
			}
		}
	}

	return command;
}

/**
 * CLI 프로세스 수명 주기 및 스트림 관리자
 */
export class ProcessManager {
	/**
	 * 단위 테스트용 spawn 함수 오버라이드. null일 경우 기본 getSpawnFunction() 동작
	 */
	public static spawnFnOverride: ((command: string, args: string[], options: NodeSpawnOptions) => ChildProcess) | null = null;

	/**
	 * CLI 명령어를 자식 프로세스로 스폰하고 입출력 스트림을 제공합니다.
	 */
	public static spawn(options: SpawnOptions): ProcessStreams {
		const { command, args, cwd, env = {}, timeoutMs, signal, closeStdin } = options;

		const spawnFn = getSpawnFunction();
		if (!spawnFn) {
			throw new Error(
				'child_process.spawn is not available in this Obsidian environment (Mobile or sandboxed environment is not supported)',
			);
		}

		const mergedEnv = getEnhancedEnv(env);
		const resolvedCommand = resolveBinaryPath(command, mergedEnv);

		debugLogger.logDebug(
			'cli-agent',
			`Spawning process: ${resolvedCommand} (raw: ${command}) args: [${args.join(', ')}] in ${cwd}`,
		);

		const isWin = process.platform === 'win32';
		// Windows에서 .cmd, .bat 파일은 Node.js 보안 정책상 shell: true가 필수이지만,
		// .exe 파일은 cmd.exe의 8,191자 명령줄 길이 제한 및 이스케이프 왜곡을 피하기 위해 shell: false로 실행
		const isBatchOrCmd = isWin && (resolvedCommand.toLowerCase().endsWith('.cmd') || resolvedCommand.toLowerCase().endsWith('.bat'));
		const needsShell = isWin && (isBatchOrCmd || !resolvedCommand.toLowerCase().endsWith('.exe'));

		const child = spawnFn(resolvedCommand, args, {
			cwd,
			env: mergedEnv,
			shell: needsShell,
			windowsHide: true,
		});

		// Stdin이 필요 없는 경우 즉시 스트림을 닫아(EOF 전송), CLI 프로세스가 stdin 대기 상태로 블로킹되는 현상 방지
		if (closeStdin) {
			try {
				if (child.stdin && !child.stdin.destroyed) {
					child.stdin.end();
				}
			} catch (err) {
				debugLogger.logDebug('cli-agent', `Failed to immediately close stdin: ${err}`);
			}
		}

		let timeoutTimer: number | null = null;

		if (timeoutMs && timeoutMs > 0) {
			timeoutTimer = window.setTimeout(() => {
				debugLogger.logWarn('cli-agent', `Process timeout (${timeoutMs}ms) exceeded for: ${resolvedCommand}`);
				ProcessManager.killProcess(child);
			}, timeoutMs);
		}

		if (signal) {
			signal.addEventListener('abort', () => {
				debugLogger.logDebug('cli-agent', `Abort signal received for process: ${resolvedCommand}`);
				ProcessManager.killProcess(child);
			});
		}

		const exitPromise = new Promise<{ exitCode: number; signal?: string }>((resolve) => {
			child.on('close', (code, sig) => {
				if (timeoutTimer !== null) {
					window.clearTimeout(timeoutTimer);
					timeoutTimer = null;
				}
				debugLogger.logDebug('cli-agent', `Process closed: ${resolvedCommand} (code: ${code}, signal: ${sig})`);
				resolve({ exitCode: code ?? 0, signal: sig ?? undefined });
			});

			child.on('error', (err) => {
				if (timeoutTimer !== null) {
					window.clearTimeout(timeoutTimer);
					timeoutTimer = null;
				}
				debugLogger.logError('cli-agent', `Process error for ${resolvedCommand}: ${err.message}`);
				resolve({ exitCode: -1, signal: err.message });
			});
		});

		return {
			process: child,
			onStdout(cb: (data: string) => void) {
				child.stdout?.on('data', (chunk: Buffer | string) => {
					cb(chunk.toString('utf-8'));
				});
			},
			onStderr(cb: (data: string) => void) {
				child.stderr?.on('data', (chunk: Buffer | string) => {
					cb(chunk.toString('utf-8'));
				});
			},
			writeStdin(data: string) {
				try {
					if (child.stdin && !child.stdin.destroyed) {
						child.stdin.write(data);
					}
				} catch (err) {
					debugLogger.logError('cli-agent', `Failed to write to stdin: ${err}`);
				}
			},
			closeStdin() {
				try {
					if (child.stdin && !child.stdin.destroyed) {
						child.stdin.end();
					}
				} catch (err) {
					debugLogger.logError('cli-agent', `Failed to close stdin: ${err}`);
				}
			},
			waitForExit() {
				return exitPromise;
			},
			kill() {
				ProcessManager.killProcess(child);
			},
		};
	}

	/**
	 * 프로세스를 안전하게 종료합니다.
	 */
	public static killProcess(child: ChildProcess): void {
		try {
			if (!child.killed && child.pid) {
				const spawnFn = getSpawnFunction();
				if (process.platform === 'win32' && spawnFn) {
					debugLogger.logDebug('cli-agent', `Terminating Windows process tree for PID ${child.pid} via taskkill`);
					spawnFn('taskkill', ['/pid', child.pid.toString(), '/f', '/t'], { windowsHide: true });
				} else {
					debugLogger.logDebug('cli-agent', `Terminating process PID ${child.pid} via SIGTERM`);
					child.kill('SIGTERM');
					// 3초 후 강제 SIGKILL 백업
					window.setTimeout(() => {
						try {
							if (!child.killed) {
								debugLogger.logDebug('cli-agent', `Process PID ${child.pid} still alive after 3s, sending SIGKILL`);
								child.kill('SIGKILL');
							}
						} catch {
							// 이미 종료된 경우 무시
						}
					}, 3000);
				}
			}
		} catch (e) {
			debugLogger.logError('cli-agent', `Error killing process: ${e instanceof Error ? e.message : String(e)}`);
		}
	}
}
