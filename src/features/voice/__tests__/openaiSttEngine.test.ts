import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestUrl } from 'obsidian';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import { OpenAiSttEngine, resolveOpenAiTranscriptionUrl } from '../stt/openaiSttEngine';

describe('openaiSttEngine', () => {
	const mockRequestUrl = requestUrl as unknown as ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockRequestUrl.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('프로바이더 타입별 올바른 전사 URL을 계산한다', () => {
		expect(
			resolveOpenAiTranscriptionUrl({
				id: '1',
				type: 'openai',
				credential: 'sk',
				availableModels: [],
				isVerified: true,
			}),
		).toBe('https://api.openai.com/v1/audio/transcriptions');

		expect(
			resolveOpenAiTranscriptionUrl({
				id: '2',
				type: 'groq',
				credential: 'gsk',
				availableModels: [],
				isVerified: true,
			}),
		).toBe('https://api.groq.com/openai/v1/audio/transcriptions');

		expect(
			resolveOpenAiTranscriptionUrl({
				id: '3',
				type: 'custom',
				credential: '',
				baseUrl: 'http://localhost:8000/v1/',
				availableModels: [],
				isVerified: true,
			}),
		).toBe('http://localhost:8000/v1/audio/transcriptions');
	});

	it('verbose_json 응답의 타임스탬프 세그먼트에 offsetSec을 정확히 가산한다', async () => {
		const config: LLMProviderConfig = {
			id: 'g1',
			type: 'groq',
			credential: 'gsk-secret',
			availableModels: ['whisper-large-v3-turbo'],
			isVerified: true,
		};

		mockRequestUrl.mockResolvedValue({
			status: 200,
			text: '',
			json: {
				text: '첫 번째 문장 두 번째 문장',
				duration: 12,
				segments: [
					{ start: 0.5, end: 4.0, text: '첫 번째 문장' },
					{ start: 4.5, end: 11.0, text: '두 번째 문장' },
				],
			},
		});

		const engine = new OpenAiSttEngine(config);
		const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' });
		const res = await engine.transcribe(blob, 'chunk.wav', {
			offsetSec: 300,
			language: 'ko',
			promptHint: 'Lumina, Obsidian',
		});

		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
		const callArg = mockRequestUrl.mock.calls[0][0] as {
			url: string;
			headers: Record<string, string>;
		};
		expect(callArg.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
		expect(callArg.headers.Authorization).toBe('Bearer gsk-secret');

		expect(res.text).toBe('첫 번째 문장 두 번째 문장');
		expect(res.segments).toEqual([
			{ startSec: 300.5, endSec: 304, text: '첫 번째 문장' },
			{ startSec: 304.5, endSec: 311, text: '두 번째 문장' },
		]);
	});

	it('verbose_json이 400으로 거부되면 json 포맷으로 1회 자동 폴백한다', async () => {
		const config: LLMProviderConfig = {
			id: 'o1',
			type: 'openai',
			credential: 'sk-oai',
			availableModels: ['whisper-1'],
			isVerified: true,
		};

		mockRequestUrl
			.mockRejectedValueOnce({ status: 400, message: 'verbose_json not supported' })
			.mockResolvedValueOnce({
				status: 200,
				text: '',
				json: { text: '폴백 전사 결과' },
			});

		const engine = new OpenAiSttEngine(config);
		const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
		const res = await engine.transcribe(blob, 'audio.webm', { offsetSec: 10 });

		expect(mockRequestUrl).toHaveBeenCalledTimes(2);
		expect(res.text).toBe('폴백 전사 결과');
		expect(res.segments).toEqual([{ startSec: 10, endSec: 10, text: '폴백 전사 결과' }]);
	});

	it('AbortSignal이 이미 중단된 상태면 요청을 보내지 않고 AbortError를 던진다', async () => {
		const config: LLMProviderConfig = {
			id: 'o1',
			type: 'openai',
			credential: 'sk-oai',
			availableModels: ['whisper-1'],
			isVerified: true,
		};
		const controller = new AbortController();
		controller.abort();

		const engine = new OpenAiSttEngine(config);
		const blob = new Blob([new Uint8Array([1, 2])], { type: 'audio/wav' });
		await expect(
			engine.transcribe(blob, 'a.wav', { signal: controller.signal }),
		).rejects.toThrow();
		expect(mockRequestUrl).not.toHaveBeenCalled();
	});
});
