import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestUrlResponse } from 'obsidian';

const { mockRequestUrl, mockPlatform } = vi.hoisted(() => ({
	mockRequestUrl: vi.fn(),
	mockPlatform: { isMobile: false },
}));
vi.mock('obsidian', () => ({
	Platform: mockPlatform,
	requestUrl: (...args: unknown[]) => mockRequestUrl(...args),
}));

import {
	GeminiContextCacheManager,
	getGeminiExplicitCacheMinTokens,
	splitForExplicitCache,
	supportsGeminiExplicitCaching,
} from './gemini-cache-manager';

describe('gemini-cache-manager', () => {
	let manager: GeminiContextCacheManager;

	beforeEach(() => {
		mockRequestUrl.mockReset();
		manager = new GeminiContextCacheManager();
	});

	it('supportsGeminiExplicitCaching은 Gemini 2.5/3만 허용하고 Gemini 4 및 임베딩 모델은 제외한다', () => {
		expect(supportsGeminiExplicitCaching('gemini-2.5-pro')).toBe(true);
		expect(supportsGeminiExplicitCaching('models/gemini-2.5-flash')).toBe(true);
		expect(supportsGeminiExplicitCaching('gemini-3-pro-preview')).toBe(true);
		expect(supportsGeminiExplicitCaching('gemini-4-neon')).toBe(false);
		expect(supportsGeminiExplicitCaching('models/gemini-4')).toBe(false);
		expect(supportsGeminiExplicitCaching('text-embedding-004')).toBe(false);
	});

	it('getGeminiExplicitCacheMinTokens는 모델별 최소 토큰 기준을 반환한다', () => {
		expect(getGeminiExplicitCacheMinTokens('gemini-2.5-flash')).toBe(1024);
		expect(getGeminiExplicitCacheMinTokens('models/gemini-2.5-pro')).toBe(2048);
		expect(getGeminiExplicitCacheMinTokens('gemini-3-pro-preview')).toBe(4096);
	});

	it('splitForExplicitCache는 추정 토큰이 모델별 최소치 미만이면 null을 반환한다', () => {
		const res = splitForExplicitCache(
			[{ role: 'user', parts: [{ text: 'short hello' }] }],
			{ parts: [{ text: 'short system' }] },
			undefined,
			'gemini-2.5-flash',
		);
		expect(res).toBeNull();
	});

	it('대용량 프리픽스에 대해 cachedContents를 생성하고 동일 해시 재요청 시 재사용한다', async () => {
		const largeText = 'a'.repeat(20_000);
		mockRequestUrl.mockResolvedValue({
			json: {
				name: 'cachedContents/cache-123',
				expireTime: new Date(Date.now() + 300_000).toISOString(),
			},
		} as RequestUrlResponse);

		const first = await manager.getOrCreateCache({
			providerId: 'google-1',
			apiKey: 'AIza-key',
			model: 'gemini-2.5-pro',
			formattedContents: [
				{ role: 'user', parts: [{ text: largeText }] },
				{ role: 'user', parts: [{ text: 'Follow up question' }] },
			],
			systemInstruction: { parts: [{ text: 'You are an expert.' }] },
			sessionKey: 'sess-1',
			ttlSeconds: 300,
		});

		expect(first).not.toBeNull();
		expect(first?.cacheName).toBe('cachedContents/cache-123');
		expect(first?.tailContents).toEqual([{ role: 'user', parts: [{ text: 'Follow up question' }] }]);
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);

		const second = await manager.getOrCreateCache({
			providerId: 'google-1',
			apiKey: 'AIza-key',
			model: 'gemini-2.5-pro',
			formattedContents: [
				{ role: 'user', parts: [{ text: largeText }] },
				{ role: 'user', parts: [{ text: 'Another tail question' }] },
			],
			systemInstruction: { parts: [{ text: 'You are an expert.' }] },
			sessionKey: 'sess-1',
			ttlSeconds: 300,
		});

		expect(second?.cacheName).toBe('cachedContents/cache-123');
		expect(second?.tailContents).toEqual([{ role: 'user', parts: [{ text: 'Another tail question' }] }]);
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
	});

	it('systemInstruction이 임계치 이상이면 non-empty contents를 포함해 캐시를 생성하고 2턴에서도 재사용한다', async () => {
		const largeContext = 's'.repeat(20_000);
		const sysText = `You are an assistant.\n\n<context>\n${largeContext}\n</context>`;
		mockRequestUrl.mockResolvedValue({
			json: {
				name: 'cachedContents/sys-cache-1',
				expireTime: new Date(Date.now() + 300_000).toISOString(),
			},
		} as RequestUrlResponse);

		const turn1Contents = [{ role: 'user', parts: [{ text: 'Turn 1' }] }];
		const first = await manager.getOrCreateCache({
			providerId: 'google-1',
			apiKey: 'AIza-key',
			model: 'gemini-2.5-pro',
			formattedContents: turn1Contents,
			systemInstruction: { parts: [{ text: sysText }] },
			sessionKey: 'sess-sys',
			ttlSeconds: 300,
		});

		expect(first?.cacheName).toBe('cachedContents/sys-cache-1');
		expect(first?.tailContents).toEqual(turn1Contents);
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);

		const createBody = JSON.parse((mockRequestUrl.mock.calls[0][0] as { body: string }).body) as {
			systemInstruction?: { parts: Array<{ text: string }> };
			contents?: Array<{ role: string; parts: Array<{ text: string }> }>;
		};
		// Gemini REST API 필수 제약: contents는 절대 비어있지 않아야 함
		expect(Array.isArray(createBody.contents)).toBe(true);
		expect(createBody.contents!.length).toBeGreaterThanOrEqual(2);
		expect(createBody.contents![0].parts[0].text).toContain(largeContext);
		expect(createBody.systemInstruction?.parts[0].text).toBe('You are an assistant.');

		const turn2Contents = [
			{ role: 'user', parts: [{ text: 'Turn 1' }] },
			{ role: 'model', parts: [{ text: 'Reply 1' }] },
			{ role: 'user', parts: [{ text: 'Turn 2' }] },
		];
		const second = await manager.getOrCreateCache({
			providerId: 'google-1',
			apiKey: 'AIza-key',
			model: 'gemini-2.5-pro',
			formattedContents: turn2Contents,
			systemInstruction: { parts: [{ text: sysText }] },
			sessionKey: 'sess-sys',
			ttlSeconds: 300,
		});

		expect(second?.cacheName).toBe('cachedContents/sys-cache-1');
		expect(second?.tailContents).toEqual(turn2Contents);
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
	});

	it('<context> 마커 없이 systemInstruction 본문만 큰 경우에도 non-empty contents로 변환된다', async () => {
		const largePlainSys = 'p'.repeat(8_000);
		const split = splitForExplicitCache(
			[{ role: 'user', parts: [{ text: 'Hello' }] }],
			{ parts: [{ text: largePlainSys }] },
			undefined,
			'gemini-2.5-flash',
		);

		expect(split).not.toBeNull();
		expect(split?.cacheSystemInstruction).toBeUndefined();
		expect(split?.cacheContents.length).toBeGreaterThanOrEqual(2);
	});

	it('clearSession과 destroyAll 호출 시 DELETE API로 원격 캐시를 정리한다', async () => {
		const largeText = 'b'.repeat(20_000);
		mockRequestUrl
			.mockResolvedValueOnce({
				json: {
					name: 'cachedContents/sess-a',
					expireTime: new Date(Date.now() + 300_000).toISOString(),
				},
			} as RequestUrlResponse)
			.mockResolvedValueOnce({
				json: {
					name: 'cachedContents/sess-b',
					expireTime: new Date(Date.now() + 300_000).toISOString(),
				},
			} as RequestUrlResponse)
			.mockResolvedValue({ json: {} } as RequestUrlResponse);

		await manager.getOrCreateCache({
			providerId: 'g1',
			apiKey: 'key-1',
			model: 'gemini-2.5-flash',
			formattedContents: [{ role: 'user', parts: [{ text: 'q1' }] }],
			systemInstruction: { parts: [{ text: largeText }] },
			sessionKey: 'sess-a',
		});

		await manager.getOrCreateCache({
			providerId: 'g1',
			apiKey: 'key-1',
			model: 'gemini-2.5-flash',
			formattedContents: [{ role: 'user', parts: [{ text: 'q2' }] }],
			systemInstruction: { parts: [{ text: largeText + 'diff' }] },
			sessionKey: 'sess-b',
		});

		await manager.clearSession('sess-a');
		expect(mockRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				url: 'https://generativelanguage.googleapis.com/v1beta/cachedContents/sess-a',
				method: 'DELETE',
			}),
		);

		await manager.destroyAll();
		expect(mockRequestUrl).toHaveBeenCalledWith(
			expect.objectContaining({
				url: 'https://generativelanguage.googleapis.com/v1beta/cachedContents/sess-b',
				method: 'DELETE',
			}),
		);
	});

	it('캐시 생성 API가 실패하면 쿨다운을 설정하고 null을 반환해 일반 요청 폴백을 허용한다', async () => {
		const largeText = 'c'.repeat(20_000);
		mockRequestUrl.mockRejectedValue(new Error('HTTP 400 too small'));

		const first = await manager.getOrCreateCache({
			providerId: 'g1',
			apiKey: 'key-1',
			model: 'gemini-2.5-pro',
			formattedContents: [{ role: 'user', parts: [{ text: 'hi' }] }],
			systemInstruction: { parts: [{ text: largeText }] },
		});
		expect(first).toBeNull();
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);

		// 쿨다운 동안 재시도하지 않음
		const second = await manager.getOrCreateCache({
			providerId: 'g1',
			apiKey: 'key-1',
			model: 'gemini-2.5-pro',
			formattedContents: [{ role: 'user', parts: [{ text: 'hi' }] }],
			systemInstruction: { parts: [{ text: largeText }] },
		});
		expect(second).toBeNull();
		expect(mockRequestUrl).toHaveBeenCalledTimes(1);
	});
});
