import type {
	CliAgentType,
	CliExecuteOptions,
	CliExecution,
	CliEvent,
} from '../../../shared/types/cliAgent.types';
import { ProcessManager, getDefaultCwd, type ProcessStreams } from './process-manager';
import { NdjsonParser } from './ndjson-parser';

export interface CliAgentConfig {
	id: string;
	type: CliAgentType;
	binaryPath: string;
	defaultModel?: string;
	autoApprove: boolean;
	allowedTools?: string[];
	extraArgs?: string[];
	env?: Record<string, string>;
	timeoutSeconds?: number;
	isVerified: boolean;
}

/**
 * 비동기 이벤트 큐 - 스트리밍 이벤트를 AsyncIterable로 소비할 수 있게 해주는 유틸리티
 */
class AsyncEventQueue<T> {
	private queue: T[] = [];
	private resolvers: Array<(value: IteratorResult<T>) => void> = [];
	private isDone = false;

	public push(item: T): void {
		if (this.isDone) return;
		if (this.resolvers.length > 0) {
			const resolve = this.resolvers.shift()!;
			resolve({ value: item, done: false });
		} else {
			this.queue.push(item);
		}
	}

	public close(): void {
		if (this.isDone) return;
		this.isDone = true;
		while (this.resolvers.length > 0) {
			const resolve = this.resolvers.shift()!;
			resolve({ value: undefined as unknown as T, done: true });
		}
	}

	public [Symbol.asyncIterator](): AsyncIterator<T> {
		return {
			next: (): Promise<IteratorResult<T>> => {
				if (this.queue.length > 0) {
					const value = this.queue.shift()!;
					return Promise.resolve({ value, done: false });
				}
				if (this.isDone) {
					return Promise.resolve({ value: undefined as unknown as T, done: true });
				}
				return new Promise<IteratorResult<T>>((resolve) => {
					this.resolvers.push(resolve);
				});
			},
		};
	}
}

/**
 * CLI Agent 기본 추상 클래스 (Template Method 패턴)
 */
export abstract class BaseCliAgent {
	abstract readonly displayName: string;

	protected config: CliAgentConfig;
	protected currentProcess: ProcessStreams | null = null;

	constructor(config: CliAgentConfig) {
		this.config = config;
	}

	/**
	 * 각 에이전트 CLI별 실행 인자(args)를 조립합니다.
	 */
	public abstract buildCommandArgs(prompt: string, options: CliExecuteOptions): string[];

	/**
	 * 각 에이전트 CLI가 출력하는 NDJSON 오브젝트를 통합 CliEvent로 변환합니다.
	 */
	protected abstract mapEvent(raw: unknown): CliEvent | CliEvent[] | null;

	/**
	 * 버전 체크 명령어 인자 (기본: ['--version'])
	 */
	protected getVersionArgs(): string[] {
		return ['--version'];
	}

	/**
	 * CLI 도구 사용 가능 여부 확인
	 */
	public async checkAvailability(cwd?: string): Promise<{ available: boolean; version?: string; error?: string }> {
		const binary = this.config.binaryPath || this.getDefaultBinary();
		try {
			const proc = ProcessManager.spawn({
				command: binary,
				args: this.getVersionArgs(),
				cwd: cwd || getDefaultCwd(),
				timeoutMs: 5000,
			});

			let output = '';
			let errorOutput = '';

			proc.onStdout((data) => {
				output += data;
			});
			proc.onStderr((data) => {
				errorOutput += data;
			});

			const exit = await proc.waitForExit();
			if (exit.exitCode === 0) {
				const version = output.trim() || 'Available';
				return { available: true, version };
			} else {
				return {
					available: false,
					error: errorOutput.trim() || `Process exited with code ${exit.exitCode}`,
				};
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			return { available: false, error: msg };
		}
	}

	/**
	 * 기본 바이너리 이름 반환
	 */
	protected abstract getDefaultBinary(): string;

	/**
	 * CLI 도구에서 사용 가능한 모델 목록을 CLI 바이너리로부터 100% 동적으로 조회합니다.
	 */
	public abstract listModels(): Promise<string[]>;

	/**
	 * 에이전트 실행
	 */
	public execute(prompt: string, options: CliExecuteOptions): CliExecution {
		const binary = this.config.binaryPath || this.getDefaultBinary();
		const args = this.buildCommandArgs(prompt, options);

		if (this.config.extraArgs && this.config.extraArgs.length > 0) {
			args.push(...this.config.extraArgs);
		}

		const eventQueue = new AsyncEventQueue<CliEvent>();
		const parser = new NdjsonParser();

		const proc = ProcessManager.spawn({
			command: binary,
			args,
			cwd: options.cwd || getDefaultCwd(),
			env: {
				...this.config.env,
				...options.env,
			},
			timeoutMs: (this.config.timeoutSeconds || 300) * 1000,
			signal: options.signal,
			closeStdin: true,
		});

		this.currentProcess = proc;

		proc.onStdout((chunk) => {
			eventQueue.push({
				type: 'raw_log',
				content: chunk,
			});
			const items = parser.parseChunk(chunk);
			for (const item of items) {
				const events = this.mapEvent(item);
				if (Array.isArray(events)) {
					for (const ev of events) {
						if (ev) eventQueue.push(ev);
					}
				} else if (events) {
					eventQueue.push(events);
				}
			}
		});

		let stderrBuffer = '';
		proc.onStderr((chunk) => {
			stderrBuffer += chunk;
			eventQueue.push({
				type: 'raw_log',
				content: chunk,
			});
			const trimmed = chunk.trim();
			if (trimmed) {
				eventQueue.push({
					type: 'status',
					content: trimmed,
				});
			}
		});

		const exitPromise = proc.waitForExit().then((exitResult) => {
			// 남아있는 버퍼 flush
			const flushed = parser.flush();
			for (const item of flushed) {
				const events = this.mapEvent(item);
				if (Array.isArray(events)) {
					for (const ev of events) {
						if (ev) eventQueue.push(ev);
					}
				} else if (events) {
					eventQueue.push(events);
				}
			}
			if (exitResult.exitCode !== 0) {
				const errMessage = stderrBuffer.trim() || `CLI process exited with code ${exitResult.exitCode}`;
				eventQueue.push({
					type: 'error',
					content: errMessage,
				});
			}
			eventQueue.close();
			this.currentProcess = null;
			return exitResult;
		});

		return {
			events: {
				[Symbol.asyncIterator]: () => eventQueue[Symbol.asyncIterator](),
			},
			waitForExit: () => exitPromise,
			writeStdin: (data: string) => {
				proc.writeStdin(data);
			},
			kill: () => {
				proc.kill();
			},
		};
	}

	public abort(): void {
		if (this.currentProcess) {
			this.currentProcess.kill();
			this.currentProcess = null;
		}
	}
}
