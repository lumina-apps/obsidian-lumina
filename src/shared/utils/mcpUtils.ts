/**
 * MCP 모듈 공통 유틸리티.
 * mcpManager, httpTransport, toolHandlers 등에서 중복 사용되던 패턴을 통합합니다.
 */

/** MCP 서버/클라이언트 연결 타임아웃 (ms) */
export const MCP_CONNECT_TIMEOUT = 15000;

/** append_to_note 등의 최대 병합 파일 길이 */
export const MCP_MAX_FILE_LENGTH = 100000;

/**
 * unknown 에러를 Error 인스턴스로 정규화합니다.
 * e instanceof Error ? e : new Error(...) 패턴을 대체.
 */
export function formatMcpError(e: unknown, context?: string): Error {
	if (e instanceof Error) return e;
	const message = context ? `${context}: ${String(e)}` : String(e);
	return new Error(message);
}

/**
 * 툴 이름이 위험한 작업(쓰기/실행)에 해당하는지 판별합니다.
 */
export function isDangerousTool(toolName: string): boolean {
	const lower = toolName.toLowerCase();
	const dangerousPatterns = [
		/^write/i, /write$/i,
		/^execute/i, /execute$/i,
		/^run/i, /run$/i,
		/^delete/i, /delete$/i,
		/^remove/i, /remove$/i,
		/^update/i, /update$/i,
		/^mkdir/i,
		/\bshell\b/i,
		/\bcmd\b/i,
		/\bbash\b/i,
	];
	return dangerousPatterns.some((pattern) => pattern.test(lower));
}

/**
 * Promise.race로 타임아웃을 적용한 비동기 작업을 실행합니다.
 */
export function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number = MCP_CONNECT_TIMEOUT,
	errorMessage = 'Connection timeout',
): Promise<T> {
	const timeout = new Promise<never>((_, reject) => {
		window.setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
	});
	return Promise.race([promise, timeout]);
}