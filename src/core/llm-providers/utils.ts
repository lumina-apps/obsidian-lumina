/**
 * utils.ts
 * LLM REST API Provider 전용 유틸리티 함수
 */
import { t } from '../../shared/locales/helpers';

/**
 * 에러 객체 또는 메시지를 파싱하여 사용자 친화적인 한국어/영어 등으로 포맷팅합니다.
 */
export function formatLlmError(err: unknown): string {
	const rawMessage = err instanceof Error ? err.message : String(err);

	// HTTP 429: Rate Limit / Quota Exceeded
	if (rawMessage.includes('HTTP 429')) {
		return t('errors.llm.rateLimit');
	}
	// HTTP 401: Unauthorized / API Key issue
	if (rawMessage.includes('HTTP 401')) {
		return t('errors.llm.unauthorized');
	}
	// HTTP 403: Forbidden / Permission denied
	if (rawMessage.includes('HTTP 403')) {
		return t('errors.llm.forbidden');
	}
	// HTTP 404: Model not found / Endpoint issue
	if (rawMessage.includes('HTTP 404')) {
		return t('errors.llm.notFound');
	}
	// Network Error
	if (
		rawMessage.toLowerCase().includes('failed to fetch') ||
		rawMessage.toLowerCase().includes('net::err') ||
		rawMessage.toLowerCase().includes('connection refused')
	) {
		return t('errors.llm.networkError');
	}

	return rawMessage;
}


/**
 * ReadableStream의 응답을 한 라인씩 분할하여 콜백으로 전달합니다.
 */
export async function readStreamLines(
	response: Response,
	signal: AbortSignal | undefined,
	onLine: (line: string) => void
): Promise<void> {
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error(t('errors.llm.notReadable'));
	}
	const decoder = new TextDecoder('utf-8');
	let buffer = '';

	try {
		while (true) {
			if (signal?.aborted) {
				await reader.cancel();
				break;
			}
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				onLine(line);
			}
		}
		if (buffer) {
			onLine(buffer);
		}
	} finally {
		reader.releaseLock();
	}
}
