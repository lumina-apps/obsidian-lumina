import { describe, it, expect } from 'vitest';
import { formatLlmError } from './llmErrorFormatter';
import { t } from '../locales/helpers';

describe('formatLlmError', () => {
	it('formats HTTP 401 and status 401 correctly', () => {
		expect(formatLlmError(new Error('Anthropic Error (HTTP 401): invalid api key'))).toBe(t('errors.llm.unauthorized'));
		expect(formatLlmError(new Error('Request failed, status 401'))).toBe(t('errors.llm.unauthorized'));
		expect(formatLlmError({ status: 401, message: 'Unauthorized' })).toBe(t('errors.llm.unauthorized'));
	});

	it('formats HTTP 429 and status 429 correctly', () => {
		expect(formatLlmError(new Error('OpenAI Error (HTTP 429): quota exceeded'))).toBe(t('errors.llm.rateLimit'));
		expect(formatLlmError(new Error('Request failed, status 429'))).toBe(t('errors.llm.rateLimit'));
		expect(formatLlmError({ status: 429, message: 'Too many requests' })).toBe(t('errors.llm.rateLimit'));
	});

	it('formats HTTP 403 correctly', () => {
		expect(formatLlmError(new Error('Request failed, status 403'))).toBe(t('errors.llm.forbidden'));
		expect(formatLlmError({ status: 403 })).toBe(t('errors.llm.forbidden'));
	});

	it('formats HTTP 404 correctly', () => {
		expect(formatLlmError(new Error('Request failed, status 404'))).toBe(t('errors.llm.notFound'));
		expect(formatLlmError({ status: 404 })).toBe(t('errors.llm.notFound'));
	});

	it('formats HTTP 503 correctly', () => {
		expect(formatLlmError(new Error('Request failed, status 503'))).toBe(t('errors.llm.serviceUnavailable'));
		expect(formatLlmError({ status: 503 })).toBe(t('errors.llm.serviceUnavailable'));
	});

	it('formats network error correctly', () => {
		expect(formatLlmError(new Error('Failed to fetch'))).toBe(t('errors.llm.networkError'));
		expect(formatLlmError(new Error('net::ERR_CONNECTION_REFUSED'))).toBe(t('errors.llm.networkError'));
	});

	it('returns raw message for unrecognized errors', () => {
		expect(formatLlmError(new Error('Something unusual happened'))).toBe('Something unusual happened');
	});
});

