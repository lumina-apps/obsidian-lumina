/** 검색 provider 공통 에러 메시지 포맷터 */

const STATUS_PATTERN = /status\s+(\d{3})/i;

/** 에러 메시지에서 HTTP 상태 코드를 추출합니다. 없으면 undefined. */
export function extractHttpStatus(message: string): number | undefined {
	const match = STATUS_PATTERN.exec(message);
	return match ? Number(match[1]) : undefined;
}

/**
 * `${prefix} failed: ${message}` 형식의 에러 메시지를 만듭니다. (예: prefix = 'Tavily search')
 * 상태 코드를 알 수 있으면 원인 힌트를 뒤에 덧붙입니다(기존 메시지는 그대로 유지).
 */
export function formatSearchError(
	prefix: string,
	error: unknown,
	statusHints?: Partial<Record<number, string>>,
): string {
	const message = error instanceof Error ? error.message : String(error);
	const status = extractHttpStatus(message);

	let hint: string | undefined;
	if (status !== undefined) {
		hint = statusHints?.[status];
		if (!hint) {
			if (status === 401 || status === 403) {
				hint = 'Authentication failed. Check the API key and its permissions.';
			} else if (status === 429) {
				hint = 'Rate limit or quota exceeded. Try again later.';
			}
		}
	}

	return hint
		? `${prefix} failed: ${message} (${hint})`
		: `${prefix} failed: ${message}`;
}
