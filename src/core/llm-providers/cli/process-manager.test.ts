import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ChildProcess } from 'child_process';
import {
	ProcessManager,
	getEnhancedEnv,
	resolveBinaryPath,
	getDefaultCwd,
	buildSpawnPlan,
} from './process-manager';

describe('ProcessManager Unit Tests', () => {
	describe('getEnhancedEnv - Cross-Platform Environment Enhancement', () => {
		it('macOS/Linux(darwin): standardPaths가 PATH에 누락 없이 보강된다', () => {
			const env = getEnhancedEnv({ HOME: '/Users/testuser' }, 'darwin');
			expect(env.PATH).toBeDefined();
			expect(env.PATH).toContain('/opt/homebrew/bin');
			expect(env.PATH).toContain('/usr/local/bin');
			expect(env.PATH).toContain('/Users/testuser/.gemini/antigravity/bin');
			expect(env.PATH).toContain('/Users/testuser/.cargo/bin');
		});

		it('Windows(win32): 세미콜론 구분자 및 주요 Windows 바이너리 경로가 보강된다', () => {
			const customEnv = {
				USERPROFILE: 'C:\\Users\\testuser',
				APPDATA: 'C:\\Users\\testuser\\AppData\\Roaming',
				LOCALAPPDATA: 'C:\\Users\\testuser\\AppData\\Local',
				ProgramFiles: 'C:\\Program Files',
				PATH: 'C:\\Windows\\system32',
			};

			const env = getEnhancedEnv(customEnv, 'win32');
			const delimiter = ';';
			const pathParts = (env.PATH || env.Path || '').split(delimiter);

			expect(pathParts).toContain('C:\\Users\\testuser\\AppData\\Roaming\\npm');
			expect(pathParts).toContain('C:\\Users\\testuser\\AppData\\Local\\Programs\\antigravity\\bin');
			expect(pathParts).toContain('C:\\Users\\testuser\\.gemini\\antigravity\\bin');
			expect(pathParts).toContain('C:\\Program Files\\nodejs');
			expect(pathParts).toContain('C:\\Program Files\\Git\\cmd');
		});

		it('Windows(win32): 대소문자 차이가 있는 기존 경로는 중복 추가되지 않는다', () => {
			const customEnv = {
				USERPROFILE: 'C:\\Users\\testuser',
				ProgramFiles: 'C:\\Program Files',
				PATH: 'c:\\program files\\nodejs;C:\\Windows\\system32',
			};

			const env = getEnhancedEnv(customEnv, 'win32');
			const parts = (env.PATH || '').split(';');
			const nodejsMatches = parts.filter(p => p.toLowerCase() === 'c:\\program files\\nodejs');
			expect(nodejsMatches.length).toBe(1);
		});

		it('사용자 커스텀 환경 변수가 온전히 유지된다', () => {
			const env = getEnhancedEnv({ ANTHROPIC_API_KEY: 'test-key', MY_CUSTOM_VAR: 'hello' }, 'darwin');
			expect(env.ANTHROPIC_API_KEY).toBe('test-key');
			expect(env.MY_CUSTOM_VAR).toBe('hello');
		});
	});

	describe('resolveBinaryPath - Binary Path Resolution', () => {
		it('경로 구분자가 포함된 바이너리가 존재하면 그대로 반환한다', () => {
			const mockExists = (p: string) => p === '/usr/local/bin/agy';
			const resolved = resolveBinaryPath('/usr/local/bin/agy', {}, { existsSyncFn: mockExists, platform: 'darwin' });
			expect(resolved).toBe('/usr/local/bin/agy');
		});

		it('Windows에서 경로 구분자가 포함된 바이너리에 확장자가 없을 때 .cmd 후보를 찾아낸다', () => {
			const mockExists = (p: string) => p === 'C:\\Tools\\claude.cmd';
			const resolved = resolveBinaryPath('C:\\Tools\\claude', {}, { existsSyncFn: mockExists, platform: 'win32' });
			expect(resolved).toBe('C:\\Tools\\claude.cmd');
		});

		it('Windows PATH에서 확장자 없는 명령어에 대해 .cmd / .exe / .bat 순서로 탐색한다', () => {
			const env = {
				PATH: 'C:\\npm;C:\\Tools',
			};
			const mockExists = (p: string) => p === 'C:\\npm\\agy.cmd';
			const resolved = resolveBinaryPath('agy', env, { existsSyncFn: mockExists, platform: 'win32' });
			expect(resolved).toBe('C:\\npm\\agy.cmd');
		});

		it('PATH에서 바이너리를 찾지 못하면 원본 명령어를 반환한다', () => {
			const env = { PATH: '/bin:/usr/bin' };
			const mockExists = () => false;
			const resolved = resolveBinaryPath('nonexistent-tool', env, { existsSyncFn: mockExists, platform: 'darwin' });
			expect(resolved).toBe('nonexistent-tool');
		});
	});

	describe('buildSpawnPlan - Windows Safe Execution & npm .cmd Shim Resolution', () => {
		const modernNpmShim = [
			'@ECHO off',
			'GOTO start',
			':find_dp0',
			'SET dp0=%~dp0',
			'EXIT /b',
			':start',
			'SETLOCAL',
			'CALL :find_dp0',
			'',
			'IF EXIST "%dp0%\\node.exe" (',
			'  SET "_prog=%dp0%\\node.exe"',
			') ELSE (',
			'  SET "_prog=node"',
			'  SET PATHEXT=%PATHEXT:;.JS;=;%',
			')',
			'',
			'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*',
		].join('\r\n');

		it('비 Windows(darwin/linux) 환경에서는 원본 명령과 인자를 그대로 반환한다', () => {
			const plan = buildSpawnPlan('/usr/local/bin/claude', ['-p', 'line1\nline2 & echo hi'], {
				platform: 'darwin',
			});
			expect(plan).toEqual({
				file: '/usr/local/bin/claude',
				args: ['-p', 'line1\nline2 & echo hi'],
			});
		});

		it('Windows .exe 바이너리는 cmd.exe를 거치지 않고 직접 실행 계획을 반환한다', () => {
			const plan = buildSpawnPlan('C:\\Program Files\\Claude\\claude.exe', ['-p', 'hello\nworld & | %PATH%'], {
				platform: 'win32',
			});
			expect(plan).toEqual({
				file: 'C:\\Program Files\\Claude\\claude.exe',
				args: ['-p', 'hello\nworld & | %PATH%'],
			});
		});

		it('Windows에서 확장자가 없는 미해석 명령어도 shell 없이 직접 실행 계획을 반환한다', () => {
			const plan = buildSpawnPlan('nonexistent-cli', ['--version'], {
				platform: 'win32',
			});
			expect(plan).toEqual({
				file: 'nonexistent-cli',
				args: ['--version'],
			});
		});

		it('Windows npm .cmd 셔심에서 같은 폴더의 node.exe와 대상 스크립트를 직접 실행하도록 변환한다', () => {
			const cmdPath = 'C:\\Users\\test\\AppData\\Roaming\\npm\\claude.cmd';
			const localNode = 'C:\\Users\\test\\AppData\\Roaming\\npm\\node.exe';
			const scriptPath = 'C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js';
			const multilinePrompt = '첫째 줄 "인용"\n둘째 줄 & calc.exe | %USERPROFILE% ^ test';

			const plan = buildSpawnPlan(cmdPath, ['-p', multilinePrompt], {
				platform: 'win32',
				env: { PATH: 'C:\\Windows\\System32' },
				existsSyncFn: (p) => p === localNode || p === scriptPath,
				readFileFn: (p) => (p === cmdPath ? modernNpmShim : ''),
			});

			expect(plan).toEqual({
				file: localNode,
				args: [scriptPath, '-p', multilinePrompt],
			});
		});

		it('Windows npm .cmd 셔심에 node 사전 인자가 있고 PATH의 node.exe를 사용하는 경우 올바르게 변환한다', () => {
			const cmdPath = 'C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd';
			const pathNode = 'C:\\Program Files\\nodejs\\node.exe';
			const scriptPath = 'C:\\Users\\test\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js';
			const shimWithPreArgs = modernNpmShim
				.replace('"%_prog%"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js"', '"%_prog%" --no-deprecation "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js"');

			const plan = buildSpawnPlan(cmdPath, ['exec', 'multi\nline'], {
				platform: 'win32',
				env: { PATH: 'C:\\Program Files\\nodejs;C:\\Windows\\System32' },
				existsSyncFn: (p) => p === pathNode || p === scriptPath,
				readFileFn: (p) => (p === cmdPath ? shimWithPreArgs : ''),
			});

			expect(plan).toEqual({
				file: pathNode,
				args: ['--no-deprecation', scriptPath, 'exec', 'multi\nline'],
			});
		});

		it('구버전 npm .cmd 셔심 포맷(%~dp0)도 정상적으로 파싱한다', () => {
			const legacyShim = [
				'@IF EXIST "%~dp0\\node.exe" (',
				'  "%~dp0\\node.exe"  "%~dp0\\node_modules\\tool\\cli.js" %*',
				') ELSE (',
				'  @SETLOCAL',
				'  @SET PATHEXT=%PATHEXT:;.JS;=;%',
				'  node  "%~dp0\\node_modules\\tool\\cli.js" %*',
				')',
			].join('\r\n');
			const cmdPath = 'C:\\npm\\tool.cmd';
			const pathNode = 'C:\\Program Files\\nodejs\\node.exe';
			const scriptPath = 'C:\\npm\\node_modules\\tool\\cli.js';

			const plan = buildSpawnPlan(cmdPath, ['--version'], {
				platform: 'win32',
				env: { PATH: 'C:\\Program Files\\nodejs' },
				existsSyncFn: (p) => p === pathNode || p === scriptPath,
				readFileFn: (p) => (p === cmdPath ? legacyShim : ''),
			});

			expect(plan).toEqual({
				file: pathNode,
				args: [scriptPath, '--version'],
			});
		});

		it('파싱 불가한 일반 .cmd/.bat 파일은 단일 줄 인자에 대해 cmd.exe 이스케이프 + windowsVerbatimArguments로 폴백한다', () => {
			const cmdPath = 'C:\\Program Files\\My Tools\\custom.cmd';
			const customBatch = '@echo off\r\nmy-binary.exe %*\r\n';

			const plan = buildSpawnPlan(cmdPath, ['-p', 'hello "world" & | %PATH% ^ test'], {
				platform: 'win32',
				env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
				existsSyncFn: (p) => p === cmdPath,
				readFileFn: () => customBatch,
			});

			expect(plan.file).toBe('C:\\Windows\\System32\\cmd.exe');
			expect(plan.windowsVerbatimArguments).toBe(true);
			expect(plan.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
			const cmdLine = plan.args[3];
			expect(cmdLine.startsWith('"') && cmdLine.endsWith('"')).toBe(true);
			// 공백 경로와 메타문자(& | % ^ ")가 모두 이스케이프되어야 함
			expect(cmdLine).toContain('C:\\Program^ Files\\My^ Tools\\custom.cmd');
			expect(cmdLine).toContain('^^^&');
			expect(cmdLine).toContain('^^^|');
			expect(cmdLine).toContain('^^^%');
			expect(cmdLine).toContain('^^^^');
		});

		it('파싱 불가한 .cmd/.bat 파일에 줄바꿈 포함 인자가 전달되면 명령 주입 방지를 위해 에러를 던진다', () => {
			const cmdPath = 'C:\\Tools\\custom.cmd';
			const customBatch = '@echo off\r\nmy-binary.exe %*\r\n';

			expect(() =>
				buildSpawnPlan(cmdPath, ['-p', 'first line\nsecond line'], {
					platform: 'win32',
					existsSyncFn: (p) => p === cmdPath,
					readFileFn: () => customBatch,
				}),
			).toThrow(/multiline|binaryPath/i);
		});

		it('커스텀 SET 환경변수가 포함된 .cmd는 임의 파싱하지 않고 안전하게 폴백한다', () => {
			const cmdPath = 'C:\\Tools\\env-shim.cmd';
			const shimWithCustomSet = [
				'@ECHO off',
				'SET MY_SPECIAL_FLAG=1',
				'IF EXIST "%dp0%\\node.exe" (',
				'  SET "_prog=%dp0%\\node.exe"',
				') ELSE (',
				'  SET "_prog=node"',
				')',
				'"%_prog%" "%dp0%\\node_modules\\tool\\cli.js" %*',
			].join('\r\n');

			const plan = buildSpawnPlan(cmdPath, ['--version'], {
				platform: 'win32',
				existsSyncFn: () => true,
				readFileFn: () => shimWithCustomSet,
			});

			expect(plan.file).toBe('cmd.exe');
			expect(plan.windowsVerbatimArguments).toBe(true);
		});
	});

	describe('getDefaultCwd - Safe Working Directory Fallback', () => {
		it('process.cwd()가 있으면 현재 작업 디렉토리를 반환한다', () => {
			expect(getDefaultCwd()).toBe(process.cwd());
		});

		it('process.cwd 예외 또는 부재 시 "."으로 안전하게 폴백한다', () => {
			const origCwd = process.cwd;
			try {
				// @ts-expect-error simulate missing cwd
				process.cwd = undefined;
				expect(getDefaultCwd()).toBe('.');
			} finally {
				process.cwd = origCwd;
			}
		});
	});

	describe('ProcessManager.spawn & ProcessStreams Lifecycle', () => {
		let mockChild: ChildProcess & EventEmitter;
		let mockStdout: EventEmitter;
		let mockStderr: EventEmitter;
		let mockStdin: { write: ReturnType<typeof vi.fn>; destroyed: boolean; end: ReturnType<typeof vi.fn> };

		beforeEach(() => {
			mockStdout = new EventEmitter();
			mockStderr = new EventEmitter();
			mockStdin = { write: vi.fn(), destroyed: false, end: vi.fn() };

			mockChild = Object.assign(new EventEmitter(), {
				pid: 12345,
				killed: false,
				stdout: mockStdout,
				stderr: mockStderr,
				stdin: mockStdin,
				kill: vi.fn(),
			}) as unknown as ChildProcess & EventEmitter;

			ProcessManager.spawnFnOverride = vi.fn().mockReturnValue(mockChild);
		});

		afterEach(() => {
			ProcessManager.spawnFnOverride = null;
			vi.restoreAllMocks();
		});

		it('자식 프로세스를 스폰하고 stdout 스트림을 올바르게 전달한다', async () => {
			const streams = ProcessManager.spawn({
				command: 'echo',
				args: ['hello'],
				cwd: '/test/cwd',
			});

			const stdoutChunks: string[] = [];
			streams.onStdout((chunk) => {
				stdoutChunks.push(chunk);
			});

			mockStdout.emit('data', Buffer.from('hello world\n'));
			expect(stdoutChunks).toEqual(['hello world\n']);
		});

		it('stderr 스트림을 올바르게 전달한다', async () => {
			const streams = ProcessManager.spawn({
				command: 'echo',
				args: ['error'],
				cwd: '/test/cwd',
			});

			const stderrChunks: string[] = [];
			streams.onStderr((chunk) => {
				stderrChunks.push(chunk);
			});

			mockStderr.emit('data', Buffer.from('warning message'));
			expect(stderrChunks).toEqual(['warning message']);
		});

		it('writeStdin을 통해 stdin으로 데이터를 전송한다', () => {
			const streams = ProcessManager.spawn({
				command: 'cat',
				args: [],
				cwd: '/test/cwd',
			});

			streams.writeStdin('input data');
			expect(mockStdin.write).toHaveBeenCalledWith('input data');
		});

		it('closeStdin 옵션이 지정되면 즉시 stdin.end()를 호출한다', () => {
			ProcessManager.spawn({
				command: 'opencode',
				args: ['run'],
				cwd: '/test/cwd',
				closeStdin: true,
			});

			expect(mockStdin.end).toHaveBeenCalled();
		});

		it('streams.closeStdin() 호출 시 stdin.end()를 실행한다', () => {
			const streams = ProcessManager.spawn({
				command: 'cat',
				args: [],
				cwd: '/test/cwd',
			});

			streams.closeStdin();
			expect(mockStdin.end).toHaveBeenCalled();
		});

		it('프로세스가 정상 종료(close)되면 exitCode를 반환한다', async () => {
			const streams = ProcessManager.spawn({
				command: 'echo',
				args: [],
				cwd: '/test/cwd',
			});

			setTimeout(() => {
				mockChild.emit('close', 0, null);
			}, 10);

			const result = await streams.waitForExit();
			expect(result.exitCode).toBe(0);
		});

		it('프로세스 에러 발생 시 exitCode: -1과 에러 메시지를 반환한다', async () => {
			const streams = ProcessManager.spawn({
				command: 'faulty',
				args: [],
				cwd: '/test/cwd',
			});

			setTimeout(() => {
				mockChild.emit('error', new Error('Spawn failed: ENOENT'));
			}, 10);

			const result = await streams.waitForExit();
			expect(result.exitCode).toBe(-1);
			expect(result.signal).toBe('Spawn failed: ENOENT');
		});

		it('timeoutMs 초과 시 killProcess를 호출한다', async () => {
			vi.useFakeTimers();
			const killSpy = vi.spyOn(ProcessManager, 'killProcess');

			ProcessManager.spawn({
				command: 'sleep',
				args: ['100'],
				cwd: '/test/cwd',
				timeoutMs: 1000,
			});

			vi.advanceTimersByTime(1100);
			expect(killSpy).toHaveBeenCalledWith(mockChild);
			vi.useRealTimers();
		});

		it('AbortSignal 수신 시 killProcess를 호출한다', () => {
			vi.useFakeTimers();
			const killSpy = vi.spyOn(ProcessManager, 'killProcess');
			const controller = new AbortController();

			ProcessManager.spawn({
				command: 'sleep',
				args: ['100'],
				cwd: '/test/cwd',
				signal: controller.signal,
			});

			controller.abort();
			expect(killSpy).toHaveBeenCalledWith(mockChild);
			vi.useRealTimers();
		});

		it('Windows 환경에서 ProcessManager.spawn은 항상 shell: false로 실행한다', () => {
			const origPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
			try {
				ProcessManager.spawn({
					command: 'C:\\Tools\\claude.exe',
					args: ['-p', 'hello\nworld'],
					cwd: 'C:\\vault',
				});

				expect(ProcessManager.spawnFnOverride).toHaveBeenCalledWith(
					'C:\\Tools\\claude.exe',
					['-p', 'hello\nworld'],
					expect.objectContaining({
						cwd: 'C:\\vault',
						shell: false,
						windowsHide: true,
					}),
				);
			} finally {
				Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true });
			}
		});
	});

	describe('ProcessManager.killProcess - Platform Termination Strategy', () => {
		let mockChild: ChildProcess;

		beforeEach(() => {
			vi.useFakeTimers();
			mockChild = {
				pid: 99999,
				killed: false,
				kill: vi.fn(),
			} as unknown as ChildProcess;
		});

		afterEach(() => {
			vi.useRealTimers();
			ProcessManager.spawnFnOverride = null;
		});

		it('macOS/Linux 환경에서는 SIGTERM 시그널로 프로세스를 종료한다', () => {
			const origPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'darwin' });

			ProcessManager.killProcess(mockChild);
			expect(mockChild.kill).toHaveBeenCalledWith('SIGTERM');

			Object.defineProperty(process, 'platform', { value: origPlatform });
		});

		it('Windows 환경에서는 taskkill 명령어로 자식 트리 전체를 강제 종료(/f /t)한다', () => {
			const origPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'win32' });

			const mockTaskkillSpawn = vi.fn();
			ProcessManager.spawnFnOverride = mockTaskkillSpawn;

			ProcessManager.killProcess(mockChild);
			expect(mockTaskkillSpawn).toHaveBeenCalledWith(
				'taskkill',
				['/pid', '99999', '/f', '/t'],
				{ windowsHide: true },
			);

			Object.defineProperty(process, 'platform', { value: origPlatform });
		});
	});
});

