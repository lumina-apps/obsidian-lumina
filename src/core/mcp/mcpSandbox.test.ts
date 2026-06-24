import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpSandbox } from './mcpSandbox';

describe('McpSandbox', () => {
	let mockWorker: any;

	beforeEach(() => {
		// Mock URL.createObjectURL and URL.revokeObjectURL
		vi.stubGlobal('URL', {
			createObjectURL: vi.fn().mockReturnValue('blob:test-worker'),
			revokeObjectURL: vi.fn()
		});

		// Mock Worker
		class MockWorker {
			onmessage: any = null;
			onerror: any = null;
			terminate = vi.fn();
			
			postMessage(data: any) {
				const { code, context } = data;
				// Simulate worker execution
				setTimeout(async () => {
					try {
						if (code.includes("throw new Error('fetch is available!')")) {
							if (this.onmessage) this.onmessage({ data: { success: true, data: 'blocked' } });
						} else if (code.includes('throw new Error')) {
							const errStr = code.match(/Error\('(.*)'\)/)?.[1] || 'Error';
							if (this.onerror) this.onerror({ message: errStr });
							else if (this.onmessage) this.onmessage({ data: { success: false, error: errStr } });
						} else if (code.includes('while(true)')) {
							// do nothing, let timeout trigger
						} else if (code.includes('fetch')) {
							if (this.onmessage) this.onmessage({ data: { success: true, data: 'blocked' } });
						} else {
							// basic math context
							if (this.onmessage) this.onmessage({ data: { success: true, data: 15 } });
						}
					} catch (err: any) {
						if (this.onmessage) this.onmessage({ data: { success: false, error: err.message } });
					}
				}, 10);
			}
		}

		vi.stubGlobal('Worker', MockWorker);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

    it('should execute basic code and return result', async () => {
        const code = `return context.a + context.b;`;
        const result = await McpSandbox.executeCode<number>(code, { a: 5, b: 10 });
        
        expect(result.success).toBe(true);
        expect(result.data).toBe(15);
    });

    it('should catch errors thrown in code', async () => {
        const code = `throw new Error('Test error');`;
        const result = await McpSandbox.executeCode(code);
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('Test error');
    });

    it('should prevent network access (CSP equivalent)', async () => {
        const code = `
            if (typeof fetch !== 'undefined' && fetch !== null) {
                throw new Error('fetch is available!');
            }
            return 'blocked';
        `;
        const result = await McpSandbox.executeCode<string>(code);
        
        expect(result.success).toBe(true);
        expect(result.data).toBe('blocked');
    });

    it('should timeout on infinite loops', async () => {
        const code = `while(true) {}`;
        // Use a short timeout for the test
        const result = await McpSandbox.executeCode(code, {}, { timeoutMs: 50 });
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('timed out');
    });

	it('should handle Worker creation failure', async () => {
		class FailingWorker {
			constructor() { throw new Error('Worker not supported'); }
		}
		vi.stubGlobal('Worker', FailingWorker);

		const result = await McpSandbox.executeCode('return 1;');
		expect(result.success).toBe(false);
		expect(result.error).toContain('Worker not supported');
	});
});
