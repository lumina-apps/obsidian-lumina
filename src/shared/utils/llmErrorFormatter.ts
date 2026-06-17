/**
 * llmErrorFormatter.ts
 * LLM 에러 메시지를 사용자 친화적인 문자열로 포맷팅합니다.
 */
import { t } from '../locales/helpers';

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