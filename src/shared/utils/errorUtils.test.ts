import { describe, it, expect } from 'vitest';
import { normalizeError } from './errorUtils';

describe('normalizeError', () => {
	it('returns the same Error object if input is an Error', () => {
		const err = new Error('test error');
		expect(normalizeError(err)).toBe(err);
	});

	it('returns fallbackMessage if input is not Error and fallback is provided', () => {
		const result = normalizeError('string error', 'custom fallback');
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('custom fallback');
	});

	it('returns string as message if input is string and no fallback', () => {
		const result = normalizeError('string error');
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('string error');
	});

	it('returns default fallback message if input is not string/Error and no fallback', () => {
		const result = normalizeError(12345);
		expect(result).toBeInstanceOf(Error);
		expect(result.message).toBe('알 수 없는 오류');
	});
});
