import { describe, it, expect } from 'vitest';
import { estimateTokens } from './tokenEstimator';

describe('tokenEstimator', () => {
	it('should return 0 for empty string or null/undefined-like input', () => {
		expect(estimateTokens('')).toBe(0);
	});

	it('should estimate English text at ~4 chars per token', () => {
		const text = 'This is a test message.'; // 23 chars -> 23 * 0.25 = 5.75 -> ceil = 6
		expect(estimateTokens(text)).toBe(6);
	});

	it('should estimate Korean text at ~1.5 tokens per char', () => {
		const text = '안녕하세요'; // 5 chars -> 5 * 1.5 = 7.5 -> ceil = 8
		expect(estimateTokens(text)).toBe(8);
	});

	it('should estimate mixed text correctly', () => {
		const text = '안녕하세요 Hello'; // 5 CJK, 6 other -> 7.5 + 1.5 = 9
		expect(estimateTokens(text)).toBe(9);
	});

	it('should correctly estimate Japanese and Chinese text', () => {
		const japanese = 'こんにちは世界'; // 7 chars CJK -> 7 * 1.5 = 10.5 -> ceil = 11
		expect(estimateTokens(japanese)).toBe(11);

		const chinese = '你好世界'; // 4 chars CJK -> 4 * 1.5 = 6
		expect(estimateTokens(chinese)).toBe(6);
	});

	it('should handle large text without errors', () => {
		const largeKorean = '가'.repeat(10000);
		expect(estimateTokens(largeKorean)).toBe(15000);

		const largeEnglish = 'a'.repeat(10000);
		expect(estimateTokens(largeEnglish)).toBe(2500);
	});
});

