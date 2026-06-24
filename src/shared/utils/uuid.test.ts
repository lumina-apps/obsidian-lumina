/**
 * uuid.test.ts
 * UUID 생성 함수 검증
 */
import { describe, it, expect } from 'vitest';
import { generateUUID } from './uuid';

describe('generateUUID', () => {
	it('UUID 형식 문자열을 반환한다', () => {
		const uuid = generateUUID();
		// UUID v4 형식: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
		expect(uuid).toMatch(uuidRegex);
	});

	it('호출할 때마다 다른 값을 반환한다', () => {
		const uuids = new Set(Array.from({ length: 100 }, () => generateUUID()));
		expect(uuids.size).toBe(100);
	});

	it('36자 문자열을 반환한다', () => {
		expect(generateUUID()).toHaveLength(36);
	});

	it('crypto.randomUUID가 없는 환경에서도 폴리필을 통해 UUID를 반환한다', () => {
		// crypto.randomUUID를 임시로 제거
		const originalCrypto = global.crypto;
		Object.defineProperty(global, 'crypto', {
			value: { ...originalCrypto, randomUUID: undefined },
			writable: true
		});

		const uuid = generateUUID();
		const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
		expect(uuid).toMatch(uuidRegex);
		expect(uuid).toHaveLength(36);

		// 원상 복구
		Object.defineProperty(global, 'crypto', {
			value: originalCrypto,
			writable: true
		});
	});
});