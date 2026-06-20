import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpSandbox } from './mcpSandbox';

describe('McpSandbox', () => {
    // Note: Vitest in JSDOM/Node environment doesn't have a real Web Worker by default,
    // or it might use Node's worker_threads under the hood.
    // If it fails due to Worker not defined, we might need to mock it or skip in standard CI,
    // but typically Vitest can handle basic blobs.

    const runTest = typeof Worker !== 'undefined' ? it : it.skip;

    runTest('should execute basic code and return result', async () => {
        const code = `return context.a + context.b;`;
        const result = await McpSandbox.executeCode<number>(code, { a: 5, b: 10 });
        
        expect(result.success).toBe(true);
        expect(result.data).toBe(15);
    });

    runTest('should catch errors thrown in code', async () => {
        const code = `throw new Error('Test error');`;
        const result = await McpSandbox.executeCode(code);
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('Test error');
    });

    runTest('should prevent network access (CSP equivalent)', async () => {
        // If we try to use fetch, it should be null/undefined or throw
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

    runTest('should timeout on infinite loops', async () => {
        const code = `while(true) {}`;
        // Use a short timeout for the test
        const result = await McpSandbox.executeCode(code, {}, { timeoutMs: 100 });
        
        expect(result.success).toBe(false);
        expect(result.error).toContain('timed out');
    });
});
