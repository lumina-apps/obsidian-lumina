/** LLM 에러 메시지를 사용자 친화적인 문자열로 변환 */
import { t } from '../locales/helpers';

export function formatLlmError(err: unknown): string {
	const rawMessage = err instanceof Error ? err.message : String(err);
	const status = typeof err === 'object' && err !== null && 'status' in err ? Number(err.status) : null;

	const hasStatus = (code: number) =>
		status === code ||
		rawMessage.includes(`HTTP ${code}`) ||
		new RegExp(`status[:\\s]+${code}\\b`, 'i').test(rawMessage);

	// HTTP 429: Rate Limit / Quota Exceeded
	if (hasStatus(429)) {
		return t('errors.llm.rateLimit');
	}
	// HTTP 401: Unauthorized / API Key issue
	if (hasStatus(401)) {
		return t('errors.llm.unauthorized');
	}
	// HTTP 403: Forbidden / Permission denied
	if (hasStatus(403)) {
		return t('errors.llm.forbidden');
	}
	// HTTP 404: Model not found / Endpoint issue
	if (hasStatus(404)) {
		return t('errors.llm.notFound');
	}
	// HTTP 503: Service Unavailable / High demand
	if (hasStatus(503)) {
		return t('errors.llm.serviceUnavailable');
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