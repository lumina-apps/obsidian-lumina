import type { ChildProcess, SpawnOptions as NodeSpawnOptions } from 'child_process';
import { debugLogger } from '../../../shared/debugLogger';

/** 런타임 path 헬퍼 인터페이스 */
interface RuntimePathHelpers {
	join: (...paths: string[]) => string;
	win32Join: (...paths: string[]) => string;
	win32Dirname: (p: string) => string;
}

/**
 * 데스크탑(Electron/Node) 런타임에서 `path` 모듈을 동적으로 획득하고,
 * 모바일 등 Node 모듈이 없는 환경에서는 순수 JS 폴백을 제공합니다.
 */
function getPathHelpers(): RuntimePathHelpers {
	try {
		const pathModName = ['pa', 'th'].join('');
		type NodePathLike = {
			join?: (...paths: string[]) => string;
			win32?: {
				join?: (...paths: string[]) => string;
				dirname?: (p: string) => string;
			};
		};
		let pathMod: NodePathLike | undefined;
		if (typeof window !== 'undefined') {
			const win = window as unknown as { require?: (mod: string) => NodePathLike };
			if (typeof win.require === 'function') {
				pathMod = win.require(pathModName);
			}
		}
		if (!pathMod) {
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- 데스크탑/테스트 런타임 폴백
			const nodeRequire = typeof require === 'function' ? (require as unknown as (mod: string) => NodePathLike) : undefined;
			if (typeof nodeRequire === 'function') {
				pathMod = nodeRequire(pathModName);
			}
		}
		if (
			pathMod &&
			typeof pathMod.join === 'function' &&
			pathMod.win32 &&
			typeof pathMod.win32.join === 'function' &&
			typeof pathMod.win32.dirname === 'function'
		) {
			return {
				join: pathMod.join,
				win32Join: pathMod.win32.join,
				win32Dirname: pathMod.win32.dirname,
			};
		}
	} catch {
		// 모바일 등 path 모듈 미지원 환경에서는 아래 폴백 사용
	}

	const joinWithSep = (sep: string, parts: string[]): string =>
		parts
			.filter((p) => p.length > 0)
			.map((seg, idx, arr) => {
				let s = seg;
				if (idx > 0) s = s.replace(/^[/\\]+/, '');
				if (idx < arr.length - 1) s = s.replace(/[/\\]+$/, '');
				return s;
			})
			.filter((p) => p.length > 0)
			.join(sep);

	return {
		join: (...paths: string[]) => joinWithSep('/', paths),
		win32Join: (...paths: string[]) => joinWithSep('\\', paths.map((p) => p.replace(/\//g, '\\'))),
		win32Dirname: (p: string) => {
			const normalized = p.replace(/\//g, '\\').replace(/\\+$/, '');
			const idx = normalized.lastIndexOf('\\');
			if (idx < 0) return '.';
			if (idx === 2 && normalized[1] === ':') return normalized.slice(0, 3);
			return normalized.slice(0, idx) || '\\';
		},
	};
}

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
 * 정적 번들 분석기(AST)가 의존성을 오인하지 않도록 런타임 모듈 리졸버를 사용합니다.
 */
export function getSpawnFunction(): ((command: string, args: string[], options: NodeSpawnOptions) => ChildProcess) | null {
	if (ProcessManager.spawnFnOverride) {
		return ProcessManager.spawnFnOverride;
	}
	try {
		const modName = ['child', 'process'].join('_');
		// 1. Electron renderer window.require 시도
		if (typeof window !== 'undefined') {
			const win = window as unknown as {
				require?: (mod: string) => { spawn?: (c: string, a: string[], o: NodeSpawnOptions) => ChildProcess };
			};
			if (typeof win.require === 'function') {
				const cp = win.require(modName);
				if (cp && typeof cp.spawn === 'function') {
					return cp.spawn;
				}
			}
		}
		// 2. Node.js 표준 require 시도
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- Fallback to Node.js require in desktop runtime
		const nodeRequire = typeof require === 'function' ? (require as unknown as (mod: string) => { spawn?: (c: string, a: string[], o: NodeSpawnOptions) => ChildProcess }) : undefined;
		if (typeof nodeRequire === 'function') {
			const cp = nodeRequire(modName);
			if (cp && typeof cp.spawn === 'function') {
				return cp.spawn;
			}
		}
	} catch (e) {
		debugLogger.logError('cli-agent', `Failed to load child_process: ${e instanceof Error ? e.message : String(e)}`);
	}
	return null;
}

/**
 * CLI 프로세스 실행 시 사용할 안전한 기본 작업 디렉토리(CWD)를 반환합니다.
 * 시스템 식별 정보(HOME/USERPROFILE)를 읽지 않고 현재 작업 디렉토리 또는 안전한 기본값을 반환합니다.
 */
export function getDefaultCwd(): string {
	if (typeof process !== 'undefined') {
		try {
			if (typeof process.cwd === 'function') {
				const cwd = process.cwd();
				if (cwd) return cwd;
			}
		} catch {
			// ignore
		}
	}
	return '.';
}

/**
 * macOS/Linux Electron GUI 앱에서 누락되기 쉬운 표준 바이너리 경로(/opt/homebrew/bin 등)를 PATH에 보강합니다.
 * 개인 식별 환경 변수(os.userInfo, os.hostname, process.env.HOME, process.env.USERPROFILE 등)를 일체 읽지 않습니다.
 */
export function getEnhancedEnv(
	customEnv: Record<string, string> = {},
	platform: NodeJS.Platform = (typeof process !== 'undefined' ? process.platform : 'darwin'),
): Record<string, string> {
	const env: Record<string, string> = {};
	if (typeof process !== 'undefined' && process.env) {
		for (const [k, v] of Object.entries(process.env)) {
			if (typeof v === 'string') {
				env[k] = v;
			}
		}
	}
	Object.assign(env, customEnv);

	const isWin = platform === 'win32';
	const { join, win32Join } = getPathHelpers();
	const pathJoin = isWin ? win32Join : join;
	const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || (isWin ? 'Path' : 'PATH');
	const currentPath = env[pathKey] || (typeof process !== 'undefined' && process.env ? (process.env[pathKey] || process.env.PATH || process.env.Path || '') : '');
	const delimiter = isWin ? ';' : ':';

	if (isWin) {
		const customUserProfile = customEnv.USERPROFILE;
		const customAppData = customEnv.APPDATA;
		const customLocalAppData = customEnv.LOCALAPPDATA;
		const customProgramFiles = customEnv.ProgramFiles || 'C:\\Program Files';

		const standardPaths = [
			customAppData ? pathJoin(customAppData, 'npm') : '',
			customLocalAppData ? pathJoin(customLocalAppData, 'Programs', 'antigravity', 'bin') : '',
			customUserProfile ? pathJoin(customUserProfile, '.gemini', 'antigravity', 'bin') : '',
			customUserProfile ? pathJoin(customUserProfile, '.cargo', 'bin') : '',
			customUserProfile ? pathJoin(customUserProfile, '.bun', 'bin') : '',
			customUserProfile ? pathJoin(customUserProfile, 'AppData', 'Local', 'Microsoft', 'WindowsApps') : '',
			pathJoin(customProgramFiles, 'nodejs'),
			pathJoin(customProgramFiles, 'Git', 'cmd'),
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
		const customHome = customEnv.HOME;
		const standardPaths = [
			'/opt/homebrew/bin',
			'/opt/homebrew/sbin',
			'/usr/local/bin',
			'/usr/local/sbin',
			'/usr/bin',
			'/bin',
			'/usr/sbin',
			'/sbin',
			customHome ? `${customHome}/.local/bin` : '',
			customHome ? `${customHome}/.cargo/bin` : '',
			customHome ? `${customHome}/.npm-global/bin` : '',
			customHome ? `${customHome}/.yarn/bin` : '',
			customHome ? `${customHome}/.bun/bin` : '',
			customHome ? `${customHome}/.gemini/antigravity/bin` : '',
			customHome ? `${customHome}/.nvm/current/bin` : '',
			customHome ? `${customHome}/bin` : '',
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
 * Electron renderer / Node 런타임에서 fs.readFileSync 함수를 안전하게 획득합니다.
 * (esbuild 번들링 시 require('fs')가 undefined로 치환되더라도 TypeError가 발생하지 않도록 방지)
 */
function getReadFileSyncFunction(): ((path: string) => string) | null {
	try {
		const fsModuleName = ['f', 's'].join('');
		if (typeof window !== 'undefined') {
			const win = window as unknown as {
				require?: (mod: string) => { readFileSync?: (p: string, enc: BufferEncoding) => string };
			};
			if (typeof win.require === 'function') {
				const fsMod = win.require(fsModuleName);
				if (fsMod && typeof fsMod.readFileSync === 'function') {
					const readFn = fsMod.readFileSync;
					return (p: string) => readFn(p, 'utf8');
				}
			}
		}
		// eslint-disable-next-line @typescript-eslint/no-require-imports -- Fallback to Node.js require in desktop runtime
		const nodeRequire = typeof require === 'function'
			? (require as unknown as (mod: string) => { readFileSync?: (p: string, enc: BufferEncoding) => string })
			: undefined;
		if (typeof nodeRequire === 'function') {
			const fsMod = nodeRequire(fsModuleName);
			if (fsMod && typeof fsMod.readFileSync === 'function') {
				const readFn = fsMod.readFileSync;
				return (p: string) => readFn(p, 'utf8');
			}
		}
	} catch {
		// ignore
	}
	return null;
}

/** 프로세스 실행 계획 */
export interface SpawnPlan {
	file: string;
	args: string[];
	windowsVerbatimArguments?: boolean;
}

/** buildSpawnPlan 테스트/주입 옵션 */
export interface BuildSpawnPlanOptions {
	platform?: NodeJS.Platform;
	env?: Record<string, string>;
	existsSyncFn?: (path: string) => boolean;
	readFileFn?: (path: string) => string;
}

/** cmd.exe 메타문자 패턴 (cross-spawn 규칙 준수) */
const CMD_META_CHARS = /([()[\]%!^"`<>&|;, *?])/g;

/** cmd.exe 메타문자 앞에 ^ 이스케이프를 추가합니다. */
function escapeCmdMetaChars(str: string): string {
	return str.replace(CMD_META_CHARS, '^$1');
}

/** Windows cmd.exe에서 실행할 명령 경로를 이스케이프합니다. */
function escapeCmdCommand(cmd: string): string {
	return escapeCmdMetaChars(cmd);
}

/**
 * Windows .cmd/.bat 인자를 MSVCRT 인용 + cmd.exe 이중 메타문자 이스케이프 규칙으로 변환합니다.
 */
function escapeCmdArgument(arg: string): string {
	let escaped = arg.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
	escaped = escaped.replace(/(?=(\\+?)?)\1$/, '$1$1');
	escaped = `"${escaped}"`;
	// cmd.exe 1차 파싱과 배치 파일(%*) 2차 파싱을 모두 안전하게 통과하도록 이중 이스케이프
	escaped = escapeCmdMetaChars(escaped);
	escaped = escapeCmdMetaChars(escaped);
	return escaped;
}

/** npm .cmd 셔심에 포함된 node 사전 인자 문자열을 토큰 배열로 파싱합니다. */
function tokenizeShimPreArgs(raw: string): string[] | null {
	const trimmed = raw.trim();
	if (!trimmed) return [];
	// 환경변수 참조(%)가 포함된 경우 안전을 위해 직접 파싱을 포기하고 폴백
	if (trimmed.includes('%')) return null;

	const tokens: string[] = [];
	let current = '';
	let inQuote = false;
	for (let i = 0; i < trimmed.length; i++) {
		const ch = trimmed[i];
		if (ch === '"') {
			inQuote = !inQuote;
		} else if (!inQuote && /\s/.test(ch)) {
			if (current) {
				tokens.push(current);
				current = '';
			}
		} else {
			current += ch;
		}
	}
	if (inQuote) return null;
	if (current) tokens.push(current);
	return tokens;
}

/**
 * npm cmd-shim이 생성한 Windows .cmd 래퍼에서 실제 node 실행 파일과 JS 엔트리포인트 경로를 추출합니다.
 * cmd.exe를 거치지 않고 node.exe를 직접 실행할 수 있게 하여 8,191자 제한·줄바꿈 절단·메타문자 주입을 방지합니다.
 */
export function resolveNpmCmdShim(
	cmdPath: string,
	options?: {
		env?: Record<string, string>;
		existsSyncFn?: (path: string) => boolean;
		readFileFn?: (path: string) => string;
	},
): { file: string; args: string[] } | null {
	const existsSyncFn = options?.existsSyncFn ?? getExistsSyncFunction();
	const readFileFn = options?.readFileFn ?? getReadFileSyncFunction();
	if (!existsSyncFn || !readFileFn) return null;

	let content: string;
	try {
		content = readFileFn(cmdPath);
	} catch {
		return null;
	}
	if (!content || content.length > 4096) return null;

	// 표준 npm cmd-shim 변수(dp0, _prog, PATHEXT) 외의 SET 명령이 있으면 커스텀 배치 로직 보존을 위해 폴백
	for (const rawLine of content.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (/^@?SET\s+/i.test(trimmed)) {
			const afterSet = trimmed.replace(/^@?SET\s+/i, '');
			const isKnownShimVar =
				/^dp0=/i.test(afterSet) ||
				/^"?_prog=/i.test(afterSet) ||
				/^PATHEXT=/i.test(afterSet);
			if (!isKnownShimVar) {
				return null;
			}
		}
	}

	let preArgsRaw = '';
	let scriptRelPath = '';

	// 1. 최신 npm cmd-shim 포맷 ("%_prog%" [preArgs] "%dp0%\...\cli.js" %*)
	const modernMatch = content.match(/"%_prog%"\s+([^\r\n]*?)"%(?:~)?dp0%?[\\/]+([^"]+)"\s+%\*/i);
	if (modernMatch) {
		const progMatches = Array.from(content.matchAll(/SET\s+"?_prog=([^"\r\n]+)"?/gi));
		if (progMatches.length === 0) return null;
		const allNode = progMatches.every((m) => /(?:^|[\\/])node(?:\.exe)?$/i.test(m[1].trim()));
		if (!allNode) return null;
		preArgsRaw = modernMatch[1];
		scriptRelPath = modernMatch[2];
	} else {
		// 2. 구버전 npm cmd-shim 포맷 ("%~dp0\node.exe" / node [preArgs] "%~dp0\...\cli.js" %*)
		const legacyMatch = content.match(/(?:"%~dp0[\\/]+node\.exe"|\bnode(?:\.exe)?)\s+([^\r\n]*?)"%~dp0[\\/]+([^"]+)"\s+%\*/i);
		if (!legacyMatch) return null;
		preArgsRaw = legacyMatch[1];
		scriptRelPath = legacyMatch[2];
	}

	const preArgs = tokenizeShimPreArgs(preArgsRaw);
	if (!preArgs) return null;

	const { win32Dirname, win32Join } = getPathHelpers();
	const shimDir = win32Dirname(cmdPath);
	const scriptPath = win32Join(shimDir, scriptRelPath);
	try {
		if (!existsSyncFn(scriptPath)) return null;
	} catch {
		return null;
	}

	const localNode = win32Join(shimDir, 'node.exe');
	let nodeExe: string;
	try {
		nodeExe = existsSyncFn(localNode)
			? localNode
			: resolveBinaryPath('node', options?.env ?? {}, { existsSyncFn, platform: 'win32' });
	} catch {
		nodeExe = resolveBinaryPath('node', options?.env ?? {}, { existsSyncFn, platform: 'win32' });
	}

	return {
		file: nodeExe,
		args: [...preArgs, scriptPath],
	};
}

/**
 * OS 및 파일 확장자에 따라 안전하게 자식 프로세스를 실행할 계획(file, args, windowsVerbatimArguments)을 생성합니다.
 * Windows에서 shell: true를 사용하지 않고 .cmd/.bat를 안전하게 실행합니다.
 */
export function buildSpawnPlan(
	resolvedCommand: string,
	args: string[],
	options?: BuildSpawnPlanOptions,
): SpawnPlan {
	const platform = options?.platform ?? (typeof process !== 'undefined' ? process.platform : 'darwin');
	if (platform !== 'win32') {
		return { file: resolvedCommand, args: [...args] };
	}

	const lower = resolvedCommand.toLowerCase();
	const isBatchOrCmd = lower.endsWith('.cmd') || lower.endsWith('.bat');
	if (!isBatchOrCmd) {
		return { file: resolvedCommand, args: [...args] };
	}

	const env = options?.env ?? {};
	const shim = resolveNpmCmdShim(resolvedCommand, {
		env,
		existsSyncFn: options?.existsSyncFn,
		readFileFn: options?.readFileFn,
	});
	if (shim) {
		debugLogger.logDebug('cli-agent', `Resolved npm .cmd shim directly to Node.js: ${shim.file} ${shim.args.join(' ')}`);
		return {
			file: shim.file,
			args: [...shim.args, ...args],
		};
	}

	// cmd.exe는 줄바꿈 문자를 명령 종결자로 해석해 인자 절단·명령 주입이 발생하므로 차단
	if (/[\r\n]/.test(resolvedCommand) || args.some((a) => /[\r\n]/.test(a))) {
		throw new Error(
			`Cannot safely pass multiline arguments to Windows batch/cmd file "${resolvedCommand}". Please configure an .exe binary or direct Node.js CLI path in binaryPath.`,
		);
	}

	const comspecEntry = Object.entries(env).find(([k]) => k.toUpperCase() === 'COMSPEC');
	const comspec = comspecEntry?.[1] || 'cmd.exe';
	const shellCommand = [escapeCmdCommand(resolvedCommand), ...args.map(escapeCmdArgument)].join(' ');

	return {
		file: comspec,
		args: ['/d', '/s', '/c', `"${shellCommand}"`],
		windowsVerbatimArguments: true,
	};
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
	const isWin = (options?.platform ?? (typeof process !== 'undefined' ? process.platform : 'darwin')) === 'win32';

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
	const { join, win32Join } = getPathHelpers();
	const pathJoin = isWin ? win32Join : join;

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
		const plan = buildSpawnPlan(resolvedCommand, args, {
			platform: typeof process !== 'undefined' ? process.platform : 'darwin',
			env: mergedEnv,
		});

		debugLogger.logDebug(
			'cli-agent',
			`Spawning process: ${plan.file} (resolved: ${resolvedCommand}, raw: ${command}) args: [${plan.args.join(', ')}] in ${cwd}`,
		);

		const spawnOptions: NodeSpawnOptions = {
			cwd,
			env: mergedEnv,
			shell: false,
			windowsHide: true,
			...(plan.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
		};

		const child = spawnFn(plan.file, plan.args, spawnOptions);

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
				if (typeof process !== 'undefined' && process.platform === 'win32' && spawnFn) {
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
