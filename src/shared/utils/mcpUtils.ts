export const MCP_CONNECT_TIMEOUT = 10000;

export const MCP_MAX_FILE_LENGTH = 100000;

/** unknown 에러를 Error로 정규화 */
export function formatMcpError(e: unknown, context?: string): Error {
	if (e instanceof Error) return e;
	const message = context ? `${context}: ${String(e)}` : String(e);
	return new Error(message);
}

/** 툴 이름이 위험한 작업(쓰기/수정/실행)인지 판별 */
export function isDangerousTool(toolName: string): boolean {
	const lower = toolName.toLowerCase();
	const dangerousPatterns = [
		/create/i,
		/write/i,
		/execute/i,
		/run/i,
		/delete/i,
		/remove/i,
		/update/i,
		/append/i,
		/replace/i,
		/move/i,
		/patch/i,
		/save/i,
		/mkdir/i,
		/(?:^|[_\W])(?:shell|cmd|bash|eval|link|moc)(?:$|[_\W])/i,
	];
	return dangerousPatterns.some((pattern) => pattern.test(lower));
}

/** Promise.race로 타임아웃 적용 */
export function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number = MCP_CONNECT_TIMEOUT,
	errorMessage = 'Connection timeout',
): Promise<T> {
	let timerId: number | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timerId = window.setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
	});
	return Promise.race([promise, timeout]).finally(() => {
		if (timerId !== undefined) {
			window.clearTimeout(timerId);
		}
	});
}