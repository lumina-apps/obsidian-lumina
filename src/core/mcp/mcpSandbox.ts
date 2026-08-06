/**
 * mcpSandbox.ts
 * Web Worker 기반 코드 샌드박스 - 실행 시 보안 감사용 로깅 포함
 */
export interface SandboxOptions {
    timeoutMs?: number;
}

export interface SandboxResult<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
}

export class McpSandbox {
    private static readonly DEFAULT_TIMEOUT_MS = 10000;

    /**
     * Executes arbitrary JavaScript code securely in a Web Worker.
     * 
     * @param code The JavaScript code string to execute. It should return the desired output.
     * @param context Data to pass into the executing code as `context` variable.
     * @param options Sandbox configuration options (like timeout).
     */
    static async executeCode<T = unknown>(
        code: string,
        context: Record<string, unknown> = {},
        options: SandboxOptions = {}
    ): Promise<SandboxResult<T>> {
        const timeoutMs = options.timeoutMs ?? this.DEFAULT_TIMEOUT_MS;

        return new Promise((resolve) => {
            // 1. Create Web Worker Blob containing the execution logic and security overrides
            const workerScript = `
                // --- Security Sandbox Setup ---
                // Disable network access to prevent data exfiltration
                const globalsToHide = ['fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'eval'];
                globalsToHide.forEach(g => {
                    try {
                        Object.defineProperty(self, g, {
                            get: () => { throw new Error('Network access is disabled in sandbox'); },
                            configurable: false
                        });
                    } catch (e) {
                        // Log sandbox setup failure for security auditing and debugging
                        console.warn('[Lumina Sandbox] Failed to secure global: ' + g);
                    }
                });

                // --- Execution Logic ---
                self.onmessage = async function(e) {
                    const { code, context } = e.data;
                    try {
                        // Create an async function to allow 'await' inside the provided code
                        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
                        
                        // We wrap the code so it executes in a strict environment
                        // and returns its result
                        const fn = new AsyncFunction('context', '"use strict";\\n' + code);
                        
                        const result = await fn(context);
                        self.postMessage({ success: true, data: result });
                    } catch (err) {
                        self.postMessage({ success: false, error: err instanceof Error ? err.message : String(err) });
                    }
                };
            `;

            const blob = new Blob([workerScript], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(blob);
            
            let worker: Worker;
            try {
                worker = new Worker(workerUrl);
            } catch (err) {
                URL.revokeObjectURL(workerUrl);
                // CSP 차단 등 Blob URL Worker 실패 시 인라인 Worker 생성 시도
                try {
                    // data: URI를 통해 인라인 Worker 생성 (일부 CSP 정책에서 blob:보다 허용될 가능성 있음)
                    const encodedScript = encodeURIComponent(workerScript);
                    const dataWorkerUrl = 'data:application/javascript,' + encodedScript;
                    worker = new Worker(dataWorkerUrl);
                } catch (dataErr) {
                    return resolve({
                        success: false,
                        error: `Failed to create Web Worker (blob and data: URI both failed): ${err instanceof Error ? err.message : String(err)}. Data URI fallback error: ${dataErr instanceof Error ? dataErr.message : String(dataErr)}`
                    });
                }
            }

            // 2. Setup timeout and cleanup mechanism (Safety Net)
            let isResolved = false;
            let timeoutId: number | null = null;

            const cleanup = () => {
                if (timeoutId) {
                    window.clearTimeout(timeoutId);
                    timeoutId = null;
                }
                worker.terminate();
                URL.revokeObjectURL(workerUrl);
            };

            const finish = (result: SandboxResult<T>) => {
                if (isResolved) return;
                isResolved = true;
                cleanup();
                resolve(result);
            };

            // Start the timeout
            timeoutId = window.setTimeout(() => {
                finish({
                    success: false,
                    error: `Execution timed out after ${timeoutMs}ms`
                });
            }, timeoutMs);

            // 3. Listen for the result from the worker
            worker.onmessage = (e: MessageEvent) => {
                const payload = e.data as SandboxResult<T> | null | undefined;
                if (payload && payload.success) {
                    finish({ success: true, data: payload.data });
                } else {
                    finish({ success: false, error: payload?.error || 'Unknown Web Worker execution error' });
                }
            };

            worker.onerror = (e: ErrorEvent) => {
                finish({ success: false, error: e.message || 'Unknown Web Worker execution error' });
            };

            // 4. Send the code and context to start execution
            worker.postMessage({ code, context });
        });
    }
}
