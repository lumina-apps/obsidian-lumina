import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestUrl } from 'obsidian';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import { GeminiSttEngine } from '../stt/geminiSttEngine';

describe('geminiSttEngine', () => {
	const mockRequestUrl = requestUrl as unknown as ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockRequestUrl.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('Gemini API 키 헤더로 오디오를 전송하고 타임스탬프 JSON 응답에 offsetSec을 반영한다', async () => {
		const config: LLMProviderConfig = {
			id: 'gem-1',
			type: 'google',
			credential: 'AIza-test-key',
			availableModels: ['gemini-2.5-pro', 'gemini-2.5-flash'],
			isVerified: true,
		};

		mockRequestUrl.mockResolvedValue({
			status: 200,
			text: '',
			json: {
				candidates: [
					{
						content: {
							parts: [
								{
									text: JSON.stringify({
										text: '회의 시작합니다.',
										segments: [{ startSec: 1, endSec: 4, text: '회의 시작합니다.' }],
									}),
								},
							],
						},
					},
				],
			},
		});

		const engine = new GeminiSttEngine(config);
		const blob = new Blob([new Uint8Array([10, 20, 30])], { type: 'audio/mp4' });
		const res = await engine.transcribe(blob, 'rec.m4a', { offsetSec: 60, language: 'ko' });

		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		const callArg = mockRequestUrl.mock.calls[0][0] as {
			url: string;
			headers: Record<string, string>;
		};
		expect(callArg.url).toContain('gemini-2.5-flash:generateContent');
		expect(callArg.headers['x-goog-api-key']).toBe('AIza-test-key');

		expect(res.text).toBe('회의 시작합니다.');
		expect(res.segments).toEqual([{ startSec: 61, endSec: 64, text: '회의 시작합니다.' }]);
	});

	it('비-JSON 응답이 반환되어도 일반 텍스트 세그먼트로 안전하게 폴백한다', async () => {
		const config: LLMProviderConfig = {
			id: 'gem-1',
			type: 'google',
			credential: 'AIza-test-key',
			availableModels: ['gemini-2.5-flash'],
			isVerified: true,
		};

		mockRequestUrl.mockResolvedValue({
			status: 200,
			text: '',
			json: {
				candidates: [
					{
						content: {
							parts: [{ text: '일반 텍스트로 반환된 전사 내용' }],
						},
					},
				],
			},
		});

		const engine = new GeminiSttEngine(config);
		const blob = new Blob([new Uint8Array([1, 2])], { type: 'audio/webm' });
		const res = await engine.transcribe(blob, 'rec.webm', { offsetSec: 5 });

		expect(res.text).toBe('일반 텍스트로 반환된 전사 내용');
		expect(res.segments).toEqual([
			{ startSec: 5, endSec: 5, text: '일반 텍스트로 반환된 전사 내용' },
		]);
	});
});
