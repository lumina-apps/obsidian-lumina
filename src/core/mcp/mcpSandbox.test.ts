import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpSandbox } from './mcpSandbox';

describe('McpSandbox', () => {
	let capturedWorkerScript = '';

	beforeEach(() => {
		capturedWorkerScript = '';

		const OriginalBlob = globalThis.Blob;
		class CapturedBlob extends OriginalBlob {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			constructor(blobParts?: any[], options?: any) {
				super(blobParts, options);
				if (blobParts && blobParts.length > 0 && typeof blobParts[0] === 'string') {
					capturedWorkerScript = blobParts[0];
				}
			}
		}
		vi.stubGlobal('Blob', CapturedBlob);

		vi.stubGlobal('URL', {
			createObjectURL: vi.fn().mockReturnValue('blob:test-worker'),
			revokeObjectURL: vi.fn(),
		});

		class RealExecutingMockWorker {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			onmessage: any = null;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			onerror: any = null;
			terminate = vi.fn();
			private script: string;

			constructor(url: string) {
				if (url.startsWith('data:')) {
					this.script = decodeURIComponent(url.replace(/^data:application\/javascript,/, ''));
				} else {
					this.script = capturedWorkerScript;
				}
			}

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			postMessage(data: any) {
				const { code } = data;
				if (code.includes('while(true)') || code.includes('while (true)')) {
					// 무한 루프는 타임아웃 처리를 테스트하기 위해 의도적으로 응답하지 않음
					return;
				}

				setTimeout(async () => {
					try {
						// 실제 workerScript를 가상 self 환경에서 실행
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						const simulatedSelf: Record<string, any> = {
							// eslint-disable-next-line @typescript-eslint/no-explicit-any
							postMessage: (payload: any) => {
								if (this.onmessage) {
									this.onmessage({ data: payload });
								}
							},
							onmessage: null,
						};

						// workerScript 실행 (globalsToHide 정의 및 onmessage 등록)
						const initWorker = new Function('self', this.script);
						initWorker(simulatedSelf);

						if (typeof simulatedSelf.onmessage === 'function') {
							await simulatedSelf.onmessage({ data });
						}
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					} catch (err: any) {
						if (this.onmessage) {
							this.onmessage({ data: { success: false, error: err?.message || String(err) } });
						}
					}
				}, 5);
			}
		}

		vi.stubGlobal('Worker', RealExecutingMockWorker);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('should execute basic code and return computed result dynamically', async () => {
		const code = `return context.a * context.b + context.c;`;
		const result = await McpSandbox.executeCode<number>(code, { a: 6, b: 7, c: 8 });

		expect(result.success).toBe(true);
		expect(result.data).toBe(50);
	});

	it('should catch runtime errors thrown in code', async () => {
		const code = `throw new Error('Custom runtime failure');`;
		const result = await McpSandbox.executeCode(code);

		expect(result.success).toBe(false);
		expect(result.error).toContain('Custom runtime failure');
	});

	it('should enforce security sandbox by throwing when accessing network globals', async () => {
		// McpSandbox 실행을 트리거하여 workerScript 생성
		await McpSandbox.executeCode<number>('return 1;');

		expect(capturedWorkerScript).toContain('Network access is disabled in sandbox');
		expect(capturedWorkerScript).toContain('globalsToHide');

		// 실제 workerScript가 self에 globalsToHide를 올바르게 정의하고 에러를 던지는지 검증
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const simulatedSelf: Record<string, any> = { postMessage: vi.fn(), onmessage: null };
		const initWorker = new Function('self', capturedWorkerScript);
		initWorker(simulatedSelf);

		const dangerousGlobals = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'eval'];
		for (const g of dangerousGlobals) {
			expect(Object.getOwnPropertyDescriptor(simulatedSelf, g)).toBeDefined();
			expect(() => simulatedSelf[g]).toThrow('Network access is disabled in sandbox');
		}
	});

	it('should timeout on infinite loops and terminate worker', async () => {
		const code = `while(true) {}`;
		const result = await McpSandbox.executeCode(code, {}, { timeoutMs: 50 });

		expect(result.success).toBe(false);
		expect(result.error).toContain('timed out');
	});

	it('should fallback to data: URI when blob: URL creation fails, and succeed', async () => {
		let attempt = 0;
		class FallbackMockWorker {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			onmessage: any = null;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			onerror: any = null;
			terminate = vi.fn();
			private isDataUri: boolean;

			constructor(url: string) {
				attempt++;
				if (attempt === 1) {
					// 1차 시도 (blob: URL)는 CSP 등으로 실패 시뮬레이션
					throw new Error('CSP blocked blob URL');
				}
				this.isDataUri = url.startsWith('data:application/javascript');
			}

			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			postMessage(data: any) {
				setTimeout(() => {
					if (this.onmessage) {
						this.onmessage({ data: { success: true, data: this.isDataUri ? 'fallback-success' : 'failed' } });
					}
				}, 5);
			}
		}

		vi.stubGlobal('Worker', FallbackMockWorker);

		const result = await McpSandbox.executeCode<string>('return 1;');
		expect(result.success).toBe(true);
		expect(result.data).toBe('fallback-success');
	});

	it('should handle Worker creation failure when both blob: and data: fail', async () => {
		class FailingWorker {
			constructor() { throw new Error('Worker not supported at all'); }
		}
		vi.stubGlobal('Worker', FailingWorker);

		const result = await McpSandbox.executeCode('return 1;');
		expect(result.success).toBe(false);
		expect(result.error).toContain('Worker not supported at all');
	});
});
